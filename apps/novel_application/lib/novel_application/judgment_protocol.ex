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
  alias NovelApplication.TurnInteractionService

  require NovelCommon.LogEmit, as: LogEmit

  @judgment_tool_name "judgment_decision"
  @base_actions ~w(reply execute plan await_author)
  @explore_action "explore"
  # capability_gap（Q3b，D8 根 2）：作者意图当前无能力承接时的诚实缺口回复子型——
  # 协议不再假设「目录永远覆盖意图」，给模型一个说「我做不到」的结构化出口。
  @reply_frame_types ~w(casual_reply creative_exploration question_answer meta_discussion capability_gap)

  @continuation_tool_name "continuation_decision"
  @continuation_actions ~w(continue await_author)

  @type judgment :: %{
          action: String.t(),
          capability: String.t() | nil,
          reason: String.t(),
          frame_type: String.t() | nil,
          dialogue_goal: String.t() | nil,
          reply_included: boolean(),
          record_only: boolean(),
          pending_artifact_ref: String.t() | nil,
          adopted_content_ref: String.t() | nil,
          author_content_registration: boolean(),
          author_content_source_ref: String.t() | nil,
          explore_request: %{tool: String.t(), query: String.t()} | nil,
          candidate_directions: [map()],
          candidate_directions_present: boolean(),
          narrative: String.t(),
          narrative_source: map() | nil,
          provider_call_count: pos_integer()
        }

  @spec tool_name() :: String.t()
  def tool_name, do: @judgment_tool_name

  @spec continuation_tool_name() :: String.t()
  def continuation_tool_name, do: @continuation_tool_name

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

  @doc """
  执行判断②两段式调用（ADR-0025 观察 + 续行；CP2 探针裁决：独立短结构调用，
  由确定性偏离信号按需触发，不内联在执行调用里）。

  `input` 至少含 `:goal_text`（本轮创作目标）、`:deviation_summary`（确定性偏离
  信号摘要）与 `:observation_block`（机械汇总的当前产出观察）。返回 continuation
  map（action continue|await_author + guidance + narrative 绑定）；坏结构携带
  片段重试一次，仍坏则诚实报错（上层按 S7 收口）。
  """
  @spec request_continuation(Execution.dependency(), map(), map()) ::
          {:ok, map()} | {:error, term()}
  def request_continuation(provider_execution, snapshot \\ %{}, input) do
    with {:ok, narrative_fn} <- result_fn(provider_execution, snapshot, :author_reasoning),
         {:ok, decision_fn} <- result_fn(provider_execution, snapshot, :planner),
         {:ok, narrative, narrative_result} <-
           request_narrative(continuation_narrative_prompt(input), narrative_fn) do
      request_continuation_decision(%{
        prompt: continuation_decision_prompt(input, narrative),
        result_fn: decision_fn,
        narrative: narrative,
        narrative_result: narrative_result,
        attempt: 1,
        retry?: true
      })
    end
  end

  defp request_continuation_decision(%{prompt: prompt, result_fn: result_fn} = request) do
    case result_fn.(prompt) do
      {:ok, provider_result} -> parse_continuation(provider_result, request)
      {:error, reason} -> {:error, reason}
    end
  end

  defp parse_continuation(provider_result, request) do
    arguments =
      provider_result
      |> tool_calls()
      |> Enum.find_value(fn call ->
        if map_get(call, :name) == @continuation_tool_name,
          do: normalize_arguments(map_get(call, :arguments))
      end)

    with %{} = arguments <- arguments,
         action when is_binary(action) <- map_get(arguments, :action),
         true <- action in @continuation_actions do
      build_continuation(arguments, action, provider_result, request)
    else
      _ -> continuation_retry_or_fail(provider_result, request)
    end
  end

  defp build_continuation(arguments, action, provider_result, request) do
    case bind_narrative(arguments, request, provider_result) do
      {:ok, narrative, narrative_source} ->
        {:ok,
         %{
           action: action,
           guidance: map_get(arguments, :guidance) || "",
           reason: map_get(arguments, :reason) || "",
           narrative: narrative,
           narrative_source: narrative_source,
           provider_call_count: 1 + request.attempt
         }}

      {:error, reason} ->
        {:error, reason}
    end
  end

  defp continuation_retry_or_fail(provider_result, %{retry?: true} = request) do
    fragment =
      provider_result |> tool_calls() |> inspect() |> String.slice(0, 400)

    retry_prompt =
      update_in(request.prompt, [:messages], fn [message | rest] ->
        [
          %{
            message
            | content:
                message.content <>
                  "\n\n## 上次输出无法被系统解析\n" <>
                  "上一次调用返回的结构不合法（片段：#{fragment}）。" <>
                  "必须调用 #{@continuation_tool_name}，action 只能取 " <>
                  "#{Enum.join(@continuation_actions, " / ")}。"
          }
          | rest
        ]
      end)

    request_continuation_decision(%{
      request
      | prompt: retry_prompt,
        retry?: false,
        attempt: request.attempt + 1
    })
  end

  defp continuation_retry_or_fail(provider_result, _request) do
    {:error,
     {:continuation_decision_unparseable,
      provider_result |> tool_calls() |> inspect() |> String.slice(0, 200)}}
  end

  # ── call1：自由输出判断叙事（流式） ──

  # 判断调用温度为协议属性：叙事段 0.4（自然但守结构），结构段 0.2（裁决确定性）。
  # MBC 实测默认 0.7 下内联结构与 execute 边界随机摇摆（0.889~1.0），低温收敛。
  # max_tokens 不在此收窄：安全上限现归 provider 自己的配置（换模型验证时的
  # 现测属性，不是跨 provider 通用常量），用途级再掐会截断推理链（缺陷九教训，
  # 见可靠性 slice T2d、InferenceParams moduledoc）。
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

    # 纠正调用不能放宽同一输入已经识别的约束，借改字段名称放行原有矛盾。
    request =
      request
      |> Map.put(
        :record_only,
        request[:record_only] == true or map_get(arguments, :record_only) == true
      )
      |> Map.put(
        :directions_forbidden,
        request[:directions_forbidden] == true or
          (candidate_directions_present?(arguments) and
             (map_get(arguments, :action) != "reply" or
                map_get(arguments, :frame_type) != "creative_exploration"))
      )

    with %{} = arguments <- arguments,
         action when is_binary(action) <- map_get(arguments, :action),
         true <- action in actions(request.options),
         true <- capability_in_catalog?(action, arguments, request.options),
         true <- explore_tool_in_catalog?(action, arguments, request.options),
         :ok <- validate_output_boundary(arguments, request),
         :ok <-
           NovelApplication.PendingArtifactWorkflow.validate(
             arguments,
             Map.merge(
               Keyword.get(request.options, :pending_artifact_targets, %{}),
               Keyword.get(request.options, :adopted_content_targets, %{})
             )
           ),
         :ok <- validate_registration_state(arguments, request.options),
         :ok <- validate_author_registration(arguments, request.options) do
      case semantic_conflict(action, arguments, request.options) do
        nil -> build_judgment(arguments, action, provider_result, request)
        conflict -> retry_semantic_conflict(conflict, request)
      end
    else
      {:error, {:pending_artifact_invalid, reason}} ->
        retry_pending_artifact(reason, request)

      {:error, {:judgment_output_conflict, reason}} ->
        retry_output_boundary(reason, request)

      {:error, {:author_content_registration_invalid, reason}} ->
        retry_author_registration(reason, request)

      _ ->
        retry_or_fail(provider_result, request)
    end
  end

  @doc "校验模型理解的本轮约束与产出是否一致；不从作者文本做关键词路由。"
  @spec validate_output_boundary(map(), map()) :: :ok | {:error, term()}
  def validate_output_boundary(arguments, constraints \\ %{}) do
    record_only = map_get(arguments, :record_only)

    cond do
      not is_boolean(record_only) ->
        {:error, {:judgment_output_conflict, :record_only_required}}

      constraints[:record_only] == true and not record_only ->
        {:error, {:judgment_output_conflict, :record_only_conflict}}

      record_only and not record_only_reply?(arguments) ->
        {:error, {:judgment_output_conflict, :record_only_conflict}}

      candidate_directions_present?(arguments) and not direction_reply?(arguments, constraints) ->
        {:error, {:judgment_output_conflict, :candidate_purpose_conflict}}

      true ->
        :ok
    end
  end

  defp record_only_reply?(arguments) do
    map_get(arguments, :action) == "reply" and
      map_get(arguments, :frame_type) != "creative_exploration" and
      not candidate_directions_present?(arguments) and
      map_get(arguments, :author_content_registration) != true
  end

  defp direction_reply?(arguments, constraints) do
    constraints[:directions_forbidden] != true and map_get(arguments, :action) == "reply" and
      map_get(arguments, :frame_type) == "creative_exploration"
  end

  defp retry_output_boundary(reason, request) do
    LogEmit.emit(:judgment, :output_validation, :done, %{
      reason_code: reason,
      outcome: if(request.retry?, do: "retry", else: "rejected")
    })

    if request.retry? do
      hint = """
      上次判断违反本轮输出边界：#{reason}。
      重新核对作者原话和已输出叙事。record_only 必须是布尔值：仅收下资料、暂不展开时为 true。
      record_only=true 只能 reply、非 creative_exploration、candidate_directions=[]、author_content_registration=false。
      candidate_directions 只用于 reply/creative_exploration 的小说创作方向；不得装入采纳、修改、丢弃、查看等流程建议。
      流程建议留在给作者的回复中，实际操作沿现有产物按钮承接。不得仅更改 frame_type 或 record_only 来放行矛盾产出。
      """

      prompt =
        update_in(request.prompt, [:messages], fn [message | rest] ->
          [%{message | content: message.content <> "\n\n## 本轮输出边界未通过校验\n" <> hint} | rest]
        end)

      request_decision(%{request | prompt: prompt, retry?: false, attempt: request.attempt + 1})
    else
      {:error, {:judgment_output_conflict, reason}}
    end
  end

  defp validate_author_registration(arguments, options) do
    TurnInteractionService.validate_author_registration(
      arguments,
      Keyword.get(options || [], :author_content_sources, [])
    )
  end

  defp validate_registration_state(arguments, options) do
    if map_get(arguments, :author_content_registration) == true and
         map_get(arguments, :author_content_source_ref) in Keyword.get(
           options,
           :registered_sources,
           []
         ), do: {:error, {:author_content_registration_invalid, :already_materialized}}, else: :ok
  end

  defp retry_pending_artifact(reason, request) do
    LogEmit.emit(:judgment, :pending_artifact_validation, :done, %{
      reason_code: reason,
      outcome: if(request.retry?, do: "retry", else: "rejected")
    })

    if request.retry? do
      prompt =
        update_in(request.prompt, [:messages], fn [message | rest] ->
          [
            %{
              message
              | content:
                  message.content <>
                    "\n\n已有候选操作未通过校验：目标必须来自当前 pending_artifact_ref 目录，且支持该操作。不能猜测、引用已处置对象或改成重新生成绕过；不明确时 await_author 请作者指明。必须在 author_narrative 提供与纠正后动作一致的新回复，不得沿用先前尚未执行的承诺。"
            }
            | rest
          ]
        end)

      request
      |> Map.merge(%{prompt: prompt, retry?: false, attempt: request.attempt + 1})
      |> require_corrected_narrative()
      |> request_decision()
    else
      {:error, {:pending_artifact_invalid, reason}}
    end
  end

  # 来源只属于已启用的作者原文登记分支。未登记时忽略并清空该字段，避免无关字段
  # 阻断普通回复；登记时仍按当前上下文白名单校验，不把模型占位文本转成合法来源。
  defp author_content_source(arguments) do
    if map_get(arguments, :author_content_registration) == true,
      do: map_get(arguments, :author_content_source_ref),
      else: nil
  end

  # M0 缺陷修复（2026-07-19 狗粮实锤）：live 模型在续写措辞下自造目录外能力名
  # （"text_generation"）——execute 的 capability 必须在能力目录内（它选择执行
  # profile），越界与结构不合法同等处理（携带片段重试一次，仍坏走 S7 诚实失败），
  # 不得把发明的能力名放行到 dispatch 层硬失败整个 run。plan 的 capability 被
  # dispatch 忽略（真计划自带步序），不校验（live 实测模型会填 "planning" 之类
  # 占位词，连坐会把合法 plan 判死）。目录未传入（caller 不校验）时不拦。
  defp capability_in_catalog?("execute", arguments, options) do
    case Keyword.get(options || [], :capabilities) do
      capabilities when is_list(capabilities) and capabilities != [] ->
        # M2 缺陷八（2026-07-20 长跑实锤 ×3）：execute 的 capability 是必填
        # （它选择执行 profile），null 同样越界——进重试路径要求模型补填目录名。
        # 此前 is_nil 放行是误伤（本意只是目录未传时不拦）。
        nonblank(map_get(arguments, :capability)) in capabilities

      _ ->
        true
    end
  end

  defp capability_in_catalog?(_action, _arguments, _options), do: true

  # 缺陷（2026-07-20，judgment-explore-internal 场景验收实测）：与 capability
  # 同款病灶——模型编了目录外工具名（"text_search"，真实只有 prose_search/
  # chapter_read/archive_read/memory_recall）时 schema enum 未必总能拦住
  # （forced tool call 对嵌套约束执行不完整，与 call2 病灶同源），应用层校验
  # 兜底：越界即重试，不把发明的工具名放行到 ExplorationService 硬失败。
  defp explore_tool_in_catalog?("explore", arguments, options) do
    case Keyword.get(options || [], :explore_tools) do
      tools when is_list(tools) and tools != [] ->
        case map_get(arguments, :explore_request) do
          %{} = request -> nonblank(map_get(request, :tool)) in tools
          _ -> true
        end

      _ ->
        true
    end
  end

  defp explore_tool_in_catalog?(_action, _arguments, _options), do: true

  # Q3a 语义对账（P1 最小版，2026-08-31）：reason 与所选能力做一致性对账——
  # action=execute ∧ capability∈只读集 ∧ reason 含写入语义 = 自相矛盾。D8 存档
  # 五连击实锤（notes/2026-08-30-stage-session-archive-loop.md）：模型 reason 全程
  # 写对（「实际写入档案」「正式保存进作品档案」），动作却选了只读 work_archive_read，
  # 只读快照空转冒充写入。基线（同文 §8，测量先于设计）：164 次历史判定命中 5、
  # 全为真实事故、零误报。纪律定位：这是对判定的**对账兜底**，不是关键字主判
  # （README 原则 12 语义对账）；主判仍归 AI。矛盾即携带矛盾说明重试一次（复用
  # M0 结构纠正骨架层级）；重试仍矛盾按缺口诚实律走 S7 家族诚实失败——不硬执行
  # 只读调用冒充写入，也不静默放行。
  @write_intent_reason_re ~r/写入|保存|存档|落库|存入|登记进|写进/

  defp semantic_conflict("execute", arguments, options) do
    readonly = Keyword.get(options || [], :readonly_capabilities, [])
    capability = nonblank(map_get(arguments, :capability))
    reason = map_get(arguments, :reason) || ""

    if capability in readonly and Regex.match?(@write_intent_reason_re, reason) do
      %{capability: capability, reason_excerpt: String.slice(reason, 0, 120)}
    end
  end

  defp semantic_conflict(_action, _arguments, _options), do: nil

  defp retry_semantic_conflict(conflict, %{retry?: true} = request) do
    # 观测（ADR-0018 观测族）：对账拦截是显著事实——stage 类事故（D8）复盘时
    # 必须一眼可见「矛盾被拦、走了重试」，不靠 provider_call_count 反推。
    LogEmit.emit(:judgment, :semantic_conflict, :done, %{
      capability: conflict.capability,
      outcome: "retry"
    })

    retry_prompt =
      update_in(request.prompt, [:messages], fn [message | rest] ->
        [
          %{
            message
            | content:
                message.content <>
                  "\n\n## 语义对账：上次判定自相矛盾\n" <>
                  "你上次判定 action=execute、capability=#{conflict.capability}" <>
                  "（只读能力），但 reason 声称要写入（片段：#{conflict.reason_excerpt}）。" <>
                  "只读能力不能写入、保存或存档任何内容。如果作者要的是把内容写进档案：" <>
                  "已有待采纳候选时改判 reply 引导作者采纳；没有候选时改选能产出该内容" <>
                  "候选的创作能力。请重新判定。"
          }
          | rest
        ]
      end)

    request_decision(%{
      request
      | prompt: retry_prompt,
        retry?: false,
        attempt: request.attempt + 1
    })
  end

  defp retry_semantic_conflict(conflict, _request) do
    LogEmit.emit(:judgment, :semantic_conflict, :error, %{
      capability: conflict.capability,
      outcome: "still_conflicted_after_retry"
    })

    {:error,
     {:judgment_semantic_conflict,
      "capability=#{conflict.capability} reason=#{conflict.reason_excerpt}"}}
  end

  defp build_judgment(arguments, action, provider_result, request) do
    case bind_narrative(arguments, request, provider_result) do
      {:ok, narrative, narrative_source} ->
        {:ok,
         %{
           action: action,
           capability: nonblank(map_get(arguments, :capability)),
           reason: map_get(arguments, :reason) || "",
           frame_type: reply_frame_type(arguments),
           dialogue_goal: nonblank(map_get(arguments, :dialogue_goal)),
           reply_included: map_get(arguments, :reply_included) == true,
           record_only: map_get(arguments, :record_only),
           pending_artifact_ref: nonblank(map_get(arguments, :pending_artifact_ref)),
           adopted_content_ref: nonblank(map_get(arguments, :adopted_content_ref)),
           explore_request: explore_request(arguments),
           candidate_directions: candidate_directions(arguments),
           # 探索意图原始信号：字段存在且非空（哪怕结构坏了）——坏结构不丢意图，
           # 由消费层降级为应用兜底候选（S2 韧性，旧 frame 兜底语义平移）。
           candidate_directions_present: candidate_directions_present?(arguments),
           # Q3c：作者内容登记信号（模型判定，非关键字）——作者在消息里提供了
           # 具体内容并要求登记进档案时为 true，应用层据此机械物化作者字节候选。
           author_content_registration: map_get(arguments, :author_content_registration) == true,
           author_content_source_ref: author_content_source(arguments),
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
    if request.narrative != "" and request[:corrected_narrative] != true do
      with {:ok, source} <-
             AgentNarrativeSource.from_provider_result(
               request.narrative_result,
               request.narrative
             ) do
        {:ok, request.narrative, source}
      end
    else
      bind_tool_narrative(arguments, request, provider_result)
    end
  end

  defp bind_tool_narrative(arguments, request, provider_result) do
    case nonblank(map_get(arguments, :author_narrative)) do
      nil ->
        {:error, :judgment_narrative_required}

      narrative ->
        with {:ok, source} <-
               AgentNarrativeSource.from_tool_call_narrative(
                 provider_result,
                 request.prompt.tool_choice,
                 narrative,
                 :author_narrative
               ) do
          {:ok, narrative, source}
        end
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
                  "#{Enum.join(actions(request.options), " / ")}。" <>
                  capability_retry_hint(request.options) <>
                  explore_tool_retry_hint(request.options)
          }
          | rest
        ]
      end)

    request_decision(%{
      request
      | prompt: retry_prompt,
        retry?: false,
        attempt: request.attempt + 1
    })
  end

  defp retry_or_fail(provider_result, _request) do
    {:error,
     {:judgment_decision_unparseable,
      provider_result |> tool_calls() |> inspect() |> String.slice(0, 200)}}
  end

  defp retry_author_registration(reason, request) do
    LogEmit.emit(:judgment, :author_content_validation, :done, %{
      reason_code: reason,
      outcome: if(request.retry?, do: "retry", else: "rejected")
    })

    if request.retry? do
      hint =
        TurnInteractionService.author_registration_retry_hint(
          reason,
          Keyword.get(request.options || [], :author_content_sources, [])
        )

      prompt =
        update_in(request.prompt, [:messages], fn [message | rest] ->
          [%{message | content: message.content <> "\n\n## 原文登记未通过业务校验\n" <> hint} | rest]
        end)

      request = %{request | prompt: prompt, retry?: false, attempt: request.attempt + 1}

      request =
        if reason == :already_materialized,
          do: require_corrected_narrative(request),
          else: request

      request_decision(request)
    else
      {:error, {:author_content_registration_invalid, reason}}
    end
  end

  defp require_corrected_narrative(request) do
    request
    |> Map.put(:corrected_narrative, true)
    |> update_in(
      [:prompt, :tools, Access.at(0), :input_schema, :required],
      &Enum.uniq(&1 ++ ["author_narrative"])
    )
  end

  # ── prompt 构造（探针与生产共用同一真源） ──

  @doc "判断② call1 自由输出 prompt：观察叙事（作者可见，46§9.4 体裁）。"
  @spec continuation_narrative_prompt(map()) :: map()
  def continuation_narrative_prompt(input) do
    %{
      messages: [
        %{
          role: "user",
          content: """
          #{continuation_common_prefix()}

          当前创作执行出现了需要你判断的情况，你要观察现状并决定续行方式，向作者说明。

          ## 本轮创作目标
          #{Map.fetch!(input, :goal_text)}

          ## 出现的情况（系统确定性核对结果）
          #{Map.fetch!(input, :deviation_summary)}

          ## 当前产出观察
          #{Map.get(input, :observation_block) || "（暂无产出观察）"}

          ## 判别规则（容易摇摆的边界）
          - 质量复核给出了可执行的修改意见 → 继续执行（按意见修正重新产出）。
          - 计划步骤走完但目标产出还没生成（缺产出步）→ 继续执行（补上产出步就能完成，
            不需要作者介入）。
          - 工具或模型连续调用失败（连接错误、反复超时）→ 停下来等作者：失败原因不在
            你的指引能修正的范围内，继续重试只会重复失败。
          - 作者请求的前提在作品里不存在（点名的章节/角色/情节缺失）→ 停下来等作者。

          ## 输出要求（会逐字实时显示给作者）
          - 用自然中文输出一段连贯的观察说明：先说你看到了什么，再说你打算怎么办、为什么。
          - 只输出观察说明；不要开始执行，不要标题、JSON、代码块或内部机器名。
          """
        }
      ],
      tools: continuation_tools(),
      tool_choice: "none"
    }
  end

  @doc "判断② call2 强制 tool call prompt：轻量续行结构。"
  @spec continuation_decision_prompt(map(), String.t()) :: map()
  def continuation_decision_prompt(input, narrative) do
    %{
      messages: [
        %{
          role: "user",
          content: """
          #{continuation_common_prefix()}

          你刚才已向作者输出了观察说明（如下）。现在把续行判断结构化。

          ## 本轮创作目标
          #{Map.fetch!(input, :goal_text)}

          ## 出现的情况
          #{Map.fetch!(input, :deviation_summary)}

          ## 你已输出的观察说明
          #{clip_echo(narrative)}

          ## 输出格式
          - native tool call：必须调用 #{@continuation_tool_name}，把判断放入 tool arguments。
          - action：continue（继续执行，下一次执行按 guidance 修正）｜ await_author（停下来等作者裁决）。
          - guidance：action=continue 时，给下一次执行的一句修正指引；await_author 时留空。
          - author_narrative：若你在上一步没有输出观察说明，在此补写一段作者可见原文。
          """
        }
      ],
      tools: continuation_tools(),
      tool_choice: @continuation_tool_name
    }
  end

  defp continuation_common_prefix do
    """
    本次你承担创作判断器的角色。

    ## 你的两种续行方式
    - 继续执行：情况可以由你在下一次执行中修正（比如按质量意见改进产出）。
    - 停下来等作者：情况需要作者裁决（前提缺失、方向分歧、风险超出你能处理的范围）。
    """
  end

  defp continuation_tools do
    [
      %{
        name: @continuation_tool_name,
        description: "Structure the continuation judgment for the creative loop.",
        input_schema: %{
          type: "object",
          properties: %{
            action: %{type: "string", enum: @continuation_actions},
            guidance: %{anyOf: [%{type: "string"}, %{type: "null"}]},
            reason: %{type: "string"},
            author_narrative: %{anyOf: [%{type: "string"}, %{type: "null"}]}
          },
          required: ["action", "reason"]
        }
      }
    ]
  end

  # VS-00I CP-C：判断 call1/call2 的 L1 公共前缀（角色句 + 能力目录）。
  # 两段调用共享这一字节前缀，且 context_block（L2/L3）紧随其后，使调用对与
  # 连续两轮的缓存前缀覆盖 L0–L2。目录文本是 D8 判例载体，原样从
  # DialoguePlanningService 迁入（只换位置，不改措辞）。
  defp judgment_l1_prefix do
    """
    本次你承担创作判断器的角色。

    ## 可用能力（判断"单动作执行"或"制定计划"时的目标集）
    - character_design：设计新角色/反派（产出待采纳候选）
    - character_evolution：更新角色当前状态、关系变化（产出待采纳演化记录）
    - prose_writing：写/续写章节正文（产出待采纳草稿）
    - plot_outline：规划章节大纲、卷纲、分章结构（产出待采纳大纲）
    - world_building：世界观、设定、伏笔、写作规则（产出待采纳设定）
    - work_archive_read：只读查看作品档案（角色列表、结构、统计；不产出候选，
      **不能保存/存档/写入任何内容**——名字里的 archive 是「档案」不是「存档」动作）
    - revise_pending_artifact：按作者要求修订已有待采纳对象，生成独立候选；原稿保留、不自动采纳。必须填 pending_artifact_ref。
    - discard_pending_artifact：执行作者明确要求的放弃，只改变已绑定候选状态、不删除作品事实。必须填 pending_artifact_ref。

    判例（D8 止血，2026-08-30 stage 实锤）：作者要求「把 XX 存档/保存为设定/写入档案」时，
    本系统的写入只有一条路=待采纳候选经作者采纳。若对话中已有待采纳候选，选直接回复并
    明确引导作者去候选卡采纳；若还没有候选，选 world_building（或对应类型能力）把内容
    整理为待采纳候选。**绝不选 work_archive_read**——它读不了愿望也存不了任何东西。
    """
    |> String.trim()
  end

  @doc "call1 自由输出 prompt：判断叙事 + 直接回复内联（46§9.4 意图段体裁）。"
  @spec narrative_prompt(map()) :: map()
  def narrative_prompt(input) do
    %{
      messages: [
        %{
          role: "user",
          content: """
          #{judgment_l1_prefix()}

          #{Map.fetch!(input, :context_block)}

          作者刚发来一条输入，你要判断本轮的形态并向作者说明。

          ## 作者输入
          #{Map.fetch!(input, :author_text)}

          #{forms_section(input)}

          #{TurnInteractionService.author_registration_rules()}

          ## 判别规则（容易混的边界）
          - 作者本轮仅交付资料、要求先收下而不要展开或生成候选时，只确认收到；不要追加方向、
            创作建议或操作菜单。约束仅限本轮，后续明确要求展开时仍应主动协助创作。
          - 创作方向是人物、冲突、叙事、世界观等内容上的取舍；采纳、修改、丢弃、查看等是
            协作流程。需要引导时自然说明可行路径；已有候选的实际处理沿候选卡按钮进行。
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
          - 说明当前拟议路径，未获得执行结果或采纳事实前不宣称操作已经完成。
          - 不要标题、JSON、代码块或内部机器名。
          """
        }
      ],
      tools: Map.fetch!(decision_prompt(input, ""), :tools),
      tool_choice: "none"
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
          #{judgment_l1_prefix()}

          #{Map.get(input, :context_block, "")}

          你刚才已向作者输出了判断说明（如下）。本次调用：把判断说明中的
          裁决结论填进结构化字段。action 填的是【系统接下来对作者请求做什么】，不是你本次调用在做什么。

          ## 作者输入
          #{Map.fetch!(input, :author_text)}

          ## 你已输出的判断说明（超长截断，只作参照）
          #{clip_echo(narrative)}

          #{Map.get(input, :author_content_context, "")}

          #{TurnInteractionService.author_registration_rules()}

          ## 结论→action 映射（按判断说明的结论逐条对照）
          - 原文登记与采纳状态分支先按上方业务规则处理，不因说明中的形态词改为创作重写。
          - 其余请求的判断说明结论是"单动作执行/生成正文/执行创作" → action=execute（capability 按目录填）。
          - 结论是"需要先检索/查证" → action=explore。
          - 结论是"需要多步计划" → action=plan。
          - 原文登记，或直接文字回复即可满足作者 → action=reply。
          - 结构化填槽本身不是业务操作，不能因为本次是在填写结构就把其它业务动作改为 reply。

          ## 输出格式
          - native tool call：必须调用 #{@judgment_tool_name}，把判断放入 tool arguments。
          - action：#{actions_help(opts)}。
          - execute 时 #{capability_help(opts)}；plan 及其它 action 的 capability 填 null#{explore_capability_note(opts)}。
          - reply_included：action=reply 且判断说明已包含给作者的回复正文时为 true。
          - record_only：本轮作者只要求收下资料、不展开、不产生任何候选时为 true；
            此时只能 reply，选择非探索帧、candidate_directions=[]、author_content_registration=false。
            普通讨论、状态追问或后续明确要求生成/登记时为 false；“不要正文”不等于禁止讨论创作方向。
          - frame_type：action=reply 或 await_author 时，从
            casual_reply / creative_exploration / question_answer / meta_discussion /
            capability_gap 中选择；其它 action 置 null。创作方向候选属于
            creative_exploration；回答作者关于作品、系统或写作过程的问题属于
            question_answer；讨论工作台流程或下一步协作方式属于 meta_discussion；
            作者要求的动作系统当前没有能力承接（如直接写入/导出/删除档案）时属于
            capability_gap——回复必须显式承认做不到什么，并给出最近可行路径（已有
            待采纳候选就引导作者采纳；没有就说明可先把内容整理成待采纳候选），此时
            由回复叙事说明路径，candidate_directions 留空；其余普通回应属于 casual_reply。
          - author_content_registration：作者要求把自己提供的具体创作原文登记为候选时为 true，
            包括本条原文，或消息处置上下文明确列出的历史原文。此时选择 reply/capability_gap，
            说明原文会成为待采纳候选；不得调用创作工具重写原文。已有同来源候选则引导采纳，
            已采纳则据事实回应，不重复生成。来源不明确时 await_author 追问。
          - author_content_source_ref：本条原文填 current；历史原文填已列出的 turn_ref，
            不能填不存在或其他作品的编号。只说“存档”但原文在历史消息时，必须选择历史来源。
            登记时必填明确来源；不登记原文时为 null。缺失来源不能默认为 current。
          - dialogue_goal：用一句简短中文概括作者本轮目标；不得写系统执行步骤或内部推理。
            修改已有候选时须展开“刚才”等指代，写明具体修改内容，供执行工具消费；若缺少依据无法确定要求，await_author 请作者澄清，不能让执行器猜测。
          - pending_artifact_ref：修改/放弃已有候选时，action=execute、capability 分别为
            revise_pending_artifact / discard_pending_artifact，引用消息处置上下文中的真实 artifact_ref。
            不可拿原文 turn_ref 当候选编号。目标不明确时 await_author，不能猜最新一份。
            修订会产生独立待采纳版本并保留原稿，不自动保存；放弃不删除已采纳作品事实。
            其它操作填 null。只使用消息处置或探索观察中列出的对象编号及其 available_operations；
            摘要省略了目标时先用 session_adoptions 查询，不猜编号。
          - adopted_content_ref：修订已采纳内容时，action=execute、capability=revise_adopted_content，
            引用 resolved 中真实 ACCEPTED/EDITED_ACCEPTED 的 artifact_ref。会生成独立修订候选，
            作者确认后才替代旧版；不要用新建候选绕过，也不要直接改档案。目标不明确时 await_author，
            不能猜；其它操作填 null。只使用 resolved 中列出的对象编号及其 available_operations。
            不得声称系统没有修订能力，也不得引导作者使用档案里不存在的“修改后保存”。
          - candidate_directions：仅 action=reply 且 frame_type=creative_exploration 时可携带
            小说内容的创作方向（每项 {title, pitch, tone_tags}）；其它情况必须为空数组。
            采纳、修改、丢弃、查看档案等操作不是创作方向；不要为了显示这些建议改判探索。
          - explore_request：action=explore 时必填 {tool, query}——#{explore_tool_help(opts)}，
            query 按该工具的 query 说明填写；其它 action 置 null。
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
              capability: capability_schema(opts),
              frame_type: %{
                anyOf: [
                  %{type: "string", enum: @reply_frame_types},
                  %{type: "null"}
                ]
              },
              dialogue_goal: %{anyOf: [%{type: "string"}, %{type: "null"}]},
              reply_included: %{type: "boolean"},
              record_only: %{type: "boolean"},
              pending_artifact_ref: %{anyOf: [%{type: "string"}, %{type: "null"}]},
              adopted_content_ref: %{anyOf: [%{type: "string"}, %{type: "null"}]},
              author_content_registration: %{type: "boolean"},
              author_content_source_ref: %{
                anyOf: [
                  %{
                    type: "string",
                    enum: ["current" | Keyword.get(opts, :author_content_sources, [])]
                  },
                  %{type: "null"}
                ]
              },
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
              explore_request: %{
                anyOf: [
                  %{
                    type: "object",
                    properties: %{
                      tool: explore_tool_schema(opts),
                      query: %{type: "string"}
                    },
                    required: ["tool", "query"]
                  },
                  %{type: "null"}
                ]
              },
              author_narrative: %{anyOf: [%{type: "string"}, %{type: "null"}]}
            },
            # T4 残余收口（M4 狗粮实锤，2026-07-29）：capability 此前是可选字段，
            # 强制工具调用只保证 required 字段出现——模型填完 required 就交差，
            # capability 整键缺失（13/13 失败样本全缺），prompt 目录段与重试提示
            # 都压不住（都不改变"可以不填"这个结构事实），execute 判定越界后
            # 重试仍缺 → run_failed 风暴。列入 required 后模型必须给出该键；
            # schema 本身允许 null（anyOf 含 null），plan/reply 显式填 null 不受影响。
            required: [
              "action",
              "reason",
              "frame_type",
              "dialogue_goal",
              "capability",
              "record_only"
            ]
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

  # T2b（call2 病灶结构性收口）：结构化调用的叙事回显封顶——call2 只需登记参照，
  # 全文已在 call1 流式呈现；长回显是上下文负载与判定漂移的放大器（M2 实证）。
  @call2_echo_max_chars 240

  # 双端保留（T4 追补，2026-07-21 M2 实锤）：头部截断在叙事变长（扩章批长摘要
  # 复述）时必然剪掉尾部"判定为单动作执行"结论，call2 只见意图复述不见裁决，
  # 回落到"登记"元指令误判 reply（第18/19/21章 10 分钟 3 次，重试均纠正）。
  # 头 120 保意图起点，尾 120 保结论/内联回复尾。
  defp clip_echo(narrative) when is_binary(narrative) do
    if String.length(narrative) > @call2_echo_max_chars do
      half = div(@call2_echo_max_chars, 2)

      String.slice(narrative, 0, half) <>
        "\n…（中略）…\n" <> String.slice(narrative, -half, half)
    else
      narrative
    end
  end

  defp clip_echo(narrative), do: to_string(narrative)

  # T4（call2 病灶收口，2026-07-21）：目录名必须进 call2 prompt 正文。M2 实锤：
  # 目录只放 schema enum（且包在 anyOf 内层）时对模型不可见——全天 15 次首调
  # 0 命中 prose_writing（8 次自造名浮出 / 1 次 null / 6 次被约束解码静默顶替成
  # 任意合法枚举值），隐藏推理链明说"目录列表未给出，只能猜"；顶替后值合法导致
  # 越界重试网被绕过、误路由直通执行（对照组：直挂 enum 的 action 字段全天合法）。
  # 措辞与 capability_retry_hint 一致——带目录的重试文案 M2 全天 8/9 命中，是
  # 实证写法。干净实例 A/B 重放：旧 prompt 0/10、新 prompt 判 execute 时 4/4。
  defp capability_help(opts) do
    case Keyword.get(opts, :capabilities) do
      capabilities when is_list(capabilities) and capabilities != [] ->
        "capability 只能取 #{Enum.join(capabilities, " / ")}，不得自造能力名"

      _ ->
        "capability 填能力目录中的能力名（只能取目录名）"
    end
  end

  defp explore_tool_help(opts) do
    case Keyword.get(opts, :explore_tools) do
      tools when is_list(tools) and tools != [] ->
        "tool 只能取 #{Enum.join(tools, " / ")}，不得自造工具名"

      _ ->
        "tool 从「探索目录」选择"
    end
  end

  defp capability_retry_hint(options) do
    case Keyword.get(options || [], :capabilities) do
      capabilities when is_list(capabilities) and capabilities != [] ->
        "execute 的 capability 只能取 #{Enum.join(capabilities, " / ")}，不得自造能力名；plan 及其它 action 填 null。"

      _ ->
        ""
    end
  end

  defp explore_tool_retry_hint(options) do
    case Keyword.get(options || [], :explore_tools) do
      tools when is_list(tools) and tools != [] ->
        "explore_request.tool 只能取 #{Enum.join(tools, " / ")}，不得自造工具名（如 text_search 不存在）。"

      _ ->
        ""
    end
  end

  # capability schema：caller 传入能力目录时收紧为 enum（native tool call 强制，
  # 模型无法自造能力名——M0 缺陷第一层防线）；未传入保持自由 string 向后兼容。
  defp capability_schema(opts) do
    case Keyword.get(opts, :capabilities) do
      capabilities when is_list(capabilities) and capabilities != [] ->
        %{anyOf: [%{type: "string", enum: capabilities}, %{type: "null"}]}

      _ ->
        %{anyOf: [%{type: "string"}, %{type: "null"}]}
    end
  end

  # 缺陷（2026-07-20，judgment-explore-internal 场景验收实测）：explore_request.tool
  # 此前是裸 %{type: "string"}，模型编了个听起来合理但不存在的 "text_search"（真实
  # 工具是 prose_search），ExplorationService 拒绝执行，探索两轮空转，最终诚实回复
  # "没有检索工具"。与 capability 同款病灶（自造枚举值），同款收口：枚举收紧到
  # ExplorationService.tool_names() 真源。
  defp explore_tool_schema(opts) do
    case Keyword.get(opts, :explore_tools) do
      tools when is_list(tools) and tools != [] ->
        %{type: "string", enum: tools}

      _ ->
        %{type: "string"}
    end
  end

  # ── 工具 ──

  defp tool_calls(provider_result) do
    case map_get(provider_result, :tool_calls) do
      calls when is_list(calls) -> calls
      _ -> []
    end
  end

  # CP5 探索内部翼：action=explore 时模型在 explore_request 里点名检索工具与查询。
  # 坏结构不猜——tool/query 任一缺失即 nil，消费层按缺失诚实降级（不伪造检索）。
  defp explore_request(arguments) do
    case map_get(arguments, :explore_request) do
      %{} = request ->
        tool = nonblank(map_get(request, :tool))
        query = nonblank(map_get(request, :query))
        if tool && query, do: %{tool: tool, query: query}, else: nil

      _ ->
        nil
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

  defp reply_frame_type(arguments) do
    case nonblank(map_get(arguments, :frame_type)) do
      value when value in @reply_frame_types -> value
      _ -> nil
    end
  end

  # 套娃信封解套（与计划起草同型防护，M0 实锤类缺陷）：模型把 {name, arguments}
  # 信封复制进 arguments 时取内层；仅精确同名且内层为 map 时触发。
  defp normalize_arguments(%{"name" => name, "arguments" => inner})
       when name in [@judgment_tool_name, @continuation_tool_name] and is_map(inner),
       do: inner

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
    do: Map.get(map, key, Map.get(map, Atom.to_string(key)))

  defp map_get(_map, _key), do: nil
end
