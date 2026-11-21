defmodule NovelApplication.JudgmentProtocol do
  @moduledoc "B26/B27/B71：canonical transcript 原生多轮判断；先校验整个响应，再交业务边界派发。"
  alias NovelAgent.Provider.Execution
  alias NovelAgent.Provider.InferenceParams
  alias NovelApplication.AgentRunFlows.AuthoringSession
  alias NovelCommon.AuthorVisible.Text
  alias NovelCommon.RequestIR

  alias NovelApplication.{
    AgentNarrativeSource,
    AuthorContentRegistration,
    AuthoringOperation,
    AuthoringSessionHistory,
    AuthoringTaskPolicy,
    AuthoringTranscript,
    ChapterRevisionScope,
    CharacterProfile,
    ExplorationPolicy,
    ExplorationService,
    JudgmentToolContract,
    PendingArtifactWorkflow,
    ProviderActivityProjector,
    TurnInteractionService
  }

  require NovelTelemetry.LogEmit, as: LogEmit

  @max_attempts 2
  @pending_target_capabilities AuthoringTaskPolicy.artifact_capabilities(:pending)
  @adopted_target_capabilities AuthoringTaskPolicy.artifact_capabilities(:adopted)
  @judgment_tool_names ~w(judgment_decision ask_author agent_plan_draft register_author_content
                          propose_creative_directions propose_work_profile_revision
                          report_capability_gap)
  @error_excerpt_chars 400
  @type judgment :: map()
  def tool_name, do: "judgment_decision"
  def continuation_tool_name, do: "continuation_decision"
  def actions(_opts \\ []), do: ~w(execute explore)

  def request_judgment(provider, snapshot \\ %{}, input),
    do: request(provider, snapshot, input, :judgment)

  def request_continuation(provider, snapshot \\ %{}, input),
    do: request(provider, snapshot, input, :continuation)

  defp request(provider, snapshot, input, profile) do
    result_fn =
      provider
      |> Execution.with_purpose(:planner)
      |> Execution.with_content_visibility(:developer)
      |> Execution.with_params(InferenceParams.new(temperature: 0.2))
      |> ProviderActivityProjector.with_stage_sink(snapshot,
        purpose: :planner,
        content_visibility: :developer
      )
      |> Execution.result_fn()

    if is_function(result_fn, 1) do
      with {:ok, request_transcript, strip_history?} <-
             request_transcript(input, profile, snapshot) do
        result_fn
        |> invoke(request_transcript, input, profile, 1)
        |> strip_session_history(strip_history?)
      end
    else
      {:error, :provider_execution_required}
    end
  end

  # 步骤快照已携带会话视图，由外层 AuthoringSession 统一剥离；直接输入的历史在此
  # 按归属剥离，不保留按位置计数的第二套剥离口径。input 无显式历史时，transcript
  # 可能就是外层已组装的标记视图，原样交给外层，协议层不提前剥离。
  defp compose_session_history(transcript, _input, %{initial_session_history: history}) do
    {AuthoringSessionHistory.compose(transcript, history), false}
  end

  defp compose_session_history(transcript, input, _snapshot) do
    case Map.get(input, :session_history) do
      nil -> {transcript, false}
      history -> {AuthoringSessionHistory.compose(transcript, history), true}
    end
  end

  defp strip_session_history(result, false), do: result

  defp strip_session_history({:ok, judgment}, true) when is_map(judgment) do
    {:ok, Map.update!(judgment, :transcript, &AuthoringSessionHistory.strip_request_history/1)}
  end

  defp strip_session_history(
         {:error, reason, %{judgment_transcript: transcript} = state},
         true
       )
       when is_map(transcript) do
    {:error, reason,
     Map.put(
       state,
       :judgment_transcript,
       AuthoringSessionHistory.strip_request_history(transcript)
     )}
  end

  defp strip_session_history(result, _strip_history?), do: result

  @doc "构造当前 run 段；显式会话历史只在实际请求准备边界组装，不进入持久段。"
  @spec transcript_for_production(map(), atom()) ::
          {:ok, AuthoringTranscript.t()} | {:error, term()}
  def transcript_for_production(input, profile \\ :judgment) do
    with {:ok, transcript, _strip_history?} <-
           request_transcript(Map.delete(input, :session_history), profile, %{}),
         do: {:ok, transcript}
  end

  defp request_transcript(input, profile, snapshot) do
    # 判断入口只生成一次实际 scope；首次构造与既有 transcript 追加消费同一事实。
    scope = profile_scope(input, profile)
    base_refs = context_refs(input, :supplied_context_refs)
    scope_refs = Enum.uniq(base_refs ++ context_refs(input, :scope_source_refs))
    text = author_text(input, profile)
    source_input_ref = Map.get(input, :source_input_ref)

    with :ok <- validate_profile_capabilities(input, profile),
         {:ok, author_messages} <- RequestIR.author_input_messages(text, source_input_ref),
         true <- profile != :judgment or author_messages != [],
         {:ok, transcript} <- new_transcript(input, profile, scope, scope_refs, base_refs) do
      transcript =
        case text do
          text when is_binary(text) ->
            AuthoringTranscript.append_author_turn(
              transcript,
              text,
              source_input_ref,
              author_turn: Map.get(input, :author_turn)
            )

          nil ->
            transcript
        end

      {view, strip_history?} = compose_session_history(transcript, input, snapshot)

      {:ok, refresh_transcript(input, view, profile, scope, scope_refs, base_refs),
       strip_history?}
    else
      false -> {:error, :invalid_author_input}
      {:error, _reason} = error -> error
    end
  end

  defp validate_profile_capabilities(input, :judgment),
    do:
      AuthoringTaskPolicy.validate_judgment_options(
        Map.get(input, :options, []),
        ExplorationService.tool_names()
      )

  defp validate_profile_capabilities(_input, :continuation), do: :ok

  @doc "生产请求入口；返回已选择本次工具与 tool_choice 的 canonical IR。"
  @spec request_for_production(map(), atom()) :: RequestIR.t()
  def request_for_production(input, profile \\ :judgment) do
    with {:ok, transcript, _strip_history?} <- request_transcript(input, profile, %{}),
         {:ok, request} <- prepare_request(transcript, profile) do
      request
    else
      {:error, reason} -> raise ArgumentError, "invalid authoring transcript: #{inspect(reason)}"
    end
  end

  defp refresh_transcript(input, transcript, profile, scope, scope_refs, base_refs) do
    transcript = ensure_profile_tools(transcript, profile)
    previous = AuthoringTranscript.current_scope(transcript)
    versions = scope_versions(input, previous)

    if current_scope_owner?(transcript) and same_scope?(previous, scope, scope_refs, versions) and
         Enum.all?(base_refs, &(&1 in previous.base_refs)) do
      transcript
    else
      AuthoringTranscript.append_scope_update(transcript, scope, versions, scope_refs, base_refs)
    end
  end

  defp current_scope_owner?(transcript) do
    message = Enum.find(Enum.reverse(transcript.messages), &(&1.role == "scope_update"))
    owner = get_in(message || %{}, [:canonical_ref, :run_id])
    history_owner = AuthoringSessionHistory.session_history_run_id(message)
    (owner || history_owner || transcript.run.run_id) == transcript.run.run_id
  end

  defp same_scope?(nil, _scope, _refs, _versions), do: false

  defp same_scope?(previous, scope, refs, versions) do
    previous.content == RequestIR.scope_block(scope).content and
      RequestIR.json_value(previous.source_refs) == RequestIR.json_value(refs) and
      Map.drop(previous.versions, ["scope_revision", "change_reason"]) ==
        Map.drop(versions, ["scope_revision", "change_reason"])
  end

  defp profile_scope(input, :judgment), do: judgment_scope(input)
  defp profile_scope(input, :continuation), do: continuation_scope(input)

  defp ensure_profile_tools(transcript, profile) do
    ir =
      RequestIR.add_tools(
        RequestIR.new(%{tools: transcript.tools}),
        JudgmentToolContract.tools(profile)
      )

    %{transcript | tools: ir.tools}
  end

  defp scope_versions(input, previous) do
    revision = if previous, do: Map.get(previous.versions, "scope_revision", 0) + 1, else: 1

    reason =
      if previous,
        do: Map.get(input, :scope_change_reason) || "run_scope_changed",
        else: "initial_scope"

    run = get_in(input, [:options, :plan_run]) || %{}
    goal = Map.get(run, :goal) || %{}
    scope = Map.get(input, :scope) || %{}
    facts = field(scope, :facts) || %{}
    work = field(facts, :work) || %{}

    %{"scope_revision" => revision, "change_reason" => reason}
    |> put_version("goal", Map.get(goal, :version))
    |> put_version("work", field(work, :version))
    |> put_version("plan", Map.get(run, :plan_version))
  end

  defp context_refs(input, key) do
    Map.get(input, key, [])
    |> Enum.reject(&is_nil/1)
    |> Enum.uniq()
    |> Enum.map(&%{ref: &1})
  end

  defp put_version(versions, _key, nil), do: versions
  defp put_version(versions, key, value), do: Map.put(versions, key, value)

  @doc "把真实探索观察追加到模型已发出的 tool_call 之后。"
  @spec observation_transcript(AuthoringTranscript.t(), map(), map()) :: AuthoringTranscript.t()
  def observation_transcript(transcript, judgment, observation) do
    call_id = judgment.tool_call_id || "call_judgment_decision"

    AuthoringTranscript.append_observation(
      transcript,
      call_id,
      ExplorationService.request_observation(observation)
    )
  end

  defp prepare_request(transcript, profile) do
    with {:ok, ir} <- AuthoringTranscript.to_request_ir(transcript) do
      RequestIR.prepare_request(ir, profile_tool_options(profile))
    end
  end

  defp profile_tool_options(profile) do
    [
      tool_names: Enum.map(JudgmentToolContract.tools(profile), & &1.name),
      tool_choice: "auto"
    ]
  end

  defp invoke(fun, transcript, input, profile, attempt, previous_tools \\ []) do
    case prepare_request(transcript, profile) do
      {:ok, request} ->
        supplied_refs =
          request
          |> RequestIR.visible_observations()
          |> Enum.flat_map(& &1.source_refs)
          |> Enum.uniq()

        input = Map.put(input, :supplied_observation_refs, supplied_refs)
        invoke_prompt(fun, request, transcript, input, profile, attempt, previous_tools)

      {:error, reason} ->
        prompt_failure(reason, transcript, attempt)
    end
  end

  defp invoke_prompt(fun, request, transcript, input, profile, attempt, previous_tools) do
    case fun.(request) do
      {:ok, provider_result} ->
        provider_result = ensure_provider_call_ids(transcript, provider_result)
        transcript = AuthoringTranscript.append_provider_result(transcript, provider_result)

        validate_response(
          fun,
          transcript,
          input,
          profile,
          attempt,
          provider_result,
          previous_tools,
          request
        )

      {:error, _reason} when attempt < @max_attempts ->
        LogEmit.emit(:judgment, :provider_retry, :start, %{
          attempt: attempt,
          reason_code: "provider_request_failed"
        })

        invoke(fun, transcript, input, profile, attempt + 1, previous_tools)

      {:error, reason} ->
        failure(reason, transcript, attempt)
    end
  end

  # 请求构造失败没有真实 provider 调用；仍保留已创建的合法前缀，计数只含已发生调用。
  defp prompt_failure(reason, transcript, attempt),
    do: failure(reason, transcript, max(attempt - 1, 0))

  defp ensure_provider_call_ids(transcript, result),
    do: RequestIR.normalize_provider_result(RequestIR.call_ids(transcript.messages), result)

  defp validate_response(
         fun,
         transcript,
         input,
         profile,
         attempt,
         provider_result,
         previous_tools,
         request
       ) do
    with {:ok, judgment} <- decode(provider_result, profile, input, previous_tools, attempt),
         {:ok, judgment} <-
           CharacterProfile.bind_judgment(
             judgment,
             field(request.run, :work_id),
             RequestIR.visible_observations(request)
           ),
         {:ok, judgment} <-
           ChapterRevisionScope.bind_observed_targets(judgment, request),
         :ok <- validate_pending_clarification(judgment, input) do
      {:ok,
       judgment
       |> Map.put(:provider_call_count, attempt)
       |> Map.put(:transcript, validated_transcript(transcript, judgment))}
    else
      {:error, reason} ->
        log_output_validation(attempt, reason)

        input =
          if reason == {:character_profile_invalid, :display_identity_ambiguous},
            do: Map.put(input, :unresolved_character_display, true),
            else: input

        retry_or_reject(fun, transcript, input, profile, attempt, provider_result, reason)
    end
  end

  # 只约束本次有界纠错；角色决定必须先通过上面的真实身份/展示绑定。
  defp validate_pending_clarification(%{action: "await_author"}, _input), do: :ok

  defp validate_pending_clarification(
         %{action: "execute", capability: "revise_character_profile"},
         _input
       ),
       do: :ok

  defp validate_pending_clarification(_judgment, %{unresolved_character_display: true}),
    do: {:error, {:character_profile_invalid, :display_identity_ambiguous}}

  defp validate_pending_clarification(_judgment, _input), do: :ok

  defp retry_or_reject(fun, transcript, input, profile, attempt, provider_result, reason) do
    # ask_author 即使参数有误，纠错也不得代作者回答或推进具体候选。
    correct_or_reject(
      fun,
      transcript,
      input,
      profile,
      attempt,
      reason,
      tool_names(provider_result)
    )
  end

  defp log_output_validation(attempt, reason) do
    LogEmit.emit(:judgment, :output_validation, :done, %{
      outcome: if(attempt < @max_attempts, do: "retry", else: "rejected"),
      reason_code: validation_reason_code(reason),
      reason: inspect(reason),
      attempt: attempt
    })
  end

  defp tool_names(result) do
    (field(result, :tool_calls) || [])
    |> Enum.map(&field(&1, :name))
    |> Enum.reject(&is_nil/1)
  end

  defp correction_content(reason)
       when reason in [:author_question_content_conflict, :question_option_labels_invalid],
       do: JudgmentToolContract.question_response_guidance()

  defp correction_content(:author_narrative_content_conflict),
    do: JudgmentToolContract.legal_combination_guidance()

  defp correction_content(:author_visible_narrative_invalid) do
    "作者叙述包含内部协议字段、对象/调用标识或基线指纹。请用作者能理解的名称和自然语言重新说明，" <>
      "结构化引用仍留在对应参数；不要复述非法叙述，不改变任务、来源、目标、范围或权限。"
  end

  # M06：上一轮请求作者选择后，纠错重试不得改成推进具体候选/版本。
  defp correction_content(:await_author_unanswered) do
    "本次响应未通过契约校验：上一轮已向作者提问，但作者尚未回答/选择。" <>
      "不得推进具体候选或版本：不能 execute/revise 指向某候选，不能规划“按某候选执行”，" <>
      "也不能用 report_capability_gap 代替作者回答。请保持等待、重新做具体澄清（ask_author），或只说明仍在等待作者选择。" <>
      "保留同一作者输入、来源、目标、范围与权限，不要猜测作者选择。"
  end

  defp correction_content({:character_profile_invalid, reason}) do
    "本次角色主档案修订未通过真实来源绑定：#{inspect(reason)}。" <>
      "用 archive_read 的 characters 目录发现对象，再按真实 ref 读取详情；目录只供定位，不授予详情已读资格。" <>
      "not_observed/incomplete_observation/stale_base 需要当前实际供应的详情包含必要身份字段、当前叙事身份、采纳状态和当前指纹；" <>
      "已供应且指纹未变的历史详情可复用，未读或已被整理隐藏的材料不能冒充基线。" <>
      "display_identity_ambiguous 表示姓名、别名和身份仍无法让作者辨认对象；用 ask_author 具体澄清，或重新绑定确有可辨认事实的角色。" <>
      "对象不存在、越界或仍有歧义时具体澄清，不新建角色或以演化记忆冒充主档案修订。"
  end

  defp correction_content(:invalid_character_role) do
    "本次响应未通过契约校验：invalid_character_role（无法确定要改成的叙事角色）。" <>
      "narrative_role 只能取 PROTAGONIST/ANTAGONIST/SUPPORTING/MINOR/ENSEMBLE_POV；请用 ask_author 澄清或按作者原话选择合法值。"
  end

  defp correction_content(:exploration_continuation_mismatch) do
    "本次响应未通过契约校验：exploration_continuation_mismatch。剩余额度只允许最新 Scope 中 continuation 指定来源的精确下一页；" <>
      "保持同一工具、对象和档案面并使用 next_offset，不得重复或跳页。也可按已有证据收束并说明未读范围。"
  end

  defp correction_content(:exploration_budget_exceeded) do
    "本次响应未通过契约校验：exploration_budget_exceeded。计划中的实际读取超过当前 Scope 的剩余额度。" <>
      "请保留任务目标，将计划缩减为当前允许的读取；续页只能使用上一真实观察已经给出的 next_offset，" <>
      "不能预排依赖未来观察的页。也可依据已有材料说明结论边界和未读范围。"
  end

  defp correction_content(:exploration_not_available) do
    "本次响应未通过契约校验：exploration_not_available（本轮只读探索预算已用尽/不可用）。" <>
      "不得再请求 explore 或通过 agent_plan_draft 内联读取；请基于已有观察与覆盖事实给作者最终答复（说明已覆盖范围与未读缺口/下一步），" <>
      "或用 ask_author 做必要澄清；覆盖已充分则直接给结论。不得以过程语或空内容收束。"
  end

  defp correction_content(:discussion_only_violation) do
    "本次响应未通过契约校验：discussion_only_violation（作者本轮只要求分析/讨论，明确说先别动笔/只聊/不生成）。" <>
      "不得调用 propose_creative_directions、register_author_content 或任何生成/写入操作。" <>
      "请只在 content 里给出分析/讨论本身；不要物化候选、方向卡片或登记原文。"
  end

  # M18：指代历史材料且可探索时，先取证再问作者；纠错给出明确顺序。
  defp correction_content(:explore_before_ask_required) do
    "本次响应未通过契约校验：explore_before_ask_required（来源缺失但尚未取证就先问作者）。" <>
      "作者在指代系统可能已有的历史材料，而本轮还没有观察证据；若只读探索可用，" <>
      "必须先用 judgment_decision.explore 取证（chapter_read/prose_search 查正文原文；session_adoptions 查历史候选/登记），" <>
      "探索后仍无合法来源，再用 ask_author 具体澄清是哪条消息或请作者贴出原文；不得默认先问作者。" <>
      "保留同一作者输入、来源、目标、范围与权限，只纠正取证顺序。"
  end

  # 对象/版本证据纪律：ref 不在可见集合时，纠错必须给出“用真实 ref 或先取证/澄清”的路径。
  defp correction_content({:pending_artifact_invalid, :target_not_available}) do
    "本次响应未通过契约校验：target_not_available（引用的对象 ref 不在本轮可见目录）。" <>
      "只能引用当前上下文/观察中真实列出的 pending_artifact_ref/adopted_content_ref；" <>
      "没有真实 ref 时先 explore（session_adoptions 查候选、chapter_read/archive_read 查版本），或 ask_author 具体澄清，" <>
      "不得编造 ref、不得用标题/记忆猜 ref。" <>
      "保留同一作者输入、来源、目标、范围与权限，只纠正目标选择。"
  end

  defp correction_content(:target_ref_field_conflict) do
    "本次响应未通过契约校验：target_ref_field_conflict（目标 ref 字段不合法）。" <>
      "execute 只填一个目标 ref：待采纳候选用 pending_artifact_ref，已采纳内容用 adopted_content_ref；" <>
      "不得同时填两个，也不得把候选 ref 填进 adopted_content_ref。" <>
      "保留同一作者输入、来源、目标、范围与权限，只纠正字段与目标选择。"
  end

  # 缺失作者正文时只补当前操作所属的唯一正文，不引入第二来源。
  defp correction_content(:judgment_narrative_required) do
    "本次响应未通过契约校验：judgment_narrative_required（缺少作者可见内容）。" <>
      "纯文本回复必须给出非空 content；只输出思考、占位词或仅标点不算回复。" <>
      JudgmentToolContract.legal_combination_guidance() <>
      "保留同一作者输入、来源、目标、范围与权限，只补足实际回复。"
  end

  # M18：指代历史原文但把其它消息/指令当来源时，给出可执行的来源纠正路径。
  defp correction_content(
         {:author_content_registration_invalid, :anaphoric_current_source_requires_explicit_text}
       ) do
    "本次响应未通过契约校验：anaphoric_current_source_requires_explicit_text（作者在指代过去的资料，current 不是合法来源）。" <>
      "current 只适用于本条消息本身就是被登记原文。请选择其一：改用已列出的合法历史来源，且仅当该来源完整原文就是作者指代的资料；用 judgment_decision.explore 取证合法来源；或用 ask_author 请作者指出来源/贴出原文。" <>
      "不得把历史指令、会话摘要或保存指令当作原文，也不得先登记再说明来源不含内容。" <>
      "保留同一作者输入、来源、目标、范围与权限，只纠正来源选择。"
  end

  # invalid_tool_combination 是模型最容易重复的协议错误：纠错回执必须给出可执行的
  # 合法组合指引（同源 helper），让一次纠错可修复；其它 reason 文案保持不变。
  defp correction_content(:invalid_tool_combination) do
    "本次响应未通过契约校验：invalid_tool_combination（工具组合非法）。" <>
      JudgmentToolContract.legal_combination_guidance() <>
      "保留同一作者输入、来源、目标、范围与权限，只纠正工具组合；不要扩大操作或复述失败响应。"
  end

  defp correction_content({:invalid_tool_combination, _detail}),
    do: correction_content(:invalid_tool_combination)

  defp correction_content({:invalid_tool_arguments, detail}),
    do: JudgmentToolContract.invalid_arguments_guidance(detail)

  # B82 G2：绑定原因已进 native validation_result；这里只给一段可操作的共用纠错，
  # 不为每个 reason 复制整套规则。
  defp correction_content({:target_segments, reason}) do
    "本次响应未通过契约校验：target_segments（#{inspect(reason)}）。" <>
      NovelApplication.JudgmentDecisionToolContract.schema_for_action("execute").properties.target_segment_ids.description <>
      "保留同一作者输入、来源、目标、范围与权限，只纠正目标选择。"
  end

  defp correction_content(reason) do
    "本次响应未通过契约校验：#{inspect(reason) |> String.slice(0, @error_excerpt_chars)}。" <>
      "保留同一作者输入、来源、目标、范围与权限，只纠正不合法结构；不要扩大操作或复述失败响应。"
  end

  # 原探索收束/空叙述特例不扩张叙述违规或未决角色歧义的普通纠错预算。
  defp correct_or_reject(fun, transcript, input, profile, attempt, reason, previous_tools)
       when attempt < @max_attempts or
              (reason in [:exploration_not_available, :judgment_narrative_required] and
                 attempt < @max_attempts + 1 and
                 not is_map_key(input, :unresolved_character_display)) do
    invoke(
      fun,
      correction_transcript(transcript, reason),
      input,
      profile,
      attempt + 1,
      previous_tools
    )
  end

  defp correct_or_reject(_, transcript, _, _, attempt, {family, _} = reason, _previous_tools)
       when family in [:author_content_registration_invalid, :pending_artifact_invalid],
       do: reject(reason, reason, transcript, attempt)

  defp correct_or_reject(
         _,
         transcript,
         _,
         _,
         attempt,
         {:invalid_tool_arguments, detail},
         _previous_tools
       ),
       do:
         reject(
           {:judgment_protocol_violation, :invalid_tool_arguments},
           {:invalid_tool_arguments, detail},
           transcript,
           attempt
         )

  defp correct_or_reject(_, transcript, _, _, attempt, reason, _previous_tools),
    do: reject({:judgment_protocol_violation, reason}, reason, transcript, attempt)

  # 终局拒绝也走同一个失败出口：先按既有 correction_transcript 闭合末次真实调用，
  # 再把最新会话与本次调用数放进 error3；reason 只保留结构类别。
  defp reject(return_reason, close_reason, transcript, attempt) do
    failure(return_reason, correction_transcript(transcript, close_reason), attempt)
  end

  defp failure(reason, transcript, actual_calls) do
    {:error, reason,
     AuthoringSession.failure_state(%{
       transcript: transcript,
       provider_call_count: actual_calls
     })}
  end

  defp correction_transcript(transcript, reason) do
    detail = %{message: correction_content(reason), reason: inspect(reason)}

    case pending_call_ids(transcript) do
      [] -> AuthoringTranscript.append_application_notice(transcript, correction_content(reason))
      ids -> close_calls(transcript, ids, "failed", validation_reason_code(reason), detail)
    end
  end

  # 求证调用由真实 observation 闭合；其它操作这里只确认协议有效，后续仍逐步过业务门。
  defp validated_transcript(transcript, %{action: "explore"}), do: transcript

  # 计划调用在校验后闭合；后续真实读取沿既有应用 Scope 材料桥接追加。
  defp validated_transcript(transcript, %{action: "plan"} = judgment),
    do: validate_inline_plan_call(transcript, judgment)

  defp validated_transcript(transcript, _judgment), do: complete_validation(transcript)

  defp validate_inline_plan_call(transcript, %{plan_result: %{plan: plan}} = judgment) do
    call = inline_plan_call(judgment.provider_result)

    AuthoringTranscript.append_validation(
      transcript,
      field(call, :id),
      "passed",
      "agent_plan_validated",
      %{
        plan_ref: plan.plan_id,
        plan_version: plan.version,
        execution_authorized: false,
        canon_written: false
      }
    )
  end

  defp validate_inline_plan_call(transcript, _judgment), do: transcript

  @doc "应用分流完成后，闭合尚未由真实观察返回的协议调用；不表示执行批准。"
  @spec complete_validation(AuthoringTranscript.t()) :: AuthoringTranscript.t()
  def complete_validation(transcript),
    do: validate_calls(transcript, pending_call_ids(transcript))

  defp validate_calls(transcript, ids) do
    close_calls(transcript, ids, "passed", "judgment_validated", %{
      execution_authorized: false,
      canon_written: false
    })
  end

  defp pending_call_ids(transcript) do
    {:ok, ir} = AuthoringTranscript.to_request_ir(transcript)
    {:ok, ids} = RequestIR.pending_call_ids(ir)
    ids
  end

  defp close_calls(transcript, ids, status, reason, detail) do
    Enum.reduce(ids, transcript, fn id, current ->
      AuthoringTranscript.append_validation(current, id, status, reason, detail)
    end)
  end

  defp validation_reason_code({:invalid_tool_arguments, _detail}), do: "invalid_tool_arguments"
  defp validation_reason_code({_, reason}) when is_atom(reason), do: Atom.to_string(reason)
  defp validation_reason_code(reason) when is_atom(reason), do: Atom.to_string(reason)
  defp validation_reason_code(_), do: "invalid_response"

  defp new_transcript(input, profile, scope, scope_refs, base_refs) do
    case Map.get(input, :transcript) do
      nil ->
        run = get_in(input, [:options, :plan_run]) || %{}

        envelope =
          run
          |> RequestIR.run_envelope()
          |> put_scope_work_id(Map.get(input, :scope) || %{})

        transcript =
          AuthoringTranscript.new(envelope,
            base_text: application_base_text(profile),
            system:
              RequestIR.system_envelope(
                instructions: ir_base_text(input, profile),
                constitution_version: AuthoringTaskPolicy.version(),
                output_protocol_version: JudgmentToolContract.version()
              ),
            author_text: author_text(input, profile),
            allow_authorless: profile != :judgment,
            author_turn_ref: Map.get(input, :source_input_ref),
            author_turn: Map.get(input, :author_turn),
            initial_scope: %{
              content: scope,
              versions: scope_versions(input, nil),
              source_refs: scope_refs
            },
            base_refs: base_refs,
            tools: JudgmentToolContract.tools(profile),
            # 投影不携带供应商/能力/目标；Gateway 按实际 route 派生能力事实。
            projection: %{}
          )

        run_id = Map.get(envelope, :run_id)

        with true <- is_binary(run_id) and String.trim(run_id) != "",
             {:ok, _ir} <- AuthoringTranscript.to_request_ir(transcript) do
          {:ok, transcript}
        else
          false -> {:error, :missing_run_envelope}
          {:error, _reason} = error -> error
        end

      transcript ->
        # 既有 transcript 只走追加规则；initial_scope 仅在首次构造时使用。
        {:ok, transcript}
    end
  end

  defp application_base_text(:judgment) do
    RequestIR.application_base_text() <>
      AuthoringTaskPolicy.judgment_definitions(ExplorationService.catalog())
  end

  defp application_base_text(:continuation), do: RequestIR.application_base_text()

  defp put_scope_work_id(envelope, scope) do
    case field(scope, :work_id) do
      nil -> envelope
      work_id -> Map.put_new(envelope, :work_id, work_id)
    end
  end

  defp author_text(input, _profile), do: Map.get(input, :author_text)

  # 稳定协议与运行事实分层；动态事实只能通过 scope_update 追加。
  defp ir_base_text(_input, :judgment), do: judgment_base_text() <> judgment_output_text()
  defp ir_base_text(_input, :continuation), do: continuation_base_text()

  defp judgment_base_text do
    """
    本次你直接与作者讨论作品，依据已知材料回应创作目标并选择下一步。
    #{AuthoringTaskPolicy.rules()}
    #{AuthoringTaskPolicy.judgment_operation_rules()}
    #{AuthorContentRegistration.author_registration_rules()}
    #{TurnInteractionService.context_rules()}
    #{AuthoringTaskPolicy.judgment_scope_rules()}
    """
  end

  defp judgment_scope(input) do
    options = Map.get(input, :options, [])
    run = Keyword.get(options, :plan_run, %{})
    goal = Map.get(run, :goal, %{})

    input
    |> Map.fetch!(:scope)
    |> Map.put(:goal, %{
      provenance: "application",
      version: field(goal, :version),
      source_input_ref: Map.get(input, :source_input_ref)
    })
    |> Map.put(:operation, %{
      available_operations: Keyword.get(options, :capabilities, []),
      pending_artifact_targets: Keyword.get(options, :pending_artifact_targets, %{}),
      adopted_content_targets: Keyword.get(options, :adopted_content_targets, %{}),
      registered_sources: Keyword.get(options, :registered_sources, []),
      author_content_sources: ["current" | Keyword.get(options, :author_content_sources, [])],
      exploration: %{
        allowed: Keyword.get(options, :explore, false),
        tools: Keyword.get(options, :explore_tools, []),
        budget: Keyword.get(options, :exploration_budget, %{})
      }
    })
    |> AuthoringOperation.runtime_scope(run)
  end

  defp judgment_output_text do
    """
    ## 决策与输出契约
    普通问答或分析整段 content 就是回复，无需调工具，无固定开场或空行格式。
    需要可点击创作方向时用 propose_creative_directions；作者明确要求修订作品立项字段时用 propose_work_profile_revision（显式 field/value，一条只提一个字段）；原文物化用 register_author_content；
    真实缺少操作效果用 report_capability_gap；需要作者决定仅用 ask_author，可不给选项。
    单个创作产物用 judgment_decision.execute，capability 必须在本轮目录；只读取证仅用
    judgment_decision.explore + explore_request{tool,query}，不能直接调用探索目录里的 native tool。
    多个相互依赖的产物/阶段才用 agent_plan_draft，单次调用给出完整计划。
    #{JudgmentToolContract.legal_combination_guidance()}
    内容修订（execute capability=revise_adopted_content）最小示例：
    {"action":"execute","capability":"revise_adopted_content","adopted_content_ref":"<本轮可选目标里的真实章级/pending ref>","dialogue_goal":"只改第一段，其余段落保持原样","author_reasoning":"..."}
    范围写在 dialogue_goal；不要填 target_chapter_ref/modification_scope 等候选 payload 字段（judgment_decision schema 不允许）。
    模型工具调用不代表执行授权。
    纯文本回复必须给出非空 content（只输出思考/占位词不算回复）；
    具有作者交付职责的工具按当前契约提供唯一正文。#{JudgmentToolContract.question_response_guidance()}
    覆盖事实约束：若本轮观测明确显示章节正文未覆盖末页（覆盖事实显示“未读>0”），
    不得声称已读全章或全章无矛盾；必须继续读取，或在结论中明确已覆盖范围与未读缺口。
    最终答复收束：作者正文必须给出可直接阅读的结论，不得只写内部推理或空泛过渡语；
    方向/比较/状态核对类请求应包含实际方向内容、比较依据与建议，或明确核对结论及正文证据。
    用 propose_creative_directions 时 author_reasoning 应逐条说明每个方向的标题与一句话走向（至少 2 条），
    不能只概述“我给出三个方向”，也不能用“你的请求属于创作方向讨论”这类元描述代替实际内容。
    作者只要求收下资料/只聊不展开时：只简短确认收到，不追加下一步菜单、方向提示或可做动作清单
    （零方向菜单、零候选/登记）。
    完整计划由 agent_plan_draft 的独立参数契约承载。
    能力缺口判断只看“是否存在能产出目标效果的最接近可行操作”：存在可产出的修订/生成候选（只是不能保证
    某些属性，如仅排版的字句不变）时，应执行该操作并在可见文本如实说明限制，不得用 report_capability_gap
    或“没有能力”拒绝；确实没有任何可行操作时才报缺口。
    修改已有对象的主档案/权威字段（如把已有角色改成主角/改身份）而目录没有对应能力时，缺口说明不得把
    “新建同名对象”“演化/记忆候选”列为实现该效果的最近路径或建议——它们不改变原对象主档案，属于不同效果；
    如需提及只能明确说明差别，不能说“新建档案后他就是主角/就实现了修改”。
    作者明确“先别动笔/只聊/讨论/分析”且没有要求生成或登记时，属于分析任务：不得调用
    propose_creative_directions、register_author_content 或任何生成/写入操作；只在 content 给分析内容。
    分析/讨论类任务且系统已有充分事实（章节统计/索引/已给材料/最近观察）时直接 reply，
    不要为形式 explore 正文；只有质量/矛盾/覆盖结论确实需要正文时才 chapter_read/archive_read。
    工具调用必须使用原生 tool_calls；不得把“<tool_call>/<function=...>”这类伪工具文本写进 content
    （会被丢弃并触发纠错），也不得用伪工具文本代替作者可见答复。
    待采纳候选唯一且作者明确要修改它时，直接 execute revise_pending_artifact，不要先 explore；
    explore 只用于对象/版本不明；探索确认对象后必须继续执行修订，不得只描述计划或规则就结束。
    上一轮向作者提问后尚未收到作者回答/选择时，不得推进具体候选或版本：不得 execute/revise 指向某候选，
    不得规划“按某候选执行”，也不得用 report_capability_gap 代替作者回答；应保持等待、重新做具体澄清，
    或只说明仍在等待作者选择。不得把未回答当默认选择。
    继续读取不是最终答复：读完后必须在本轮给出覆盖范围+结论（或明确缺口+下一步），不得只回“已继续读取/再给结论”
    这类过渡语结束。
    禁止用“-”“—”“…”或仅标点/空白的占位内容作为最终答复；覆盖不足时继续读取，或明确已覆盖范围+未读缺口+下一步。
    探索预算已用尽/不可用时不得再请求 explore；直接基于已有观察与覆盖事实 reply（已覆盖范围+结论
    或缺口+下一步），或做必要澄清。
    多意图请求（如“当前最终用哪一版”+“再写一段”）必须逐项回应：最终答复先回答版本/事实问题
    （例如当前最终版本是 EDITED_ACCEPTED 还是被 SUPERSEDED），再给生成/续写结果；不得只用“已生成草稿”结束。
    作者要求仅排版且存在可修订候选时，应执行 revise_pending_artifact（B28 format_only 边界在可见文本如实说明），
    不要只解释或报缺口。
    能力缺口优先：作者要求的效果（例如修改已有角色身份主档案、整章排版并保证字句不变）
    在当前可用操作目录里确实没有对应能力时，必须用 report_capability_gap 说明缺失效果与最近可行路径；
    不得用 ask_author 问“你要哪一种”来代替缺口报告，也不得用近似操作冒充。
    ask_author 只用于需要作者裁决方向/对象/范围且材料无法消歧，不是能力缺口的替代品。
    已有候选优先：pending_adoptions 中存在候选且本轮作者明确要对某个已有候选做修改/整理/排版/润色时，
    直接选择 revise_pending_artifact 并用 artifact_ref 引用该候选，不要先 ask_author。
    候选正文预览可能为空，不代表对象不存在——修订工具会读取真实候选全文；只有对象/范围确实无法消歧时才问。
    """
  end

  defp continuation_base_text do
    """
    #{AuthoringTaskPolicy.rules()}
    本次根据真实产出与偏离判断是否继续当前任务，不再重复初始判断。
    可以按已有事实修正时用 continuation_decision，action=continue 并给具体 guidance。
    只有需要作者决定时用 ask_author；真正缺少能力效果用 report_capability_gap。
    一次只返回一个工具，不能只给文本，不把应用故障或预算停止伪造成作者问题。
    content 必须为 null 或空字符串；ask_author 的 question 是唯一问题正文，其他工具的 author_reasoning 是唯一作者说明。#{JudgmentToolContract.question_response_guidance()}
    """
  end

  defp continuation_scope(input) do
    run = get_in(input, [:options, :plan_run]) || %{}

    %{
      work_id: field(run, :work_id),
      goal: field(run, :goal),
      context: %{
        provenance: "application",
        derived: true,
        deviation_summary: Map.fetch!(input, :deviation_summary),
        observation_summary: Map.get(input, :observation_block)
      }
    }
    |> Map.reject(fn {_key, value} -> is_nil(value) end)
    |> Jason.encode!()
    |> Jason.decode!()
  end

  defp decode(result, profile, input, previous_tools, attempt) when is_map(result) do
    calls = field(result, :tool_calls) || []

    options =
      input
      |> Map.get(:options, [])
      |> Keyword.put(
        :author_text,
        Map.get(input, :author_text) || ""
      )
      |> Keyword.put(:observation_count, length(Map.get(input, :observations) || []))
      |> Keyword.put(:previous_attempt_tools, previous_tools)
      |> Keyword.put(:attempt, attempt)
      |> Keyword.put(:profile, profile)
      |> Keyword.put(
        :discussion_only,
        AuthoringTaskPolicy.discussion_only?(Map.get(input, :author_text) || "")
      )

    with :ok <- validate_tools(calls, profile),
         {:ok, operation, args, call} <- operation(calls, profile),
         {:ok, args} <- {:ok, sanitize_operation_args(operation, args, options)},
         {:ok, text, source} <- narrative(operation, result, call, args),
         :ok <- validate_operation(operation, args, options) do
      judgment = normalized(operation, args, call, result, text, source, input)
      validate_inline_plan(judgment, input)
    end
  end

  defp decode(_, _, _, _, _), do: {:error, :invalid_judgment_result}

  defp validate_tools(calls, profile) do
    case JudgmentToolContract.validate(calls, profile) do
      {:error, :invalid_tool_arguments} -> registration_schema_error(calls, profile)
      result -> result
    end
  end

  defp registration_schema_error([call], profile) do
    args = field(call, :arguments)

    if field(call, :name) == "register_author_content" and is_map(args) and
         field(args, :author_content_source_ref) in [nil, ""] do
      {:error, {:author_content_registration_invalid, :source_required}}
    else
      JudgmentToolContract.invalid_tool_arguments_detail([call], profile)
    end
  end

  defp registration_schema_error(calls, profile) when is_list(calls) do
    JudgmentToolContract.invalid_tool_arguments_detail(calls, profile)
  end

  defp validate_inline_plan(judgment, input) do
    case {inline_plan_call(judgment.provider_result), get_in(input, [:options, :plan_run])} do
      {nil, _run} ->
        {:ok, judgment}

      {_call, nil} ->
        {:error, :plan_run_required}

      {call, run} ->
        result = Map.put(judgment.provider_result, :tool_calls, [call])

        with {:ok, plan, meta} <-
               NovelApplication.AgenticPlanDraftPlanner.plan_from_result(run, result),
             :ok <- ExplorationPolicy.validate_inline_plan(plan, Map.get(input, :options, [])),
             do: {:ok, %{judgment | plan_result: %{plan: plan, meta: meta}}}
    end
  end

  defp inline_plan_call(result),
    do: Enum.find(field(result, :tool_calls) || [], &(field(&1, :name) == "agent_plan_draft"))

  defp operation([], :judgment), do: {:ok, "reply", %{}, nil}

  defp operation([call], _) do
    args = field(call, :arguments)

    with {:ok, operation} <- tool_operation(field(call, :name), args),
         do: {:ok, operation, args, call}
  end

  defp operation(_, _), do: {:error, :invalid_tool_combination}

  defp tool_operation("judgment_decision", args), do: {:ok, field(args, :action)}

  defp tool_operation(name, _args) do
    case name do
      "agent_plan_draft" -> {:ok, "plan"}
      "continuation_decision" -> {:ok, "continue"}
      "ask_author" -> {:ok, "await_author"}
      "register_author_content" -> {:ok, "author_content_registration"}
      "propose_creative_directions" -> {:ok, "creative_directions"}
      "propose_work_profile_revision" -> {:ok, "work_profile_revision"}
      "report_capability_gap" -> {:ok, "capability_gap"}
      _ -> {:error, :invalid_tool_combination}
    end
  end

  defp validate_operation("execute", args, options) do
    capability = field(args, :capability)

    # B33 CP2：动作意图 gate 主动纠错时明确要求「对象已知→execute」，此时不能沿用
    # M06 的“上一轮 ask 未回答不得推进”否决；否则明确动作永远无法被纠错修复。
    action_intent_retry? = Keyword.has_key?(options, :action_intent_correction_info)

    if not action_intent_retry? and
         "ask_author" in Keyword.get(options, :previous_attempt_tools, []) and
         capability in (@pending_target_capabilities ++ @adopted_target_capabilities) do
      {:error, :await_author_unanswered}
    else
      validate_execute_capability(capability, args, options)
    end
  end

  defp validate_operation("explore", args, options) do
    request = field(args, :explore_request)
    ExplorationPolicy.validate_requests([explore_request(request)], options)
  end

  defp validate_operation("creative_directions", _args, options) do
    if Keyword.get(options, :discussion_only, false),
      do: {:error, :discussion_only_violation},
      else: :ok
  end

  defp validate_operation("work_profile_revision", args, options) do
    if Keyword.get(options, :discussion_only, false) do
      {:error, :discussion_only_violation}
    else
      JudgmentToolContract.validate_work_profile_revision(args)
    end
  end

  defp validate_operation("author_content_registration", args, options) do
    if Keyword.get(options, :discussion_only, false) do
      {:error, :discussion_only_violation}
    else
      validate_author_registration(args, options)
    end
  end

  defp validate_operation("await_author", args, options) do
    with :ok <- JudgmentToolContract.validate_question_options(field(args, :options)) do
      # 作者指代可能已有的历史原文、只读探索可用且本轮尚无观察：先取证再问作者。
      if Keyword.get(options, :explore, false) and
           Keyword.get(options, :observation_count, 0) == 0 and
           AuthorContentRegistration.anaphoric_reference?(Keyword.get(options, :author_text, "")),
         do: {:error, :explore_before_ask_required},
         else: :ok
    end
  end

  # 缺口说明的 alternative_operation_refs 允许引用本轮真实可用的：
  # 能力目录、只读探索目录、或判断层工具（如 register_author_content）。
  # 仍然拒绝不存在的操作名（不发明操作），但不把“真实可用的下一步”误判成非法。

  defp validate_operation("capability_gap", _args, _options) do
    # 缺口说明是“如实报告”语义：alternative refs 只是最近可行路径提示，
    # 不能因模型写了带描述/不存在项而拒掉整个响应（M14 r2 终局根因）。
    :ok
  end

  defp validate_operation(_, _, _), do: :ok

  # 缺口说明的 alternative refs：过滤掉不在本轮真实目录中的项，保留可用项，
  # 不因为模型多写/写错替代项而拒绝整条响应（M14 r2 终局根因）。
  defp sanitize_operation_args("capability_gap", args, options) do
    allowed =
      Keyword.get(options, :capabilities, []) ++
        Keyword.get(options, :explore_tools, []) ++ @judgment_tool_names

    case field(args, :alternative_operation_refs) do
      refs when is_list(refs) ->
        args
        |> Map.delete("alternative_operation_refs")
        |> Map.put(:alternative_operation_refs, Enum.filter(refs, &(&1 in allowed)))

      _ ->
        args
    end
  end

  defp sanitize_operation_args(_operation, args, _options), do: args

  defp validate_author_registration(args, options) do
    AuthorContentRegistration.validate_author_registration(
      Map.put(args, "action", "author_content_registration"),
      Keyword.get(options, :author_content_sources, []),
      Keyword.get(options, :author_text, "")
    )
  end

  defp validate_execute_capability(capability, args, options) do
    targets =
      Map.merge(
        Keyword.get(options, :pending_artifact_targets, %{}),
        Keyword.get(options, :adopted_content_targets, %{})
      )

    if capability in Keyword.get(options, :capabilities, []) do
      validate_execute_targets(args, targets)
    else
      {:error, :capability_not_available}
    end
  end

  defp validate_execute_targets(args, targets) do
    capability = field(args, :capability)
    pending_ref = field(args, :pending_artifact_ref)
    adopted_ref = field(args, :adopted_content_ref)

    cond do
      capability in @pending_target_capabilities and not is_nil(adopted_ref) ->
        {:error, :target_ref_field_conflict}

      capability in @adopted_target_capabilities and not is_nil(pending_ref) ->
        {:error, :target_ref_field_conflict}

      true ->
        PendingArtifactWorkflow.validate(args, targets)
    end
  end

  defp narrative(_operation, result, nil, _args),
    do: content_narrative(result, field(result, :content))

  defp narrative(operation, result, call, args) do
    with true <- field(result, :content) in [nil, ""],
         :ok <- AgentNarrativeSource.verify_tool_call(result, call) do
      if operation == "explore",
        do: {:ok, nil, nil},
        else: tool_narrative(result, call, args)
    else
      false ->
        reason =
          if field(call, :name) == "ask_author",
            do: :author_question_content_conflict,
            else: :author_narrative_content_conflict

        {:error, reason}

      {:error, _} = error ->
        error
    end
  end

  defp content_narrative(result, text) do
    case sanitize_visible_content(text) do
      nil ->
        {:error, :judgment_narrative_required}

      visible ->
        with :ok <- Text.validate_narrative(visible),
             {:ok, source} <- AgentNarrativeSource.from_provider_result(result, visible),
             do: {:ok, visible, source}
    end
  end

  # 厂商/网关在只有私有推理时会返回 "[assistant reasoning omitted]" 之类的占位行；
  # 它不是作者内容，不能展示、也不能当作非空回复。纯占位 → 视为空内容（走纠错），
  # 占位行+真实文本 → 去掉占位行并保留可追溯的真实字节（仍是 provider output 子串）。
  @provider_placeholder_lines [
    "[assistant reasoning omitted]",
    "[assistant reasoning internal]"
  ]

  defp sanitize_visible_content(text) when is_binary(text) do
    # 模型把工具调用写成 XML/函数字面量塞进 content（而非原生 tool_calls）时，
    # 它不是作者可见答复；不能展示，进入有界纠错要求用原生工具调用或给出真实答复。
    if raw_tool_markup?(text) do
      nil
    else
      sanitize_visible_lines(text)
    end
  end

  defp sanitize_visible_content(_text), do: nil

  defp raw_tool_markup?(text) do
    Regex.match?(~r/<\/?tool_call\b|<function=|parameter\s*=/iu, text)
  end

  defp sanitize_visible_lines(text) do
    lines = String.split(text, "\n")

    if Enum.any?(lines, &provider_placeholder_line?/1) do
      cleaned =
        lines
        |> Enum.reject(&provider_placeholder_line?/1)
        |> Enum.join("\n")
        |> String.trim()

      cond do
        cleaned == "" -> nil
        contentless?(cleaned) -> nil
        true -> cleaned
      end
    else
      # 没有占位行时保持 provider 输出字节不变（N-NARR 绑定与既有空白语义）；
      # 但纯占位/仅标点内容（如 "-"）视为空内容。
      if contentless?(text), do: nil, else: text
    end
  end

  # 仅空白/标点/符号的内容（如 "-"、"…"）不是作者可见答复，视为空内容走有界纠错。
  defp contentless?(text),
    do: String.replace(text, ~r/[\s\p{P}\p{S}]/u, "") == ""

  defp provider_placeholder_line?(line) do
    trimmed = String.trim(line)

    trimmed in @provider_placeholder_lines or
      Regex.match?(~r/^\[.*assistant reasoning.*\]$/iu, trimmed)
  end

  defp tool_narrative(_result, nil, _args), do: {:error, :judgment_narrative_required}

  defp tool_narrative(result, call, args) do
    key = narrative_field(field(call, :name))
    text = field(args, key)

    if nonblank?(text) do
      with :ok <- Text.validate_narrative(text),
           {:ok, source} <-
             AgentNarrativeSource.from_tool_call_narrative(result, field(call, :name), text, key),
           do: {:ok, text, source}
    else
      {:error, :judgment_narrative_required}
    end
  end

  defp narrative_field("ask_author"), do: :question

  defp narrative_field(_), do: :author_reasoning
  defp nonblank?(text), do: is_binary(text) and String.trim(text) != ""

  defp normalized(operation, args, call, result, text, source, input) do
    judgment = %{
      action: operation,
      capability: field(args, :capability),
      frame_type: frame_type(operation),
      pending_artifact_ref: field(args, :pending_artifact_ref),
      adopted_content_ref: field(args, :adopted_content_ref),
      target_segment_ids: field(args, :target_segment_ids),
      character_ref: field(args, :character_ref),
      explore_request: explore_request(field(args, :explore_request)),
      candidate_directions: field(args, :candidate_directions) || [],
      profile_revision: profile_revision_args(args),
      author_content_source_ref: field(args, :author_content_source_ref),
      question: field(args, :question),
      options: field(args, :options) || [],
      reason_codes: field(args, :reason_codes) || [],
      guidance: field(args, :guidance),
      missing_effect: field(args, :missing_effect),
      tool_call_id: field(call, :id),
      provider_result: result,
      plan_result: nil,
      author_input: Map.get(input, :author_text),
      model_interpretation_status: if(operation == "reply", do: "not_provided", else: "provided")
    }

    case operation do
      "explore" ->
        judgment

      _ ->
        Map.merge(judgment, %{
          dialogue_goal: field(args, :dialogue_goal),
          narrative: text,
          narrative_source: source,
          reply_record: reply_record(operation, args, text, source, input)
        })
    end
  end

  defp reply_record(operation, args, text, source, input) do
    observations = input[:observations] || []

    %{
      provider_call_ref: source.provider_call_ref,
      author_narrative_source: source,
      task_policy_version: AuthoringTaskPolicy.version(),
      protocol_version: JudgmentToolContract.version(),
      source_input_ref: input[:source_input_ref],
      exploration_call_count: length(observations),
      observation_refs: Enum.flat_map(observations, &(&1[:refs] || [])),
      coverage:
        Enum.map(
          observations,
          &Map.take(&1, [:tool, :chapter_ref, :prose_range, :prose_total_chars, :next_offset])
        ),
      raw_content: text
    }
    |> Map.merge(reply_kind_fields(operation, args))
    |> Map.merge(reply_provenance(input))
  end

  defp reply_kind_fields(operation, args) do
    reply? = operation == "reply"

    %{
      response_kind: if(reply?, do: "plain_text", else: "structured_tool"),
      model_interpretation_status: if(reply?, do: "not_provided", else: "provided"),
      model_interpretation: if(reply?, do: nil, else: args)
    }
  end

  # B27 §9：观察供给来自本次 prepared 请求的可见叶；旧记录不回填。
  defp reply_provenance(input) do
    %{
      supplied_context_refs: input[:supplied_context_refs] || [],
      available_context_refs: input[:available_context_refs] || [],
      supplied_observation_refs: Map.fetch!(input, :supplied_observation_refs),
      unavailable_sources: input[:unavailable_sources] || [],
      rendered_context_sections: input[:rendered_context_sections] || []
    }
  end

  defp profile_revision_args(args) do
    %{
      title: field(args, :title),
      body: field(args, :body),
      field: field(args, :field),
      value: field(args, :value),
      author_reasoning: field(args, :author_reasoning)
    }
  end

  defp frame_type("creative_directions"), do: "creative_exploration"
  defp frame_type("work_profile_revision"), do: "execution_candidate"
  defp frame_type("capability_gap"), do: "capability_gap"
  defp frame_type(_), do: "casual_reply"
  defp explore_request(nil), do: nil
  defp explore_request(args), do: %{tool: field(args, :tool), query: field(args, :query)}
  defp field(map, key) when is_map(map), do: Map.get(map, key, Map.get(map, to_string(key)))
  defp field(_, _), do: nil
end
