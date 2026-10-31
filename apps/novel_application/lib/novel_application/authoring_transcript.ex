defmodule NovelApplication.AuthoringTranscript do
  @moduledoc """
  B71 CP2：Authoring Run Transcript 的 application 层组装器（VS-00L §3–§5）。

  职责边界（ADR-0033 §6）：application 负责 AgentRun/transcript 与编排；IR/投影在
  `NovelAgent.Provider.RequestIR`；本模块只把 run 事实（Base、作者原话、模型 tool_call、
  真实观察、校验结果、作者出口）有序组装为 transcript，并产出 Request IR。

  不变量（可机械检查部分由 `RequestIR.validate/1` 承担）：
  - 作者原话独立消息、字节不变（I-ART-2）。
  - application_base 标记 application provenance（I-ART-3）。
  - 观察按 call_id 关联真实 tool_call，status 如实（I-ART-4）。
  - 校验失败作为 tool 原生结果回流，不追加 user 纠错（I-ART-5）。
  - observation_refs 只来自真实观察；used_refs ⊆ base_refs ∪ observation_refs（I-ART-9）。

  本模块不发起 provider 调用、不执行工具、不写库；执行与真实页面证据归 CP3 首个消费者。
  """

  alias NovelAgent.Provider.RequestIR

  @type t :: %{
          run: map(),
          system: map(),
          messages: [map()],
          tools: [map()],
          base_refs: [map()],
          observation_refs: [map()],
          used_refs: [String.t()],
          projection: map(),
          call_ids: [String.t()]
        }

  @doc """
  创建 transcript 骨架：application_base + 本轮作者原话。

  opts:
  - `:base_text`（必须）应用提供的 Base 说明文本
  - `:author_text`（必须）本轮作者原话（字节不变）
  - `:author_turn_ref` 作者消息来源
  - `:base_refs` 应用主动提供的 refs
  - `:tools` run 角色工具目录（`RequestIR` 期望的 tool_spec 形状）
  - `:projection` 投影配置（默认 chat_completions）
  """
  @spec new(map(), keyword()) :: t()
  def new(run, opts) when is_map(run) do
    base_text = Keyword.fetch!(opts, :base_text)
    author_text = Keyword.fetch!(opts, :author_text)
    base_refs = Keyword.get(opts, :base_refs, [])

    messages = [
      RequestIR.message(:application_base, :application, [RequestIR.text_block(base_text)], %{
        source_refs: base_refs
      }),
      RequestIR.message(:user, :author, [RequestIR.text_block(author_text)], %{
        source_refs: [%{ref: Keyword.get(opts, :author_turn_ref, "author_turn:current")}]
      })
    ]

    %{
      run: run,
      system: Keyword.get(opts, :system, %{identity_ref: "identity:authoring/v1"}),
      messages: messages,
      tools: Keyword.get(opts, :tools, []),
      base_refs: base_refs,
      observation_refs: [],
      used_refs: [],
      projection: Keyword.get(opts, :projection, %{target: "chat_completions"}),
      call_ids: []
    }
  end

  @doc "追加模型产出的 assistant 消息（可见叙事 + 可选 tool_call）。"
  @spec append_assistant(t(), String.t(), [map()]) :: t()
  def append_assistant(transcript, narrative, tool_calls \\ []) do
    blocks =
      case {narrative, tool_calls} do
        {"", []} -> []
        {"", calls} -> calls
        {text, calls} -> [RequestIR.text_block(text) | calls]
      end

    if blocks == [] do
      transcript
    else
      message = RequestIR.message(:assistant, :model, blocks)
      call_ids = Enum.map(tool_calls, &Map.get(&1, :call_id))

      %{
        transcript
        | messages: transcript.messages ++ [message],
          call_ids: transcript.call_ids ++ call_ids
      }
    end
  end

  @doc """
  追加只读观察（真实工具查询结果，按 call_id 关联）。

  `observation` 至少含 `:status`（ok/partial/truncated/unavailable/stale）；可含
  `:source_refs`、`:versions`、`:coverage`、`:omissions`、`:next_offset`、`:content`。
  来源 refs 同步进入 observation_refs，供 `used_refs` 越界校验（I-ART-9）。
  """
  @spec append_observation(t(), String.t(), map()) :: t()
  def append_observation(transcript, call_id, observation) when is_binary(call_id) do
    block = RequestIR.observation_block(call_id, observation)

    message =
      RequestIR.message(:tool, :tool_result, [block], %{
        source_refs: Map.get(observation, :source_refs, [])
      })

    %{
      transcript
      | messages: transcript.messages ++ [message],
        observation_refs: transcript.observation_refs ++ refs_of(observation)
    }
  end

  @doc "追加校验失败/通过结果（tool 原生结果回流，不追加 user 纠错）。"
  @spec append_validation(t(), String.t(), String.t(), String.t(), map()) :: t()
  def append_validation(transcript, call_id, status, reason_code, detail \\ %{}) do
    block = RequestIR.validation_result_block(call_id, status, reason_code, detail)
    message = RequestIR.message(:tool, :tool_result, [block])
    %{transcript | messages: transcript.messages ++ [message]}
  end

  @doc "追加作者出口（机器消息链结束；不投影为 provider 消息）。"
  @spec append_author_exit(t(), String.t(), map()) :: t()
  def append_author_exit(transcript, kind, refs \\ %{}) do
    block = RequestIR.author_exit_block(kind, refs)
    message = RequestIR.message(:author_exit, :application, [block])
    %{transcript | messages: transcript.messages ++ [message]}
  end

  @doc "追加显式压缩 checkpoint（长会话唯一压缩表达，I-ART-7）。"
  @spec append_checkpoint(t(), map(), [map()], map(), [String.t()], String.t()) :: t()
  def append_checkpoint(transcript, covers, source_refs, versions, omissions, summary) do
    block = RequestIR.checkpoint_block(covers, source_refs, versions, omissions, summary)
    message = RequestIR.message(:checkpoint, :application, [block])
    %{transcript | messages: transcript.messages ++ [message]}
  end

  @doc "声明模型对来源的使用（机械校验 ⊆ Base ∪ 观察）。"
  @spec declare_used_refs(t(), [String.t()]) :: t()
  def declare_used_refs(transcript, refs) when is_list(refs) do
    %{transcript | used_refs: refs}
  end

  @doc "组装 Request IR v1（校验在 `RequestIR.validate/1` 与调用方一起完成）。"
  @spec to_request_ir(t(), keyword()) :: {:ok, RequestIR.t()} | {:error, term()}
  def to_request_ir(transcript, opts \\ []) do
    ir =
      RequestIR.new(%{
        run: transcript.run,
        system: transcript.system,
        messages: transcript.messages,
        tools: transcript.tools,
        projection: Map.merge(transcript.projection, Map.new(opts)),
        refs: %{
          base_refs: transcript.base_refs,
          observation_refs: transcript.observation_refs,
          used_refs: transcript.used_refs
        }
      })

    case RequestIR.validate(ir) do
      :ok -> {:ok, ir}
      error -> error
    end
  end

  defp refs_of(observation) do
    case Map.get(observation, :source_refs, []) do
      refs when is_list(refs) -> refs
      _ -> []
    end
  end
end
