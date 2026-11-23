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
    JudgmentDecisionToolContract,
    JudgmentToolContract,
    PendingArtifactWorkflow,
    ProviderActivityProjector,
    TurnInteractionService
  }

  require NovelTelemetry.LogEmit, as: LogEmit

  @max_attempts 2
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
    # 首轮先用真实消息派生来源，再以 initial_scope 构造最终视图；来源预计算不交付。
    base_refs = context_refs(input, :supplied_context_refs)
    scope_refs = Enum.uniq(base_refs ++ context_refs(input, :scope_source_refs))
    text = author_text(input, profile)
    source_input_ref = Map.get(input, :source_input_ref)

    with :ok <- validate_profile_capabilities(input, profile),
         {:ok, author_messages} <- RequestIR.author_input_messages(text, source_input_ref),
         true <- profile != :judgment or author_messages != [],
         {:ok, transcript} <- new_transcript(input, profile, nil, [], []),
         transcript = append_request_author(transcript, input, profile),
         {view, strip_history?} = compose_session_history(transcript, input, snapshot),
         {:ok, scope} <- profile_scope(input, profile, view) do
      case Map.get(input, :transcript) do
        nil ->
          initial_request_transcript(input, profile, snapshot, scope, scope_refs, base_refs)

        _existing ->
          {:ok, refresh_transcript(input, view, profile, scope, scope_refs, base_refs),
           strip_history?}
      end
    else
      false -> {:error, :invalid_author_input}
      {:error, _reason} = error -> error
    end
  end

  defp append_request_author(transcript, input, profile) do
    case author_text(input, profile) do
      text when is_binary(text) ->
        AuthoringTranscript.append_author_turn(
          transcript,
          text,
          Map.get(input, :source_input_ref),
          author_turn: Map.get(input, :author_turn)
        )

      nil ->
        transcript
    end
  end

  defp initial_request_transcript(input, profile, snapshot, scope, scope_refs, base_refs) do
    with {:ok, initial} <- new_transcript(input, profile, scope, scope_refs, base_refs) do
      {view, strip_history?} = compose_session_history(initial, input, snapshot)
      {:ok, view, strip_history?}
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

  defp profile_scope(input, :judgment, transcript) do
    with {:ok, request} <- AuthoringTranscript.to_request_ir(transcript),
         {:ok, author_sources} <- AuthorContentRegistration.author_sources(request),
         do: {:ok, judgment_scope(input, author_sources)}
  end

  defp profile_scope(input, :continuation, _transcript),
    do: {:ok, continuation_scope(input)}

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
    call_id = judgment.tool_call_id

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

  defp invoke(fun, transcript, input, profile, attempt) do
    case prepare_request(transcript, profile) do
      {:ok, request} ->
        supplied_refs =
          request
          |> RequestIR.visible_observations()
          |> Enum.flat_map(& &1.source_refs)
          |> Enum.uniq()

        input = Map.put(input, :supplied_observation_refs, supplied_refs)
        invoke_prompt(fun, request, transcript, input, profile, attempt)

      {:error, reason} ->
        prompt_failure(reason, transcript, attempt)
    end
  end

  defp invoke_prompt(fun, request, transcript, input, profile, attempt) do
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
          request
        )

      {:error, _reason} when attempt < @max_attempts ->
        LogEmit.emit(:judgment, :provider_retry, :start, %{
          attempt: attempt,
          reason_code: "provider_request_failed"
        })

        invoke(fun, transcript, input, profile, attempt + 1)

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
         request
       ) do
    with {:ok, judgment} <- decode(provider_result, profile, input),
         {:ok, judgment} <-
           CharacterProfile.bind_judgment(
             judgment,
             field(request.run, :work_id),
             RequestIR.visible_observations(request)
           ),
         {:ok, judgment} <-
           ChapterRevisionScope.bind_observed_targets(judgment, request),
         {:ok, judgment} <- AuthorContentRegistration.bind_judgment(judgment, request),
         :ok <- validate_pending_clarification(judgment, input) do
      {:ok,
       judgment
       |> Map.put(:provider_call_count, attempt)
       |> Map.put(
         :transcript,
         validated_transcript(transcript, judgment, receipt_context(attempt, false))
       )}
    else
      {:error, reason} ->
        log_output_validation(attempt, reason)

        input =
          if reason == {:character_profile_invalid, :display_identity_ambiguous},
            do: Map.put(input, :unresolved_character_display, true),
            else: input

        correct_or_reject(fun, transcript, input, profile, attempt, reason)
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

  defp log_output_validation(attempt, reason) do
    LogEmit.emit(:judgment, :output_validation, :done, %{
      outcome: if(attempt < @max_attempts, do: "retry", else: "rejected"),
      reason_code: validation_reason_code(reason),
      reason: inspect(reason),
      attempt: attempt
    })
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
      JudgmentDecisionToolContract.target_fields_guidance() <>
      "保留同一作者输入、来源、目标、范围与权限，只纠正字段与目标选择。"
  end

  defp correction_content({:invalid_alternative_operation_refs, detail}) do
    "本次响应未通过契约校验：invalid_alternative_operation_refs（替代操作不在本轮可用集合）。" <>
      "本次无效引用：#{Jason.encode!(detail.unavailable_refs)}；" <>
      "当前允许的操作 ID：#{Jason.encode!(detail.allowed_operation_refs)}。" <>
      "alternative_operation_refs 只提交实际 ID，不拼接描述；没有可建议操作时可留空。" <>
      "保留同一作者输入、来源、目标、范围与权限，依据真实目录重新判断；不得以近似操作冒充缺失效果。"
  end

  # 缺失作者正文时只补当前操作所属的唯一正文，不引入第二来源。
  defp correction_content(:judgment_narrative_required) do
    "本次响应未通过契约校验：judgment_narrative_required（缺少作者可见内容）。" <>
      "纯文本回复必须给出非空 content；只输出思考、占位词或仅标点不算回复。" <>
      JudgmentToolContract.legal_combination_guidance() <>
      "保留同一作者输入、来源、目标、范围与权限，只补足实际回复。"
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

  # 范围字段纠错直接消费工具契约，不在协议层复制字段说明。
  defp correction_content({scope_field, reason})
       when scope_field in [:modification_scope, :target_segments] do
    schema_field = if scope_field == :target_segments, do: :target_segment_ids, else: scope_field

    "本次响应未通过契约校验：#{scope_field}（#{inspect(reason)}）。" <>
      JudgmentDecisionToolContract.schema_for_action("execute").properties[
        schema_field
      ].description <>
      "保留同一作者输入、来源、目标、范围与权限，只纠正目标选择。"
  end

  defp correction_content(reason) do
    "本次响应未通过契约校验：#{inspect(reason) |> String.slice(0, @error_excerpt_chars)}。" <>
      "保留同一作者输入、来源、目标、范围与权限，只纠正不合法结构；不要扩大操作或复述失败响应。"
  end

  # 所有结构纠错共用同一实际调用窗口，不按错误类别追加次数。
  defp correct_or_reject(fun, transcript, input, profile, attempt, reason)
       when attempt < @max_attempts do
    invoke(
      fun,
      correction_transcript(transcript, reason, receipt_context(attempt, true)),
      input,
      profile,
      attempt + 1
    )
  end

  defp correct_or_reject(_, transcript, _, _, attempt, {family, _} = reason)
       when family in [:author_content_registration_invalid, :pending_artifact_invalid],
       do: reject(reason, reason, transcript, attempt)

  defp correct_or_reject(_, transcript, _, _, attempt, {:invalid_tool_arguments, detail}),
    do:
      reject(
        {:judgment_protocol_violation, :invalid_tool_arguments},
        {:invalid_tool_arguments, detail},
        transcript,
        attempt
      )

  defp correct_or_reject(_, transcript, _, _, attempt, reason),
    do: reject({:judgment_protocol_violation, reason}, reason, transcript, attempt)

  # 终局拒绝也走同一个失败出口：先按既有 correction_transcript 闭合末次真实调用，
  # 再把最新会话与本次调用数放进 error3；reason 只保留结构类别。
  defp reject(return_reason, close_reason, transcript, attempt) do
    failure(
      return_reason,
      correction_transcript(transcript, close_reason, receipt_context(attempt, false)),
      attempt
    )
  end

  defp failure(reason, transcript, actual_calls) do
    {:error, reason,
     AuthoringSession.failure_state(%{
       transcript: transcript,
       provider_call_count: actual_calls
     })}
  end

  defp correction_transcript(transcript, reason, receipt_context) do
    detail = %{message: correction_content(reason), reason: inspect(reason)}

    case pending_call_ids(transcript) do
      [] ->
        AuthoringTranscript.append_application_notice(transcript, correction_content(reason))

      ids ->
        close_calls(
          transcript,
          ids,
          "failed",
          validation_reason_code(reason),
          detail,
          receipt_context
        )
    end
  end

  # 求证调用由真实 observation 闭合；其它操作只确认协议有效，不代表执行批准。
  defp validated_transcript(transcript, %{action: "explore"}, _receipt_context), do: transcript

  defp validated_transcript(transcript, %{action: "plan"} = judgment, receipt_context),
    do: validate_inline_plan_call(transcript, judgment, receipt_context)

  defp validated_transcript(transcript, _judgment, receipt_context),
    do: complete_validation(transcript, receipt_context)

  defp validate_inline_plan_call(
         transcript,
         %{plan_result: %{plan: plan}} = judgment,
         receipt_context
       ) do
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
      },
      receipt_context
    )
  end

  defp validate_inline_plan_call(transcript, _judgment, _receipt_context), do: transcript

  @doc "应用分流完成后闭合尚未由真实观察返回的协议调用；不表示执行批准。"
  @spec complete_validation(AuthoringTranscript.t(), map()) :: AuthoringTranscript.t()
  def complete_validation(transcript, receipt_context \\ %{retryable: false}) do
    close_calls(
      transcript,
      pending_call_ids(transcript),
      "passed",
      "judgment_validated",
      %{execution_authorized: false, canon_written: false},
      receipt_context
    )
  end

  defp pending_call_ids(transcript) do
    {:ok, ir} = AuthoringTranscript.to_request_ir(transcript)
    {:ok, ids} = RequestIR.pending_call_ids(ir)
    ids
  end

  defp close_calls(transcript, ids, status, reason, detail, receipt_context) do
    Enum.reduce(ids, transcript, fn id, current ->
      AuthoringTranscript.append_validation(current, id, status, reason, detail, receipt_context)
    end)
  end

  defp receipt_context(actual_calls, retryable) do
    %{
      retryable: retryable,
      budget_after: %{
        exchange: %{provider_call_budget: @max_attempts, provider_call_count: actual_calls}
      }
    }
  end

  defp validation_reason_code({:invalid_alternative_operation_refs, _detail}),
    do: "invalid_alternative_operation_refs"

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

        initial_scope =
          if scope do
            %{
              content: scope,
              versions: scope_versions(input, nil),
              source_refs: scope_refs
            }
          end

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
            initial_scope: initial_scope,
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
        # 既有 transcript 只走追加规则；initial_scope 仅用于首轮最终构造。
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

  defp judgment_scope(input, author_sources) do
    options = Map.get(input, :options, [])
    run = Keyword.get(options, :plan_run, %{})
    goal = Map.get(run, :goal, %{})
    source_input_ref = Map.get(input, :source_input_ref)

    input
    |> Map.fetch!(:scope)
    |> Map.put(:goal, %{
      provenance: "application",
      version: field(goal, :version),
      source_input_ref: source_input_ref
    })
    |> Map.put(:operation, %{
      available_operations: Keyword.get(options, :capabilities, []),
      pending_artifact_targets: Keyword.get(options, :pending_artifact_targets, %{}),
      adopted_content_targets: Keyword.get(options, :adopted_content_targets, %{}),
      registered_sources: Keyword.get(options, :registered_sources, []),
      author_content_sources: author_sources,
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
    普通文本回复使用非空 content，无固定开场或空行格式。
    禁止用“-”“—”“…”或仅标点/空白的占位内容作为最终答复。
    #{JudgmentToolContract.legal_combination_guidance()}
    读取请求使用 judgment_decision.explore + explore_request{tool,query}，不能直接调用探索目录里的 native tool。
    内容修订的目标和范围字段遵循本轮 judgment_decision 工具契约；完整计划由 agent_plan_draft 的独立参数契约承载。
    #{JudgmentToolContract.question_response_guidance()}
    工具调用必须使用原生 tool_calls；不得把“<tool_call>/<function=...>”这类伪工具文本写进 content，
    也不得用伪工具文本代替作者可见答复。
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

  defp decode(result, profile, input) when is_map(result) do
    calls = field(result, :tool_calls) || []

    options =
      input
      |> Map.get(:options, [])
      |> Keyword.put(:profile, profile)

    with :ok <- validate_tools(calls, profile),
         {:ok, operation, args, call} <- operation(calls, profile),
         {:ok, text, source} <- narrative(operation, result, call, args),
         :ok <- validate_operation(operation, args, options) do
      judgment = normalized(operation, args, call, result, text, source, input)
      validate_inline_plan(judgment, input)
    end
  end

  defp decode(_, _, _), do: {:error, :invalid_judgment_result}

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

  defp validate_operation("execute", args, options),
    do: validate_execute_capability(field(args, :capability), args, options)

  defp validate_operation("explore", args, options) do
    request = field(args, :explore_request)
    ExplorationPolicy.validate_requests([explore_request(request)], options)
  end

  defp validate_operation("work_profile_revision", args, _options),
    do: JudgmentToolContract.validate_work_profile_revision(args)

  defp validate_operation("await_author", args, _options),
    do: JudgmentToolContract.validate_question_options(field(args, :options))

  defp validate_operation("capability_gap", args, options) do
    exploration =
      if Keyword.get(options, :explore, false),
        do: Keyword.get(options, :explore_tools, []),
        else: []

    allowed =
      Keyword.get(options, :capabilities, []) ++
        exploration ++
        Enum.map(JudgmentToolContract.tools(Keyword.fetch!(options, :profile)), & &1.name)

    invalid = Enum.reject(field(args, :alternative_operation_refs) || [], &(&1 in allowed))

    if invalid == [],
      do: :ok,
      else:
        {:error,
         {:invalid_alternative_operation_refs,
          %{unavailable_refs: invalid, allowed_operation_refs: allowed}}}
  end

  defp validate_operation(_, _, _), do: :ok

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
    with :ok <- JudgmentDecisionToolContract.validate_execute_target_fields(args),
         do: PendingArtifactWorkflow.validate(args, targets)
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
      modification_scope: field(args, :modification_scope),
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
