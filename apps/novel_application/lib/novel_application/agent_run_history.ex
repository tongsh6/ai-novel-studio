defmodule NovelApplication.AgentRunHistory do
  @moduledoc """
  解析一条已持久化的 work/session/turn 结果实际归属的 AgentRun。

  持久 assistant Interaction 是绑定来源：`content.agent_run_id` 与已提交
  TurnResult 的 `agent_run.run_id` 同时存在时必须一致。显式绑定要核对持久 run 的
  work/session/parent 事实与真实非空 workspace 命名空间，永不回退到“同 parent 的
  最新 run”。workspace_id 是 Channel topic 命名空间，不要求等于 work_id。

  只有完全没有任何显式绑定的旧数据才允许兼容查找：同 scope parent turn 的唯一 run，
  或 child turn（`<parent>:agent:<sequence>`）中带真实持久 step 的唯一 run。缺失 run
  返回 `:not_applicable`；多义、scope 不符或显式但畸形都返回错误，由消费者 fail closed。

  本模块是历史读取边界：会按 work/session 批量查询持久层并返回已核验的 run 记录，
  不是纯函数；它不调用 Provider、不写状态，也不向作者暴露原始历史。
  """

  alias NovelApplication.AgentRunFlows.TurnBinding
  alias NovelPersistence.{AgentRunLog, WorkSessionRepo}

  @type resolution ::
          {:ok, map(), :explicit | :legacy} | :not_applicable | {:error, atom()}

  @doc "按持久 assistant Interaction 解析单个 turn；没有 Interaction 时只走旧数据查找。"
  @spec resolve(String.t(), String.t(), String.t()) :: resolution()
  def resolve(work_id, session_id, turn_id)
      when is_binary(work_id) and is_binary(session_id) and is_binary(turn_id) do
    entries = WorkSessionRepo.assistant_entries(work_id, session_id, [turn_id])

    work_id
    |> resolve_entries(session_id, entries, [turn_id])
    |> Map.get(turn_id, :not_applicable)
  end

  @doc """
  批量解析已加载的 transcript，避免逐条重查 Interaction。

  调用方传入的 assistant rows 必须确实属于给定 work/session；来源不符时不采用该 row，
  也不会转而相信它携带的 run 身份。一次 scoped run 查询、一次 scoped step 查询，
  只有需要时再查 parent run。
  """
  @spec resolve_transcript_entries(String.t(), String.t(), [map()]) ::
          %{String.t() => resolution()}
  def resolve_transcript_entries(work_id, session_id, entries)
      when is_binary(work_id) and is_binary(session_id) and is_list(entries) do
    entries = Enum.filter(entries, &assistant_entry?/1)

    turn_ids =
      entries
      |> Enum.map(&entry_turn_id/1)
      |> Enum.reject(&blank?/1)
      |> Enum.uniq()

    resolve_entries(work_id, session_id, entries, turn_ids)
  end

  defp resolve_entries(_work_id, _session_id, _entries, []), do: %{}

  defp resolve_entries(work_id, session_id, entries, turn_ids) do
    grouped = Enum.group_by(entries, &entry_turn_id/1)

    analyses =
      Map.new(turn_ids, fn turn_id ->
        {turn_id, analyze_entries(Map.get(grouped, turn_id, []), turn_id, work_id, session_id)}
      end)

    explicit_run_ids =
      analyses
      |> Enum.flat_map(fn {_turn_id, analysis} ->
        Map.get(analysis, :explicit_run_ids, [])
      end)
      |> Enum.uniq()

    parent_turn_refs =
      turn_ids
      |> Kernel.++(Enum.map(turn_ids, &child_parent_turn/1))
      |> Enum.reject(&blank?/1)
      |> Enum.uniq()

    runs_by_id = load_runs_by_id(work_id, session_id, explicit_run_ids)
    runs_by_parent = load_runs_by_parent(work_id, session_id, parent_turn_refs)

    steps_by_run =
      work_id
      |> verified_run_ids(session_id, runs_by_id, runs_by_parent)
      |> AgentRunLog.list_steps_by_run_ids()

    Map.new(analyses, fn {turn_id, analysis} ->
      {turn_id,
       resolve_analysis(
         analysis,
         runs_by_id,
         runs_by_parent,
         steps_by_run,
         work_id,
         session_id
       )}
    end)
  end

  defp analyze_entries(entries, turn_id, work_id, session_id) do
    with :ok <- ensure_entry_scopes(entries, work_id, session_id),
         {:ok, run_ids, parent_refs} <- binding_facts(entries) do
      explicit_run_ids = Enum.uniq(run_ids)

      cond do
        turn_mismatch?(entries) ->
          %{error: :history_turn_mismatch}

        length(explicit_run_ids) > 1 ->
          %{error: :history_binding_conflict}

        true ->
          %{
            turn_id: turn_id,
            explicit_run_ids: explicit_run_ids,
            parent_turn_refs: Enum.uniq(parent_refs),
            error: nil
          }
      end
    else
      {:error, reason} -> %{error: reason}
    end
  end

  defp turn_mismatch?(entries) do
    Enum.any?(entries, fn entry ->
      result_turn = result_turn_id(entry)
      not is_nil(result_turn) and result_turn != entry_turn_id(entry)
    end)
  end

  # 显式绑定字段必须区分“未提供”和“提供了畸形值”。false、空串、数字都不是 run id，
  # 不能因为 filter/blank 后变空就回退到唯一 parent。
  defp binding_facts(entries) do
    Enum.reduce_while(entries, {:ok, [], []}, fn entry, {:ok, run_ids, parent_refs} ->
      result = result(entry)
      agent_run = value(result, :agent_run)

      fields = [
        {value(entry, :content), :agent_run_id, :run},
        {agent_run, :run_id, :run},
        {result, :parent_turn_id, :parent},
        {agent_run, :parent_turn_ref, :parent}
      ]

      case collect_binding_fields(fields) do
        {:ok, run_id, parent_ref} ->
          {:cont, {:ok, run_id ++ run_ids, parent_ref ++ parent_refs}}

        {:error, reason} ->
          {:halt, {:error, reason}}
      end
    end)
  end

  defp collect_binding_fields(fields) do
    Enum.reduce_while(fields, {:ok, [], []}, fn {map, key, kind}, {:ok, run_ids, parent_refs} ->
      case binding_field(map, key) do
        :absent ->
          {:cont, {:ok, run_ids, parent_refs}}

        {:ok, value} when kind == :run ->
          {:cont, {:ok, [value | run_ids], parent_refs}}

        {:ok, value} ->
          {:cont, {:ok, run_ids, [value | parent_refs]}}

        {:error, reason} ->
          {:halt, {:error, reason}}
      end
    end)
  end

  defp binding_field(map, key) do
    case fetch(map, key) do
      :absent ->
        :absent

      {:ok, nil} ->
        :absent

      {:ok, value} when is_binary(value) ->
        if String.trim(value) == "",
          do: {:error, :history_binding_malformed},
          else: {:ok, value}

      {:ok, _other} ->
        {:error, :history_binding_malformed}
    end
  end

  defp resolve_analysis(%{error: reason}, _runs, _parents, _steps, _work, _session)
       when not is_nil(reason),
       do: {:error, reason}

  defp resolve_analysis(
         %{explicit_run_ids: [run_id]} = analysis,
         runs,
         _parents,
         _steps,
         work,
         session
       ) do
    case Map.get(runs, run_id) do
      nil ->
        {:error, :history_run_missing}

      run ->
        with :ok <- ensure_scope(run, work, session),
             :ok <- ensure_parent_refs(run, analysis.parent_turn_refs) do
          {:ok, run, :explicit}
        end
    end
  end

  defp resolve_analysis(
         %{explicit_run_ids: []} = analysis,
         _runs,
         parents,
         steps,
         work,
         session
       ) do
    direct = Map.get(parents, analysis.turn_id, [])

    with :ok <- ensure_runs_scope(direct, work, session) do
      resolve_direct(analysis, direct, parents, steps, work, session)
    end
  end

  defp resolve_direct(analysis, [run], _parents, _steps, _work, _session) do
    legacy_result(analysis, run)
  end

  defp resolve_direct(_analysis, direct, _parents, _steps, _work, _session)
       when length(direct) > 1,
       do: {:error, :history_ambiguous}

  defp resolve_direct(analysis, [], parents, steps, work, session) do
    resolve_child_step(analysis, parents, steps, work, session)
  end

  defp resolve_child_step(analysis, parents, steps, work, session) do
    case TurnBinding.parse(analysis.turn_id) do
      {:ok, parent_turn, sequence} ->
        candidates = Map.get(parents, parent_turn, [])

        with :ok <- ensure_runs_scope(candidates, work, session) do
          matches = Enum.filter(candidates, &persisted_step?(&1, sequence, steps))
          resolve_step_matches(matches, analysis)
        end

      :error ->
        :not_applicable
    end
  end

  defp resolve_step_matches(matches, analysis) do
    case matches do
      [] -> :not_applicable
      [run] -> legacy_result(analysis, run)
      _many -> {:error, :history_ambiguous}
    end
  end

  defp legacy_result(analysis, run) do
    with :ok <- ensure_parent_refs(run, analysis.parent_turn_refs) do
      {:ok, run, :legacy}
    end
  end

  defp persisted_step?(run, sequence, steps) do
    steps
    |> Map.get(run.id, [])
    |> Enum.any?(&(&1.sequence == sequence))
  end

  defp ensure_entry_scopes(entries, work_id, session_id) do
    if Enum.all?(entries, fn entry ->
         value(entry, :workspace_id) == work_id and value(entry, :session_id) == session_id
       end) do
      :ok
    else
      {:error, :history_scope_mismatch}
    end
  end

  defp ensure_runs_scope(runs, work_id, session_id) do
    if Enum.all?(runs, &(ensure_scope(&1, work_id, session_id) == :ok)) do
      :ok
    else
      {:error, :history_scope_mismatch}
    end
  end

  # workspace_id 是 Channel topic 的命名空间，不要求等于 work_id；但必须是真实、
  # 非空字符串，不能靠 nil/空串绕过归属校验。
  defp ensure_scope(run, work_id, session_id) do
    if run.work_id == work_id and run.session_id == session_id and
         valid_workspace_namespace?(run.workspace_id) do
      :ok
    else
      {:error, :history_scope_mismatch}
    end
  end

  defp valid_workspace_namespace?(workspace_id) when is_binary(workspace_id),
    do: String.trim(workspace_id) != ""

  defp valid_workspace_namespace?(_workspace_id), do: false

  defp ensure_parent_refs(_run, []), do: :ok

  defp ensure_parent_refs(run, parent_refs) do
    if Enum.all?(parent_refs, &(&1 == run.parent_turn_ref)) do
      :ok
    else
      {:error, :history_parent_conflict}
    end
  end

  defp load_runs_by_id(_work_id, _session_id, []), do: %{}

  defp load_runs_by_id(work_id, session_id, run_ids) do
    work_id
    |> AgentRunLog.list_by_ids(session_id, run_ids)
    |> Map.new(&{&1.id, &1})
  end

  defp verified_run_ids(work_id, session_id, runs_by_id, runs_by_parent) do
    (Map.values(runs_by_id) ++ Enum.flat_map(runs_by_parent, fn {_turn, runs} -> runs end))
    |> Enum.filter(&(ensure_scope(&1, work_id, session_id) == :ok))
    |> Enum.map(& &1.id)
    |> Enum.uniq()
  end

  defp load_runs_by_parent(work_id, session_id, parent_turn_refs) do
    work_id
    |> AgentRunLog.list_by_parent_turns(session_id, parent_turn_refs)
    |> Enum.group_by(& &1.parent_turn_ref)
  end

  defp child_parent_turn(turn_id) do
    case TurnBinding.parse(turn_id) do
      {:ok, parent, _sequence} -> parent
      :error -> nil
    end
  end

  defp assistant_entry?(entry), do: value(entry, :role) == "assistant"

  defp entry_turn_id(entry), do: value(entry, :turn_id)

  defp result(entry) do
    entry
    |> value(:content)
    |> value(:turn_result)
  end

  defp result_turn_id(entry), do: entry |> result() |> value(:turn_id)

  defp fetch(map, key) when is_map(map) do
    cond do
      Map.has_key?(map, key) -> {:ok, Map.get(map, key)}
      Map.has_key?(map, Atom.to_string(key)) -> {:ok, Map.get(map, Atom.to_string(key))}
      true -> :absent
    end
  end

  defp fetch(_map, _key), do: :absent

  defp value(map, key) do
    case fetch(map, key) do
      {:ok, value} -> value
      :absent -> nil
    end
  end

  defp blank?(nil), do: true
  defp blank?(value) when is_binary(value), do: String.trim(value) == ""
  defp blank?(_value), do: false
end
