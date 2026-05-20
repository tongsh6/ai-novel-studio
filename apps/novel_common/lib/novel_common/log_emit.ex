defmodule NovelCommon.LogEmit do
  require Logger

  # Find project root once, at compile time.
  @project_root_dir __DIR__
                    |> Stream.iterate(&Path.dirname/1)
                    |> Stream.take_while(&(&1 != "/"))
                    |> Enum.find(&File.exists?(Path.join(&1, "mix.exs"))) ||
                      raise("Cannot find project root (mix.exs) from #{__DIR__}")

  @moduledoc """
  Structured business-log emission. ADR-0018 §3 (§5).

  Every call-site writes a log event with at least `event`, `outcome`,
  and `duration_ms`, plus whatever context `LogContext` has injected via
  `Logger.metadata`.  The `phase` argument is checked at **compile time**
  through a macro — passing anything other than `:start | :done | :error`
  is a compilation error.

  ## Example

      require LogEmit
      LogEmit.emit(:planner, :form_frame, :start, %{})
      # ... work ...
      LogEmit.emit(:planner, :form_frame, :done, %{duration_ms: 482})

  `module` + `step` together form the event name: `"planner.form_frame.start"`.
  """

  # ── Public macro (compile-time phase validation) ─

  @doc """
  Emit a structured business log event.  Module + step + phase are fused into
  the `event` atom (`:planner.form_frame.done`).  `fields` is an optional map
  of extra dimensions (e.g. `%{duration_ms: 250, reason_code: :timeout}`).

  **Phase** is validated at compile-time: only `:start`, `:done`, `:error`
  pass.  Any other atom produces a CompileError.
  """

  # header with default
  defmacro emit(module, step, phase, fields \\ quote(do: %{}))

  defmacro emit(module, step, :start, fields) do
    quote do
      NovelCommon.LogEmit.__emit__(unquote(module), unquote(step), :start, unquote(fields))
    end
  end

  defmacro emit(module, step, :done, fields) do
    quote do
      NovelCommon.LogEmit.__emit__(unquote(module), unquote(step), :done, unquote(fields))
    end
  end

  defmacro emit(module, step, :error, fields) do
    quote do
      NovelCommon.LogEmit.__emit__(unquote(module), unquote(step), :error, unquote(fields))
    end
  end

  # Catch-all — fires only when phase is NOT :start/:done/:error.
  defmacro emit(_module, _step, phase, _fields) do
    raise CompileError,
      description:
        "invalid LogEmit phase: #{inspect(phase)}.  Only :start | :done | :error are allowed (ADR-0018 §3)."
  end

  # ── Runtime emission ──────────────────────────

  @doc false
  def __emit__(module, step, phase, fields)
      when is_atom(module) and is_atom(step) and is_map(fields) do
    event = :"#{module}.#{step}.#{phase}"

    metadata = Logger.metadata()

    base = %{
      event: event,
      outcome: Map.get(fields, :outcome, outcome_for(phase)),
      duration_ms: Map.get(fields, :duration_ms, 0),
      timestamp: DateTime.utc_now()
    }

    enriched =
      base
      |> maybe_put_from_meta(:workspace_id, metadata)
      |> maybe_put_from_meta(:work_id, metadata)
      |> maybe_put_from_meta(:session_id, metadata)
      |> maybe_put_from_meta(:turn_id, metadata)
      |> maybe_put_from_meta(:frame_id, metadata)
      |> maybe_put_from_meta(:behavior_id, metadata)
      |> maybe_put_from_meta(:decision_id, metadata)
      |> maybe_put_from_meta(:tool_request_id, metadata)

    # Merge caller-supplied business fields last so they can override
    # inferred fields.  Must never override `event`, `outcome`, or `timestamp`.
    enriched = Map.merge(enriched, strip_reserved(fields))
    enriched = Map.put(enriched, :msg, build_msg(module, step, phase, enriched))

    Logger.info(enriched.msg)
    maybe_write_jsonl(enriched)
  end

  # ── Human-readable message builder ───────────────

  @msg_keys [
    :frame_type,
    :decision_type,
    :tool_name,
    :tool_outcome,
    :reason_code,
    :candidate_count,
    :has_snapshot,
    :context_refs_count,
    :text_len,
    :task_type,
    :has_behavior,
    :outcome_detail
  ]

  defp build_msg(module, step, phase, fields) do
    duration =
      case fields[:duration_ms] do
        d when is_integer(d) and d > 0 -> format_duration(d)
        _ -> ""
      end

    details =
      @msg_keys
      |> Enum.reduce([], fn k, acc ->
        case fields do
          %{^k => v} when not is_nil(v) -> [acc, "#{translate_key(k)}=#{translate_val(k, v)}"]
          _ -> acc
        end
      end)
      |> Enum.join("  ")

    parts = ["#{module}.#{step}", phase_cn(phase)] ++ if(duration != "", do: [duration], else: [])
    parts = if details != "", do: parts ++ [details], else: parts
    Enum.join(parts, " | ")
  end

  defp phase_cn(:start), do: "开始"
  defp phase_cn(:done), do: "完成"
  defp phase_cn(:error), do: "失败"

  defp format_duration(ms) when ms < 1000, do: "#{ms}ms"
  defp format_duration(ms), do: "#{Float.round(ms / 1000, 1)}s"

  # Key name translation — only translate commonly-seen keys
  defp translate_key(:frame_type), do: "frame"
  defp translate_key(:decision_type), do: "决策"
  defp translate_key(:tool_name), do: "工具"
  defp translate_key(:tool_outcome), do: "工具结果"
  defp translate_key(:reason_code), do: "原因"
  defp translate_key(:candidate_count), do: "候选方向"
  defp translate_key(:has_snapshot), do: "有上下文"
  defp translate_key(:context_refs_count), do: "上下文条目"
  defp translate_key(:text_len), do: "输入长度"
  defp translate_key(:task_type), do: "任务类型"
  defp translate_key(:has_behavior), do: "打开行为"
  defp translate_key(:outcome), do: "结果"
  defp translate_key(:outcome_detail), do: "详情"
  defp translate_key(k), do: k

  # Value translation — atoms/booleans to Chinese
  defp translate_val(:outcome, "start"), do: "—"
  defp translate_val(:outcome, "ok"), do: "正常"
  defp translate_val(:outcome, "skipped"), do: "跳过"
  defp translate_val(:outcome, "error"), do: "异常"
  defp translate_val(_key, true), do: "是"
  defp translate_val(_key, false), do: "否"
  defp translate_val(:frame_type, :casual_reply), do: "闲聊回复"
  defp translate_val(:frame_type, :creative_exploration), do: "创意探索"
  defp translate_val(:frame_type, :question_answer), do: "问答"
  defp translate_val(:frame_type, :meta_discussion), do: "元讨论"
  defp translate_val(:decision_type, :allow_tool), do: "允许工具调用"
  defp translate_val(:decision_type, :downgrade_to_dialogue), do: "降级为对话"
  defp translate_val(:decision_type, :require_confirmation), do: "需用户确认"
  defp translate_val(:decision_type, :block), do: "阻止执行"
  defp translate_val(:decision_type, :fail_with_recovery), do: "失败已恢复"
  defp translate_val(:decision_type, :adopt_tentative), do: "暂存采纳"
  defp translate_val(:decision_type, :reject), do: "拒绝"
  defp translate_val(:tool_outcome, :succeeded), do: "成功"
  defp translate_val(:tool_outcome, :failed), do: "失败"
  defp translate_val(:reason_code, :provider_error), do: "模型调用失败"
  defp translate_val(:reason_code, :frame_validation_failed), do: "frame校验失败"
  defp translate_val(:reason_code, :empty_text), do: "输入为空"
  defp translate_val(:reason_code, :not_found), do: "未找到"
  defp translate_val(:reason_code, :persistence_error), do: "持久化失败"
  defp translate_val(:reason_code, :persistence_failed), do: "持久化失败"
  defp translate_val(:reason_code, :unknown_tool), do: "未知工具"
  defp translate_val(:reason_code, :tool_not_dispatchable), do: "工具不可用"
  defp translate_val(:reason_code, :grant_scope_violation), do: "权限不足"
  defp translate_val(:reason_code, :no_handler), do: "无处理器"
  defp translate_val(_key, v) when is_atom(v), do: v
  defp translate_val(_key, v), do: inspect(v)

  # ── JSONL file output (ADR-0018 §4) ─────────────

  # Async fire-and-forget — never blocks the caller.  Test env no-ops.
  defp maybe_write_jsonl(entry) do
    if Application.get_env(:novel_common, :log_jsonl_enabled, false) do
      dir = Application.get_env(:novel_common, :log_jsonl_dir) || default_app_log_dir()
      Task.start(fn -> write_jsonl(dir, entry) end)
    end
  end

  defp write_jsonl(dir, entry) do
    date = Date.utc_today() |> Date.to_iso8601()
    path = Path.join(dir, "#{date}.jsonl")

    record =
      entry
      |> Map.put(:timestamp, format_ts_for_jsonl(Map.get(entry, :timestamp)))

    case Jason.encode(record) do
      {:ok, json} ->
        File.mkdir_p!(dir)
        File.write!(path, json <> "\n", [:append])

      _ ->
        :ok
    end
  end

  defp format_ts_for_jsonl(%DateTime{} = dt), do: DateTime.to_iso8601(dt)
  defp format_ts_for_jsonl(other) when is_binary(other), do: other

  defp default_app_log_dir do
    env_dir = Mix.env() |> Atom.to_string()
    Path.join([@project_root_dir, "log", "app", env_dir])
  end

  # ── helpers ───────────────────────────────────

  defp outcome_for(:start), do: "start"
  defp outcome_for(:done), do: "ok"
  defp outcome_for(:error), do: "error"

  @reserved_keys [:event, :outcome, :duration_ms, :timestamp]

  defp strip_reserved(fields) do
    Map.drop(fields, @reserved_keys)
  end

  defp maybe_put_from_meta(map, _key, nil), do: map

  defp maybe_put_from_meta(map, key, metadata) do
    case Keyword.fetch(metadata, key) do
      {:ok, nil} -> map
      {:ok, val} -> Map.put(map, key, val)
      :error -> map
    end
  end
end
