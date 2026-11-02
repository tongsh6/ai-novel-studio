defmodule NovelApplication.AgentRunFlows.AuthoringSession do
  @moduledoc """
  AgentRun flow 的 canonical 会话读写边界。

  只负责 transcript 与 Request IR 的转换和状态合并；计划、预算、权限、工具执行与
  作者裁决仍由既有 AgentRun/Orchestrator 负责。
  """

  alias NovelAgent.Provider.RequestIR
  alias NovelApplication.AuthoringTranscript
  alias NovelCommon.Contracts.ToolRequest

  @invalid_request_ir "authoring session request IR is invalid"
  @inconsistent_failure_carrier :inconsistent_judgment_transcript_carrier

  @spec transcript(map()) :: AuthoringTranscript.t() | nil
  def transcript(%{stage_state: state}) when is_map(state),
    do: Map.get(state, :judgment_transcript)

  def transcript(_snapshot), do: nil

  @spec request_ir(map()) :: NovelAgent.Provider.RequestIR.t() | nil
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
    AuthoringTranscript.compact(transcript, covers, refs, versions, omissions, summary)
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

  @doc "失败也保留会话与已发生的执行计数；Provider 消耗由真实调用事件累计。"
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

  inner 的 flat/nested 两种既有私有载体先归并为一个 flat canonical；显式 nil 不
  覆盖另一有效别名，两个非 nil 别名不一致时以固定安全 reason 拒绝。其他
  `stage_state` 业务字段与顶层真实计数原样保留；私有会话不写 reason、不复制整个快照。
  """
  @spec inherit_failure({:error, term()} | {:error, term(), map()}, map()) ::
          {:error, term(), map()}
  def inherit_failure({:error, reason}, judgment),
    do: {:error, reason, failure_state(judgment)}

  def inherit_failure({:error, reason, state}, judgment) when is_map(state) do
    metadata = failure_state(judgment)

    case inner_transcript(state) do
      {:ok, inner} ->
        state =
          state
          |> put_canonical_transcript(inner || Map.get(metadata, :judgment_transcript))
          |> inherit_provider_calls(Map.get(metadata, :provider_call_count, 0))

        {:error, reason, state}

      :inconsistent ->
        {:error, @inconsistent_failure_carrier, drop_transcript_aliases(state)}
    end
  end

  def inherit_failure(result, _judgment), do: result

  # 私有会话只允许一个 canonical 位置：error3 顶层 flat 字段。inner 的 nested
  # `stage_state.judgment_transcript` 是 runtime 已支持的既有形状；显式 nil 不覆盖
  # 另一有效别名，两个非 nil 别名不一致时拒绝，不按时间猜测或静默选旧值。
  defp inner_transcript(state) do
    flat = Map.get(state, :judgment_transcript)
    nested = nested_transcript(Map.get(state, :stage_state))

    cond do
      is_nil(flat) -> {:ok, nested}
      is_nil(nested) -> {:ok, flat}
      flat == nested -> {:ok, flat}
      true -> :inconsistent
    end
  end

  defp nested_transcript(stage_state) when is_map(stage_state),
    do: Map.get(stage_state, :judgment_transcript)

  defp nested_transcript(_stage_state), do: nil

  defp put_canonical_transcript(state, nil), do: drop_transcript_aliases(state)

  defp put_canonical_transcript(state, transcript) do
    state
    |> Map.put(:judgment_transcript, transcript)
    |> drop_nested_transcript()
  end

  defp drop_transcript_aliases(state) do
    state
    |> Map.delete(:judgment_transcript)
    |> drop_nested_transcript()
  end

  defp drop_nested_transcript(state) do
    case Map.get(state, :stage_state) do
      stage_state when is_map(stage_state) ->
        if Map.has_key?(stage_state, :judgment_transcript) do
          Map.put(state, :stage_state, Map.delete(stage_state, :judgment_transcript))
        else
          state
        end

      _stage_state ->
        state
    end
  end

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
    do: {:error, reason, inherit_state(state, meta)}

  def inherit_result(result, meta) when is_map(result) do
    Map.update(result, :stage_state, inherit_state(%{}, meta), &inherit_state(&1 || %{}, meta))
  end

  defp inherit_state(state, %{judgment_transcript: transcript}) when not is_nil(transcript),
    do: Map.put_new(state, :judgment_transcript, transcript)

  defp inherit_state(state, _meta), do: state
end
