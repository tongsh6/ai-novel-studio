defmodule NovelApplication.AgentRunFlows.AuthoringSession do
  @moduledoc """
  AgentRun flow 的 canonical 会话读写边界。

  只负责 transcript 与 Request IR 的转换和状态合并；计划、预算、权限、工具执行与
  作者裁决仍由既有 AgentRun/Orchestrator 负责。

  两条不同层的传输契约（不要合并成同一形状）：

  - flow state（`{:ok, step_result}` / `{:error, reason, state}` 里的快照/结果）：
    canonical 会话唯一位置是 `stage_state.judgment_transcript`（`transcript/1`、
    `put_transcript/2`、`snapshot/2` 都在这一层）。
  - error3 的第三元素（`{:error, reason, stage_state_delta}`）：它是 **stage_state
    增量**，runtime 直接把它 merge 进 `stage_state`；canonical 会话在该增量顶层
    `judgment_transcript`（`failure_state/1`、`failure_result/3`、`inherit_failure/2`
    在这一层）。error3 不携带 flow state 形状，不得把会话包进 `:stage_state` 键。
  """

  alias NovelApplication.AuthoringCheckpoint
  alias NovelApplication.AuthoringTranscript
  alias NovelCommon.Contracts.ToolRequest
  alias NovelCommon.RequestIR

  @invalid_request_ir "authoring session request IR is invalid"

  @spec transcript(map()) :: AuthoringTranscript.t() | nil
  def transcript(%{stage_state: state}) when is_map(state),
    do: Map.get(state, :judgment_transcript)

  def transcript(_snapshot), do: nil

  @spec request_ir(map()) :: NovelCommon.RequestIR.t() | nil
  def request_ir(snapshot) do
    case transcript(snapshot) do
      nil ->
        nil

      transcript ->
        {:ok, ir} = AuthoringTranscript.to_request_ir(transcript)
        ir
    end
  end

  @spec compact(AuthoringTranscript.t() | nil, map()) ::
          {:ok, AuthoringTranscript.t()} | {:error, term()}
  def compact(nil, _attrs), do: {:error, :transcript_not_found}

  def compact(transcript, %{
        covers: covers,
        source_refs: refs,
        versions: versions,
        omissions: omissions,
        summary: summary
      }) do
    # B81 CP3：压缩计划在会话视图上派生，checkpoint 追加到本 run 段；跨段 covers
    # 不在段内可见，完整覆盖/证据校验由 AuthoringCheckpoint 的会话级校验兜底。
    AuthoringCheckpoint.append_checkpoint(transcript, %{
      covers: covers,
      source_refs: refs,
      versions: versions,
      omissions: omissions,
      summary: summary
    })
  end

  def compact(_transcript, _attrs), do: {:error, :invalid_compaction_request}

  @doc """
  用本次真实 Provider 响应闭合仍待处理的原生调用。

  只取 `session.provider_result` 中真实出现的 call_id，与 Request IR 仍 pending 的
  集合取交集后按原 call_id 追加校验结果；历史消息、原 arguments、provider_result
  与真实计数保持不变。协议已拒绝或应用已闭合的调用不会重复追加，`provider_result`
  为 nil 时不猜测、不关闭旧 pending；没有 IR 的零调用会话不伪造历史。
  """
  @spec validate_provider_result(map(), String.t(), String.t(), map()) :: map()
  def validate_provider_result(session, status, reason_code, detail) when is_map(session) do
    case Map.fetch(session, :request_ir) do
      :error -> session
      {:ok, nil} -> session
      {:ok, %RequestIR{} = ir} -> validate_pending_calls(session, ir, status, reason_code, detail)
      {:ok, _invalid} -> invalid_request_ir!()
    end
  end

  defp validate_pending_calls(session, %RequestIR{} = ir, status, reason_code, detail) do
    case RequestIR.pending_call_ids(ir) do
      {:ok, pending} ->
        call_ids =
          session
          |> Map.get(:provider_result)
          |> result_call_ids()
          |> Enum.filter(&(&1 in pending))

        ir =
          Enum.reduce(call_ids, ir, fn call_id, current ->
            RequestIR.append_validation_result(current, call_id, status, reason_code, detail)
          end)

        %{session | request_ir: ir}

      {:error, _reason} ->
        invalid_request_ir!()
    end
  end

  defp result_call_ids(result) when is_map(result) do
    (Map.get(result, :tool_calls) || Map.get(result, "tool_calls") || [])
    |> Enum.map(fn call -> Map.get(call, :id) || Map.get(call, "id") end)
    |> Enum.filter(&is_binary/1)
  end

  defp result_call_ids(_result), do: []

  @doc """
  投影内部阶段 metadata：真实执行计数与由 Request IR 派生的 judgment transcript。

  空会话为 0/0 且不生成 transcript；IR 存在时由 IR 重新派生，旧 transcript 不能
  覆盖新历史；不复制 raw provider_result、stage_state、callback 或整个快照。
  """
  @spec provider_metadata(map()) :: map()
  def provider_metadata(session) when is_map(session) do
    %{
      provider_call_count: Map.get(session, :provider_call_count, 0) || 0,
      tool_call_count: Map.get(session, :tool_call_count, 0) || 0
    }
    |> put_derived_transcript(Map.get(session, :request_ir))
  end

  def provider_metadata(_session), do: %{provider_call_count: 0, tool_call_count: 0}

  defp put_derived_transcript(metadata, nil), do: metadata

  defp put_derived_transcript(metadata, %RequestIR{} = ir) do
    case AuthoringTranscript.from_request_ir(ir) do
      {:ok, transcript} -> Map.put(metadata, :judgment_transcript, transcript)
      {:error, _reason} -> invalid_request_ir!()
    end
  end

  defp put_derived_transcript(_metadata, _invalid), do: invalid_request_ir!()

  defp invalid_request_ir!, do: raise(ArgumentError, @invalid_request_ir)

  @doc """
  把真实 AgentRun 与快照派生的 Request IR 绑定进既有 ToolRequest input。

  决策、框架、授权、幂等与业务材料原样保留；不新增作者消息，不把整个快照或函数
  放进 input，也不复用源候选项的旧 run。
  """
  @spec bind_tool_request(ToolRequest.t(), map(), map()) :: ToolRequest.t()
  def bind_tool_request(%ToolRequest{} = request, run, snapshot) do
    input =
      request.input
      |> Map.put("agent_run", run)
      |> Map.put("request_ir", request_ir(snapshot))

    %{request | input: input}
  end

  @doc """
  失败也保留会话与已发生的执行计数；Provider 消耗由真实调用事件累计。

  error3 的第三元素是 stage_state 增量（runtime 直接 merge 进 `stage_state`），
  私有会话在该增量顶层 `judgment_transcript`——这是错误结果里的唯一位置。
  """
  @spec failure_result(term(), map(), AuthoringTranscript.t() | nil) :: {:error, term(), map()}
  def failure_result(reason, turn_result, transcript) do
    tool_calls = get_in(turn_result, [:trace_summary, :execution_counts, :tool_calls]) || 0

    {:error, reason, Map.merge(transcript_state(transcript), %{tool_call_count: tool_calls})}
  end

  @spec transcript_state(AuthoringTranscript.t() | nil) :: map()
  def transcript_state(nil), do: %{}
  def transcript_state(transcript), do: %{judgment_transcript: transcript}

  @doc """
  判断/续行成功后的统一失败事实：最新私有会话 + 本次真实调用 delta。

  只用于已经发生的交换；尚未创建 IR 的零调用错误仍保留纯 `{:error, reason}`。
  """
  @spec failure_state(map()) :: map()
  def failure_state(judgment) when is_map(judgment) do
    judgment
    |> Map.get(:transcript)
    |> transcript_state()
    |> Map.put(:provider_call_count, Map.get(judgment, :provider_call_count, 0) || 0)
  end

  @doc """
  把较旧判断会话并入错误结果；inner 已带更新会话时保持 inner，不反向覆盖。

  error3 的私有会话唯一位置是 state 顶层 `judgment_transcript`（该 state 是 stage_state
  增量，runtime 归集时合并进 `stage_state`）。其他 `stage_state` 业务字段与顶层真实
  计数原样保留；私有会话不写 reason、不复制整个快照。
  """
  @spec inherit_failure({:error, term()} | {:error, term(), map()}, map()) ::
          {:error, term(), map()}
  def inherit_failure({:error, reason}, judgment),
    do: {:error, reason, failure_state(judgment)}

  def inherit_failure({:error, reason, state}, judgment) when is_map(state) do
    metadata = failure_state(judgment)

    state =
      state
      |> inherit_transcript(
        Map.get(state, :judgment_transcript) || Map.get(metadata, :judgment_transcript)
      )
      |> inherit_provider_calls(Map.get(metadata, :provider_call_count, 0))

    {:error, reason, state}
  end

  def inherit_failure(result, _judgment), do: result

  # inner 已带本步会话时保持 inner（较旧 judgment 不反向覆盖），否则继承本次判断会话。
  # 显式 nil 视为「本步未携带会话」，不能挡住继承；error3 的增量顶层是唯一位置。
  defp inherit_transcript(state, nil), do: Map.delete(state, :judgment_transcript)

  defp inherit_transcript(state, transcript),
    do: Map.put(state, :judgment_transcript, transcript)

  defp inherit_provider_calls(state, provider_calls) do
    case Map.get(state, :provider_call_count) do
      count when is_integer(count) and count >= provider_calls -> state
      _ -> Map.put(state, :provider_call_count, provider_calls)
    end
  end

  @spec put_transcript({:ok, map()} | map(), AuthoringTranscript.t() | nil) ::
          {:ok, map()} | map()
  def put_transcript({:ok, result}, transcript), do: {:ok, put_transcript(result, transcript)}

  def put_transcript(result, transcript) when is_map(result) do
    Map.update(
      result,
      :stage_state,
      transcript_state(transcript),
      &Map.merge(&1 || %{}, transcript_state(transcript))
    )
  end

  @spec snapshot(map(), AuthoringTranscript.t() | nil) :: map()
  def snapshot(snapshot, transcript) do
    Map.update!(snapshot, :stage_state, &Map.merge(&1, transcript_state(transcript)))
  end

  @doc "规划结果在后续步骤执行前成为该步可见的会话。"
  def execution_snapshot(snapshot, %{judgment_transcript: transcript}),
    do: snapshot(snapshot, transcript)

  def execution_snapshot(snapshot, _meta), do: snapshot

  @doc "结果缺少更新会话时继承规划历史；已有步骤历史始终优先。"
  def inherit_result({:ok, result}, meta), do: {:ok, inherit_result(result, meta)}

  def inherit_result({:error, reason}, meta), do: inherit_result({:error, reason, %{}}, meta)

  def inherit_result({:error, reason, state}, meta),
    do: {:error, reason, inherit_failure_state(state, meta)}

  def inherit_result(result, meta) when is_map(result) do
    delta = stage_state_delta(meta)
    Map.update(result, :stage_state, delta, &inherit_existing_transcript(&1 || %{}, delta))
  end

  # 普通 step 结果：规划历史作为 stage_state 增量继承，已有步骤历史始终优先。
  defp stage_state_delta(%{judgment_transcript: transcript}) when not is_nil(transcript),
    do: %{judgment_transcript: transcript}

  defp stage_state_delta(_meta), do: %{}

  # error3 载体：会话作为增量顶层继承（runtime 归集进 stage_state），inner 已有优先。
  defp inherit_failure_state(state, meta) do
    case Map.get(meta, :judgment_transcript) do
      nil -> state
      transcript -> Map.put_new(state, :judgment_transcript, transcript)
    end
  end

  defp inherit_existing_transcript(stage_state, delta) do
    case Map.get(delta, :judgment_transcript) do
      nil -> stage_state
      transcript -> Map.put_new(stage_state, :judgment_transcript, transcript)
    end
  end
end
