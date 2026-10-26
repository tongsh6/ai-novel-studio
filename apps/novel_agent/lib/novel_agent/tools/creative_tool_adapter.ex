defmodule NovelAgent.Tools.CreativeToolAdapter do
  @moduledoc false

  alias NovelAgent.Provider.Execution
  alias NovelCommon.AuthoringSemantics
  alias NovelCommon.Contracts.AuthoringTask
  alias NovelCommon.Contracts.CreativeProviderResult
  alias NovelCommon.Contracts.CreativeRequest
  alias NovelCommon.Contracts.ToolOutputContract
  alias NovelCommon.Contracts.ToolRequest
  alias NovelCommon.Contracts.ToolResult

  @companion_artifact_order [
    :character_seed,
    :foreshadowing_seed,
    :world_rule_seed,
    :constraint_seed
  ]

  @spec execute(ToolRequest.t(), atom(), Execution.dependency(), module()) ::
          ToolResult.t()
  def execute(%ToolRequest{} = req, artifact_type, provider_execution, provider_module) do
    result_id = NovelFoundation.ID.unique("tr")
    now = DateTime.utc_now()

    with {:ok, normalized_type} <- ToolOutputContract.normalize_artifact_type(artifact_type),
         {:ok, request} <- creative_request(req, normalized_type) do
      request
      |> provider_module.generate(provider_execution)
      |> provider_result_to_tool_result(req, result_id, now, normalized_type)
    else
      {:error, %{code: code, message: message}} ->
        failed_tool_result(req, result_id, now, [%{code: code, message: message}])
    end
  end

  defp creative_request(%ToolRequest{} = req, artifact_type) do
    with {:ok, task} <- authoring_task(req.input) do
      {:ok, build_request(req, artifact_type, task)}
    end
  end

  defp build_request(%ToolRequest{} = req, artifact_type, task) do
    %CreativeRequest{
      request_id: "cr_#{req.tool_request_id}",
      tool_name: req.tool_name,
      artifact_type: artifact_type,
      creative_brief: Map.get(req.input, "creative_brief") || Map.get(req.input, "text", ""),
      context_text: Map.get(req.input, "context_text", ""),
      source_turn_ref: req.turn_id,
      # VS-00E：application 把已渲染的场级执行简述文本放入 input["execution_brief"]，
      # 透传给 provider；缺省 nil 时 provider message 不变（兼容三锚点）。
      execution_brief: optional_text(Map.get(req.input, "execution_brief")),
      # VS-00F CP1：账面投影文本（progress_state_packet 传输载体）同型透传。
      progress_state: optional_text(Map.get(req.input, "progress_state")),
      # WR02：规划前推理结论文本同型透传（仅 plot_outline 路径非空）。
      planning_mission: optional_text(Map.get(req.input, "planning_mission")),
      decision_packet: optional_map(Map.get(req.input, "decision_packet")),
      # VS-00E CP3：按质量发现重写的要求文本放入 input["revision"]，同样透传给 provider。
      revision: optional_text(Map.get(req.input, "revision")),
      # B27 CP3b：专业调用共同任务语义（application 组装、common 校验后由本 adapter 恢复）。
      # 无 task 的旧调用保持 nil（迁移期兼容，CP3d 清理清单）。
      task: task,
      provider_hints: Map.get(req.input, "provider_hints", %{})
    }
  end

  # 从 ToolRequest.input["authoring_task"]（JSON-safe map）恢复并校验 task。
  # B27 CP3d：creative 调用强制携带 task；缺失/校验失败返回可解释错误，不静默回退。
  defp authoring_task(input) when is_map(input) do
    case Map.get(input, "authoring_task") || Map.get(input, :authoring_task) do
      nil -> {:error, authoring_task_required_error()}
      %AuthoringTask{} = task -> validate_authoring_task(task)
      map when is_map(map) -> map |> AuthoringTask.from_map() |> validate_authoring_task()
      _other -> {:error, authoring_task_error(:not_a_task)}
    end
  end

  defp authoring_task(_input), do: {:error, authoring_task_required_error()}

  defp authoring_task_required_error do
    %{
      code: "authoring_task_required",
      message: "creative calls require ToolRequest.input[\"authoring_task\"]"
    }
  end

  defp validate_authoring_task(nil), do: {:error, authoring_task_error(:not_a_task)}

  defp validate_authoring_task(%AuthoringTask{} = task) do
    case AuthoringSemantics.validate(task) do
      {:ok, task} -> {:ok, task}
      {:error, reason} -> {:error, authoring_task_error(reason)}
    end
  end

  defp authoring_task_error(reason) do
    %{code: "authoring_task_invalid", message: "invalid authoring task: #{inspect(reason)}"}
  end

  defp optional_text(value) when is_binary(value) do
    if String.trim(value) == "", do: nil, else: value
  end

  defp optional_text(_value), do: nil

  defp optional_map(value) when is_map(value), do: value
  defp optional_map(_value), do: nil

  defp provider_result_to_tool_result(
         %CreativeProviderResult{
           status: :ok,
           items: items,
           companion_artifacts: companion_artifacts,
           self_report: self_report
         },
         req,
         result_id,
         now,
         artifact_type
       ) do
    case validate_provider_output(req, artifact_type, items, companion_artifacts) do
      {:ok, normalized_items, normalized_companions} ->
        succeeded_tool_result(
          req,
          result_id,
          now,
          artifact_type,
          normalized_items,
          normalized_companions,
          self_report
        )

      {:error, %{code: code, message: message}} ->
        failed_tool_result(req, result_id, now, [%{code: code, message: message}])
    end
  end

  defp provider_result_to_tool_result(
         %CreativeProviderResult{status: :error, errors: errors},
         req,
         result_id,
         now,
         _artifact_type
       ),
       do: failed_tool_result(req, result_id, now, errors)

  defp validate_provider_output(req, artifact_type, items, companion_artifacts) do
    with {:ok, normalized_items} <- ToolOutputContract.validate_creative_items(items),
         {:ok, normalized_items} <-
           attach_outline_chapter_refs(req.tool_name, items, normalized_items),
         {:ok, normalized_companions} <-
           ToolOutputContract.validate_prose_companion_artifacts(companion_artifacts),
         :ok <- validate_companion_scope(req.tool_name, normalized_companions),
         :ok <-
           ToolOutputContract.validate_artifact_shape(
             artifact_type,
             normalized_items,
             normalized_companions
           ),
         :ok <-
           ToolOutputContract.validate_unique_item_ids(normalized_items, normalized_companions) do
      {:ok, normalized_items, normalized_companions}
    end
  end

  # B30 CP3-P2：plot_outline 可选 chapter_ref 透传。ToolOutputContract 白名单会丢弃未知字段，
  # 这里从 provider 原始 item 按 item_id 重挂；形状非法直接拒绝（不静默丢 ref 退回 title 新建）。
  defp attach_outline_chapter_refs("plot_outline", raw_items, normalized_items) do
    with {:ok, refs_by_item} <- raw_chapter_refs(raw_items),
         :ok <- validate_unique_chapter_refs(refs_by_item) do
      {:ok, merge_chapter_refs(normalized_items, refs_by_item)}
    end
  end

  defp attach_outline_chapter_refs(_tool_name, _raw_items, normalized_items),
    do: {:ok, normalized_items}

  defp merge_chapter_refs(items, refs) do
    Enum.map(items, fn item -> put_chapter_ref(item, Map.get(refs, item.item_id)) end)
  end

  defp put_chapter_ref(item, nil), do: item
  defp put_chapter_ref(item, ref), do: Map.put(item, :chapter_ref, ref)

  defp raw_chapter_refs(raw_items) when is_list(raw_items) do
    Enum.reduce_while(raw_items, {:ok, %{}}, fn raw, {:ok, acc} ->
      with true <- is_map(raw),
           item_id when is_binary(item_id) <- map_get(raw, :item_id),
           {:ok, ref} <- normalize_optional_chapter_ref(map_get(raw, :chapter_ref)) do
        {:cont, {:ok, if(ref, do: Map.put(acc, item_id, ref), else: acc)}}
      else
        false ->
          {:cont, {:ok, acc}}

        nil ->
          {:cont, {:ok, acc}}

        {:error, reason} ->
          {:halt, {:error, reason}}
      end
    end)
  end

  defp raw_chapter_refs(_raw_items), do: {:ok, %{}}

  defp normalize_optional_chapter_ref(nil), do: {:ok, nil}
  defp normalize_optional_chapter_ref(""), do: {:ok, nil}

  defp normalize_optional_chapter_ref(ref) when is_binary(ref) do
    if chapter_ref?(ref) do
      {:ok, ref}
    else
      {:error,
       %{
         code: "invalid_chapter_ref",
         message: "plot_outline chapter_ref 必须形如 chapter:<uuid>，不得编造或改写：#{inspect(ref)}"
       }}
    end
  end

  defp normalize_optional_chapter_ref(ref) do
    {:error,
     %{
       code: "invalid_chapter_ref",
       message: "plot_outline chapter_ref 必须是字符串或省略：#{inspect(ref)}"
     }}
  end

  defp chapter_ref?(ref),
    do:
      Regex.match?(
        ~r/^chapter:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/,
        ref
      )

  defp validate_unique_chapter_refs(refs_by_item) do
    refs = refs_by_item |> Map.values() |> Enum.filter(&is_binary/1)

    if length(refs) == length(Enum.uniq(refs)) do
      :ok
    else
      {:error,
       %{
         code: "duplicate_chapter_ref",
         message: "plot_outline 同一已存在章不能被多个条目重复绑定 chapter_ref"
       }}
    end
  end

  defp map_get(map, key) when is_map(map),
    do: Map.get(map, key) || Map.get(map, Atom.to_string(key))

  defp map_get(_map, _key), do: nil

  defp validate_companion_scope("prose_writing", _companion_artifacts), do: :ok
  defp validate_companion_scope(_tool_name, []), do: :ok

  defp validate_companion_scope(_tool_name, _companion_artifacts) do
    {:error,
     %{
       code: "unexpected_companion_artifacts",
       message: "companion artifacts are only allowed for prose_writing"
     }}
  end

  defp succeeded_tool_result(
         req,
         result_id,
         now,
         artifact_type,
         items,
         companion_artifacts,
         self_report
       ) do
    companion_groups = companion_groups(companion_artifacts)
    all_items = items ++ companion_artifacts

    %ToolResult{
      tool_result_id: result_id,
      tool_request_ref: req.tool_request_id,
      tool_name: req.tool_name,
      status: :succeeded,
      output:
        %{
          output_contract_ref: "tentative_artifact_v1",
          artifact_type: artifact_type,
          item_count: length(items),
          items: items,
          companion_item_count: length(companion_artifacts),
          companion_artifacts: companion_groups
        }
        |> maybe_put_self_report(self_report),
      state_delta:
        ([%{type: :tentative_artifact, key: req.tool_name, artifact_type: artifact_type}] ++
           Enum.map(companion_groups, fn group ->
             %{
               type: :tentative_artifact,
               key: req.tool_name,
               artifact_type: group.artifact_type
             }
           end))
        |> maybe_add_self_report_delta(self_report),
      artifact_refs: Enum.map(all_items, & &1.item_id),
      warnings: self_report_warnings(self_report),
      usage: %{duration_ms: 0, tool: req.tool_name, version: req.tool_version},
      trace_refs: ["tool_trace:#{result_id}"],
      completed_at: now
    }
  end

  defp companion_groups(items) when is_list(items) do
    grouped = Enum.group_by(items, & &1.artifact_type)

    @companion_artifact_order
    |> Enum.flat_map(fn artifact_type ->
      case Map.get(grouped, artifact_type, []) do
        [] ->
          []

        grouped_items ->
          [
            %{
              artifact_type: artifact_type,
              items: Enum.map(grouped_items, &Map.delete(&1, :artifact_type))
            }
          ]
      end
    end)
  end

  defp maybe_put_self_report(output, nil), do: output
  defp maybe_put_self_report(output, self_report), do: Map.put(output, :self_report, self_report)

  defp maybe_add_self_report_delta(state_delta, nil), do: state_delta

  defp maybe_add_self_report_delta(state_delta, self_report) do
    state_delta ++
      [%{type: :observation, key: "creative_output_self_report", value: self_report}]
  end

  defp self_report_warnings(nil), do: []

  defp self_report_warnings(%{risk_flags: []}), do: []

  defp self_report_warnings(%{risk_flags: flags, quality_action: action}) do
    [
      %{
        code: "creative_output_self_report",
        message: "creative output self_report contains non-authoritative risk flags",
        quality_action: action,
        risk_flags: flags
      }
    ]
  end

  defp self_report_warnings(_self_report), do: []

  defp failed_tool_result(req, result_id, now, errors) do
    %ToolResult{
      tool_result_id: result_id,
      tool_request_ref: req.tool_request_id,
      tool_name: req.tool_name,
      status: :failed,
      output: nil,
      errors: errors,
      artifact_refs: [],
      state_delta: [],
      completed_at: now
    }
  end
end
