defmodule NovelApplication.JudgmentProtocol do
  @moduledoc """
  判断①协议（ADR-0025 方案 B 回复内联）——交互循环的意图理解与本轮形态判断。

  两段式调用：
  - call1 自由输出判断叙事（流式，46§9.4 意图段体裁）；判"直接回复"时同一次输出
    空行后内联回复正文（回复内联协议，简单对话 2 次调用的来源）。
  - call2 强制 native tool call 产出轻量 `judgment_decision` 结构（action + capability
    + reply_included + candidate_directions 携带 + 空 content 降级用 author_narrative）。

  形态动作：reply（直接回复）｜ execute（单动作执行）｜ plan（制定计划）｜
  explore（先检索；能力目录含检索能力时才开放——CP5 接入内部翼后生产打开）｜
  await_author（等作者说清）。

  MBC 探针先行验证协议与判断质量（`scripts/model_contracts/judgment_protocol.exs`，
  live gpt-oss-120b 1.0）；探针消费本模块的 prompt/请求构造器，与生产同路径。
  CP1b 起交互循环入口消费 `request_judgment/3`；frame 语义并入本协议（判断结构
  机械转换 DialogueFrame 由循环侧完成）。
  """

  alias NovelAgent.Provider.Execution
  alias NovelAgent.Provider.InferenceParams
  alias NovelApplication.AgentNarrativeSource
  alias NovelApplication.ProviderActivityProjector

  @judgment_tool_name "judgment_decision"
  @base_actions ~w(reply execute plan await_author)
  @explore_action "explore"

  @type judgment :: %{
          action: String.t(),
          capability: String.t() | nil,
          reason: String.t(),
          reply_included: boolean(),
          candidate_directions: [map()],
          candidate_directions_present: boolean(),
          narrative: String.t(),
          narrative_source: map() | nil,
          provider_call_count: pos_integer()
        }

  @spec tool_name() :: String.t()
  def tool_name, do: @judgment_tool_name

  @spec actions(keyword()) :: [String.t()]
  def actions(opts \\ []) do
    if Keyword.get(opts, :explore, false) do
      @base_actions ++ [@explore_action]
    else
      @base_actions
    end
  end

  @doc """
  执行判断①两段式调用。

  `input` 至少含 `:author_text` 与 `:context_block`（机械准备渲染好的作品上下文 +
  能力目录段落）；`opts` 支持 `explore: true`（目录含检索能力时开放 explore 形态）。
  返回 judgment map；call2 结构不可解析时携带失败片段重试一次，仍失败则诚实报错
  （上层按 S7 失败终局收口，不静默）。
  """
  @spec request_judgment(Execution.dependency(), map(), map()) ::
          {:ok, judgment()} | {:error, term()}
  def request_judgment(provider_execution, snapshot \\ %{}, input) do
    opts = Map.get(input, :options, [])

    with {:ok, narrative_fn} <- result_fn(provider_execution, snapshot, :author_reasoning),
         {:ok, decision_fn} <- result_fn(provider_execution, snapshot, :planner),
         {:ok, narrative, narrative_result} <-
           request_narrative(narrative_prompt(input), narrative_fn) do
      request_decision(%{
        prompt: decision_prompt(input, narrative),
        result_fn: decision_fn,
        narrative: narrative,
        narrative_result: narrative_result,
        options: opts,
        attempt: 1,
        retry?: true
      })
    end
  end

  # ── call1：自由输出判断叙事（流式） ──

  # 判断调用温度为协议属性：叙事段 0.4（自然但守结构），结构段 0.2（裁决确定性）。
  # MBC 实测默认 0.7 下内联结构与 execute 边界随机摇摆（0.889~1.0），低温收敛。
  defp judgment_params(:author_reasoning), do: InferenceParams.new(temperature: 0.4)
  defp judgment_params(:planner), do: InferenceParams.new(temperature: 0.2)

  defp result_fn(provider_execution, snapshot, purpose) do
    fun =
      provider_execution
      |> Execution.with_purpose(purpose)
      |> Execution.with_params(judgment_params(purpose))
      |> ProviderActivityProjector.with_stage_sink(snapshot, purpose: purpose)
      |> Execution.result_fn()

    case fun do
      fun when is_function(fun, 1) -> {:ok, fun}
      nil -> {:error, :provider_execution_required}
      other -> {:error, {:invalid_judgment_provider, other}}
    end
  end

  defp request_narrative(prompt, result_fn) do
    case result_fn.(prompt) do
      {:ok, %{content: content} = provider_result} when is_binary(content) ->
        {:ok, String.trim(content), provider_result}

      {:ok, content} when is_binary(content) ->
        {:ok, String.trim(content), %{content: content}}

      {:error, reason} ->
        {:error, reason}

      other ->
        {:error, {:invalid_judgment_narrative_result, other}}
    end
  end

  # ── call2：强制 native tool call 判断结构（坏结构携带片段重试一次） ──

  defp request_decision(%{prompt: prompt, result_fn: result_fn} = request) do
    case result_fn.(prompt) do
      {:ok, provider_result} ->
        parse_decision(provider_result, request)

      {:error, reason} ->
        {:error, reason}
    end
  end

  defp parse_decision(provider_result, request) do
    arguments =
      provider_result
      |> tool_calls()
      |> Enum.find_value(fn call ->
        if map_get(call, :name) == @judgment_tool_name,
          do: normalize_arguments(map_get(call, :arguments))
      end)

    with %{} = arguments <- arguments,
         action when is_binary(action) <- map_get(arguments, :action),
         true <- action in actions(request.options) do
      build_judgment(arguments, action, provider_result, request)
    else
      _ -> retry_or_fail(provider_result, request)
    end
  end

  defp build_judgment(arguments, action, provider_result, request) do
    case bind_narrative(arguments, request, provider_result) do
      {:ok, narrative, narrative_source} ->
        {:ok,
         %{
           action: action,
           capability: nonblank(map_get(arguments, :capability)),
           reason: map_get(arguments, :reason) || "",
           reply_included: map_get(arguments, :reply_included) == true,
           candidate_directions: candidate_directions(arguments),
           # 探索意图原始信号：字段存在且非空（哪怕结构坏了）——坏结构不丢意图，
           # 由消费层降级为应用兜底候选（S2 韧性，旧 frame 兜底语义平移）。
           candidate_directions_present: candidate_directions_present?(arguments),
           narrative: narrative,
           narrative_source: narrative_source,
           provider_call_count: 1 + request.attempt
         }}

      {:error, reason} ->
        {:error, reason}
    end
  end

  # 叙事绑定：call1 content 优先（流式来源）；空 content 时降级 call2
  # arguments.author_narrative（thinking 系空 content 模型，方案 C 降级路径）。
  defp bind_narrative(arguments, request, provider_result) do
    cond do
      request.narrative != "" ->
        case AgentNarrativeSource.from_provider_result(
               request.narrative_result,
               request.narrative
             ) do
          {:ok, source} -> {:ok, request.narrative, source}
          {:error, reason} -> {:error, reason}
        end

      is_binary(map_get(arguments, :author_narrative)) and
          String.trim(map_get(arguments, :author_narrative)) != "" ->
        narrative = String.trim(map_get(arguments, :author_narrative))

        case AgentNarrativeSource.from_tool_call_narrative(
               provider_result,
               @judgment_tool_name,
               narrative
             ) do
          {:ok, source} -> {:ok, narrative, source}
          {:error, reason} -> {:error, reason}
        end

      true ->
        {:error, :judgment_narrative_required}
    end
  end

  defp retry_or_fail(provider_result, %{retry?: true} = request) do
    fragment =
      provider_result
      |> tool_calls()
      |> inspect()
      |> String.slice(0, 400)

    retry_prompt =
      update_in(request.prompt, [:messages], fn [message | rest] ->
        [
          %{
            message
            | content:
                message.content <>
                  "\n\n## 上次输出无法被系统解析\n" <>
                  "上一次调用返回的结构不合法（片段：#{fragment}）。" <>
                  "必须调用 #{@judgment_tool_name}，action 只能取 " <>
                  "#{Enum.join(actions(request.options), " / ")}。"
          }
          | rest
        ]
      end)

    request_decision(%{request | prompt: retry_prompt, retry?: false, attempt: request.attempt + 1})
  end

  defp retry_or_fail(provider_result, _request) do
    {:error,
     {:judgment_decision_unparseable,
      provider_result |> tool_calls() |> inspect() |> String.slice(0, 200)}}
  end

  # ── prompt 构造（探针与生产共用同一真源） ──

  @doc "call1 自由输出 prompt：判断叙事 + 直接回复内联（46§9.4 意图段体裁）。"
  @spec narrative_prompt(map()) :: map()
  def narrative_prompt(input) do
    %{
      messages: [
        %{
          role: "user",
          content: """
          你是小说创作系统的创作判断器。作者刚发来一条输入，你要判断本轮的形态并向作者说明。

          #{Map.fetch!(input, :context_block)}

          ## 作者输入
          #{Map.fetch!(input, :author_text)}

          #{forms_section(input)}

          ## 判别规则（容易混的边界）
          - 作者要你"做出一个创作产物"（设计一个角色、写一章、给一份大纲）→ 这是单动作执行，
            不是直接回复：不要用文字描述替代产出候选。
          - 单动作执行 vs 制定计划：作者点名的是**一个**产物，即使做它需要参考现有内容，也算
            单动作执行；只有作者的请求本身包含**多个相互依赖的产物或阶段**时才制定计划。
          - 作者显式说"先聊/只聊/讨论/不要写/不要改/别生成"时，不得选单动作执行或制定计划——
            按直接回复处理；如果回应要给作者多个可选方向，在说明里把方向讲清楚。
          - 作者询问作品当前状态或进度（写了多少章 / 写到哪了 / 下一章从哪开始）：按上面
            作品上下文直接回答，这是直接回复。

          ## 输出要求（会逐字实时显示给作者）
          - 用自然中文输出一段连贯的判断说明：先复述你理解的作者意图，再说明你选择的形态与理由。
          - 如果你的判断是"直接回复"：判断说明之后空一行，接着输出给作者的回复正文（在这同一次
            输出里完成）。回复里若要给作者几个可选方向，把每个方向讲清楚。
          - 其它形态：只输出判断说明，不要开始执行。
          - 不要标题、JSON、代码块或内部机器名。
          """
        }
      ]
    }
  end

  @doc "call2 强制 tool call prompt：轻量判断结构。"
  @spec decision_prompt(map(), String.t()) :: map()
  def decision_prompt(input, narrative) do
    opts = Map.get(input, :options, [])

    %{
      messages: [
        %{
          role: "user",
          content: """
          你是小说创作系统的创作判断器。你刚才已向作者输出了判断说明（如下）。现在把这个判断结构化。

          ## 作者输入
          #{Map.fetch!(input, :author_text)}

          ## 你已输出的判断说明
          #{narrative}

          ## 输出格式
          - native tool call：必须调用 #{@judgment_tool_name}，把判断放入 tool arguments。
          - action：#{actions_help(opts)}。
          - execute / plan 时 capability 填能力目录中的能力名#{explore_capability_note(opts)}。
          - reply_included：action=reply 且判断说明已包含给作者的回复正文时为 true。
          - candidate_directions：仅当 action=reply 且你的回复是给作者 2-3 个可选创作方向时填写
            （每个方向 {title, pitch, tone_tags}）；其它情况为空数组。
          - author_narrative：若你在上一步没有输出判断说明，在此补写一段作者可见原文。
          """
        }
      ],
      tools: [
        %{
          name: @judgment_tool_name,
          description: "Structure this turn's judgment for the creative loop.",
          input_schema: %{
            type: "object",
            properties: %{
              action: %{type: "string", enum: actions(opts)},
              capability: %{anyOf: [%{type: "string"}, %{type: "null"}]},
              reply_included: %{type: "boolean"},
              reason: %{type: "string"},
              candidate_directions: %{
                type: "array",
                items: %{
                  type: "object",
                  properties: %{
                    title: %{type: "string"},
                    pitch: %{type: "string"},
                    tone_tags: %{type: "array", items: %{type: "string"}}
                  },
                  required: ["title", "pitch"]
                }
              },
              author_narrative: %{anyOf: [%{type: "string"}, %{type: "null"}]}
            },
            required: ["action", "reason"]
          }
        }
      ],
      tool_choice: @judgment_tool_name
    }
  end

  defp forms_section(input) do
    explore? = input |> Map.get(:options, []) |> Keyword.get(:explore, false)

    base = """
    ## 本轮形态（#{if explore?, do: "五", else: "四"}选一）
    - 直接回复：闲聊、观点、上面作品摘要里已含答案的问题——不需要动用创作能力
    - 单动作执行：一个明确的创作动作就能满足（如设计一个角色、续写一章）
    - 制定计划：需要多个相互依赖的步骤才能完成
    """

    explore_line =
      if explore? do
        "- 先探索：回答或动手之前缺少作品事实，需要先检索\n"
      else
        ""
      end

    String.trim(base) <>
      "\n" <> explore_line <> "- 等作者说清：意图不明确或缺少关键决定，先停下来问作者"
  end

  defp actions_help(opts) do
    base =
      "reply（直接回复，说明里已含回复正文）｜ execute（单动作执行）｜ plan（制定计划）"

    explore = if Keyword.get(opts, :explore, false), do: "｜ explore（先检索作品事实）", else: ""
    base <> explore <> "｜ await_author（等作者说清）"
  end

  defp explore_capability_note(opts) do
    if Keyword.get(opts, :explore, false), do: "；先检索属于 explore，不算 execute", else: ""
  end

  # ── 工具 ──

  defp tool_calls(provider_result) do
    case map_get(provider_result, :tool_calls) do
      calls when is_list(calls) -> calls
      _ -> []
    end
  end

  defp candidate_directions_present?(arguments) do
    case map_get(arguments, :candidate_directions) do
      nil -> false
      [] -> false
      %{} = m when map_size(m) == 0 -> false
      _present -> true
    end
  end

  defp candidate_directions(arguments) do
    case map_get(arguments, :candidate_directions) do
      directions when is_list(directions) -> Enum.filter(directions, &is_map/1)
      _ -> []
    end
  end

  defp normalize_arguments(arguments) when is_map(arguments), do: arguments

  defp normalize_arguments(arguments) when is_binary(arguments) do
    case Jason.decode(arguments) do
      {:ok, decoded} when is_map(decoded) -> decoded
      _ -> nil
    end
  end

  defp normalize_arguments(_arguments), do: nil

  defp nonblank(value) when is_binary(value) do
    case String.trim(value) do
      "" -> nil
      trimmed -> trimmed
    end
  end

  defp nonblank(_value), do: nil

  defp map_get(map, key) when is_map(map),
    do: Map.get(map, key) || Map.get(map, Atom.to_string(key))

  defp map_get(_map, _key), do: nil
end
