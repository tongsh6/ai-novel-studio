# B27 CP4 integrated 臂 episode 支撑：隔离夹具 seed + 生产入口驱动 + provider 边界采集。
#
# 归属：`scripts/model_contracts/b27_semantic_eval.exs --arm integrated` 的私有支撑。
# 不修改产品代码，不写作者真实作品数据；所有 fixture 来自
# `quality/acceptance/fixtures/b27-semantic-cases/cases.yml#fixtures`（虚构样书）。
#
# 边界：
#   - 组装/运行入口与 CP0 冻结完全同源：`DialoguePlanningService.plan_agent_run/3`
#     + 判断循环真实 planner + 真实 `AgentRun` step；本模块只驱动 step 到 complete。
#   - provider 不是合成替身：通过生产 `NovelAgent.Provider.Execution.dependency/1`
#     走 Gateway → 真实 provider（LM Studio / Strata）。请求/响应由调用方在
#     provider adapter 的 `log_fn` 边界采集（见 eval 脚本 install_wire_capture）。
#   - 夹具 UUID 复用 CP0 的确定性派生（`b27-cp0:` 命名空间），使 integrated 臂与
#     CP0 old_rules 快照的材料 refs 可比，不重新发明一套 ref。
#   - 每例在 Ecto Sandbox 事务内 seed 并运行，Task 结束自动回滚；不污染默认 test DB。
#
# 注意：本文件只定义模块，由 eval 脚本 `Code.require_file/1` 加载。

defmodule B27EpisodeSupport do
  @moduledoc false

  alias Ecto.Adapters.SQL.Sandbox
  alias NovelAgent.Provider.Execution
  alias NovelApplication.DialoguePlanningService
  alias NovelDomain.AgentRun
  alias NovelPersistence.Repo

  alias NovelPersistence.Schemas.{
    Chapter,
    Character,
    Draft,
    Interaction,
    Scene,
    Volume,
    Work,
    WorkSession
  }

  require Logger

  @type fixture_bundle :: %{work_defaults: map(), prose: map()}
  @type episode_opts :: %{
          max_steps: pos_integer(),
          episode_timeout_ms: pos_integer(),
          capture_pid: pid()
        }

  # ── 独立 DB（调用方只跑 integrated 臂时要求）─────────────────────────────

  @doc """
  确保当前 test DB 落在 B27 CP4 独立目录，并跑迁移、开启真实 persistence 注入。

  `db_marker` 例如 "b27-cp4"；用于拒绝误连默认 test DB。
  """
  def ensure_isolated_db!(db_marker) do
    db = Repo.config()[:database] |> to_string()

    unless String.contains?(db, db_marker) do
      IO.puts("""
      [b27-cp4] 拒绝运行 integrated 臂：当前 test DB 不在独立 CP4 目录。
        database = #{db}

      必须使用：
        MIX_ENV=test NOVEL_TEST_DB_DIR=artifacts/model-contracts/b27-cp4/db MIX_TEST_PARTITION=b27cp4 \\
          mix run scripts/model_contracts/b27_semantic_eval.exs --arm integrated ...
      """)

      System.halt(2)
    end

    File.mkdir_p!(Path.dirname(db))
    Sandbox.mode(Repo, :auto)

    unless File.exists?(db) do
      case Repo.__adapter__().storage_up(Repo.config()) do
        :ok -> :ok
        {:error, :already_up} -> :ok
        {:error, reason} -> raise "storage_up failed: #{inspect(reason)}"
      end
    end

    migrations = Application.app_dir(:novel_persistence, "priv/repo/migrations")
    applied = Ecto.Migrator.run(Repo, migrations, :up, all: true)
    if applied != [], do: IO.puts("[b27-cp4] migrations applied: #{inspect(applied)}")

    Sandbox.mode(Repo, :manual)
    Application.put_env(:novel_web, :persistence, inject_real_persistence: true)
    :ok
  end

  # ── 单 episode：Sandbox 内 seed → 生产入口驱动 → 证据 ─────────────────────

  @doc """
  在独立 Sandbox 事务里 seed 该案例夹具，并用生产入口跑完整判断循环 episode。

  返回 `{:ok, evidence}` 或 `{:error, %{class: atom(), message: binary()}}`。
  evidence 含 rounds（逐步）、provider_calls（由 log_fn 采集，调用方读取）、
  turn_result 摘要、是否 complete、耗时。
  """
  def run_case_episode(case_id, case_spec, fixture_bundle, opts) do
    task =
      Task.async(fn ->
        :ok = Sandbox.checkout(Repo)

        case seed_fixture!(case_id, fixture_bundle, get(case_spec, "fixture") || %{}) do
          {:ok, seeded} ->
            reset_capture!(opts.capture_pid)
            run_steps(seeded, to_string(get(case_spec, "author_input") || ""), opts)

          {:error, reason} ->
            {:error, reason}
        end
      end)

    case Task.yield(task, opts.episode_timeout_ms) do
      {:ok, result} ->
        result

      {:exit, reason} ->
        {:error, %{class: :task_crash, message: truncate(inspect(reason), 800)}}

      nil ->
        _ = Task.shutdown(task, :brutal_kill)

        {:error,
         %{class: :episode_timeout, message: "episode wall clock > #{opts.episode_timeout_ms}ms"}}
    end
  rescue
    error ->
      {:error, %{class: :runner_exception, message: Exception.message(error)}}
  catch
    kind, reason ->
      {:error, %{class: :runner_exception, message: truncate(inspect({kind, reason}), 800)}}
  end

  # ── 生产判断循环驱动（与 AgentRunServer 相同的 step 语义，脚本内联合收敛）────

  defp run_steps(seeded, author_text, opts) do
    input = build_input(seeded, author_text)
    started = System.monotonic_time(:millisecond)

    with {:ok, spec} <-
           DialoguePlanningService.plan_agent_run(
             input,
             NovelApplication.persistence_fetcher(),
             # 与 channel 生产入口默认一致：plan_agent_run/2 的默认 dependency。
             Execution.dependency(purpose: :conversation)
           ),
         {:ok, run} <- AgentRun.new(spec.run_attrs) do
      Process.put(:b27_cp4_stage_events, [])
      snapshot = %{stage_state: %{}, observations: [], events: [], stage_sink: stage_sink()}

      loop(spec.next_step_planner, run, 1, snapshot, opts, [], 0, started)
    else
      {:error, reason} ->
        {:error, %{class: :planning_failed, message: truncate(inspect(reason), 800)}}
    end
  rescue
    error ->
      {:error,
       %{
         class: :runner_exception,
         message: Exception.message(error),
         stacktrace: Exception.format_stacktrace(__STACKTRACE__) |> truncate(2_000)
       }}
  catch
    kind, reason ->
      {:error, %{class: :runner_exception, message: truncate(inspect({kind, reason}), 800)}}
  end

  defp loop(planner, run, sequence, snapshot, opts, rounds, call_cursor, started) do
    if sequence > opts.max_steps do
      {:ok,
       finish_episode(:max_steps_reached, run, rounds, opts.capture_pid, call_cursor, started)}
    else
      case safe_planner(planner, run, sequence, snapshot) do
        {:execute, step, planner_decision, planner_meta} ->
          events_before = events_count()
          step_started = System.monotonic_time(:millisecond)
          outcome = safe_step(step, run, sequence, snapshot)
          duration = System.monotonic_time(:millisecond) - step_started
          {new_calls, new_cursor} = drain_calls(opts.capture_pid, call_cursor)

          round = %{
            "sequence" => sequence,
            "planner_decision" => safe_inspect(planner_decision, 300),
            "planner_meta" => safe_inspect(planner_meta, 300),
            "duration_ms" => duration,
            "provider_call_count" => length(new_calls),
            "calls" => new_calls,
            "events" => slice_events(events_before),
            "outcome" => step_outcome_summary(outcome)
          }

          case outcome do
            {:ok, step_result} when is_map(step_result) ->
              run2 = apply_run_patch(run, get(step_result, :run_patch))
              snapshot2 = merge_snapshot(snapshot, step_result)
              rounds2 = [round | rounds]

              loop(
                planner,
                run2,
                sequence + 1,
                snapshot2,
                opts,
                rounds2,
                new_cursor,
                started
              )

            {:error, reason} ->
              {:error,
               %{
                 class: :step_error,
                 message: truncate(inspect(reason), 1_200),
                 round: round,
                 rounds: Enum.reverse(rounds),
                 partial_provider_calls: total_calls(opts.capture_pid),
                 elapsed_ms: System.monotonic_time(:millisecond) - started
               }}

            other ->
              {:error,
               %{
                 class: :unexpected_step_result,
                 message: truncate(inspect(other), 800),
                 round: round,
                 rounds: Enum.reverse(rounds),
                 elapsed_ms: System.monotonic_time(:millisecond) - started
               }}
          end

        {:complete, planner_decision, planner_meta} ->
          {:ok,
           finish_episode(:complete, run, rounds, opts.capture_pid, call_cursor, started)
           |> Map.put("complete_decision", safe_inspect(planner_decision, 300))
           |> Map.put("complete_meta", safe_inspect(planner_meta, 300))}

        other ->
          {:error,
           %{
             class: :unexpected_planner_decision,
             message: truncate(inspect(other), 800),
             rounds: Enum.reverse(rounds),
             elapsed_ms: System.monotonic_time(:millisecond) - started
           }}
      end
    end
  end

  defp finish_episode(reason, run, rounds, capture_pid, call_cursor, started) do
    rounds = Enum.reverse(rounds)
    calls = all_calls(capture_pid) |> Enum.take(call_cursor)

    turn_result =
      rounds
      |> Enum.map(&get(get(&1, "outcome") || %{}, "turn_result"))
      |> Enum.reject(&is_nil/1)
      |> List.last()

    %{
      "status" => "ok",
      "end_reason" => to_string(reason),
      "run_ref" => get(run, :run_id),
      "profile_ref" => get(run, :profile_ref),
      "rounds_executed" => length(rounds),
      "rounds" => rounds,
      "provider_calls" => calls,
      "provider_call_count" => length(calls),
      "turn_result" => turn_result,
      "elapsed_ms" => System.monotonic_time(:millisecond) - started
    }
  end

  defp merge_snapshot(snapshot, step_result) do
    stage_state =
      Map.merge(
        Map.get(snapshot, :stage_state, %{}),
        get(step_result, :stage_state) || %{}
      )

    observations =
      Map.get(snapshot, :observations, []) ++ (get(step_result, :observations) || [])

    events = Map.get(snapshot, :events, []) ++ (get(step_result, :events) || [])

    %{snapshot | stage_state: stage_state, observations: observations, events: events}
  end

  # step 结果摘要：只记可判定事实，不序列化领域 struct。
  defp step_outcome_summary({:ok, step_result}) when is_map(step_result) do
    stage_state = get(step_result, :stage_state) || %{}

    %{
      "stage_state_keys" => stage_state |> Map.keys() |> Enum.map(&to_string/1) |> Enum.sort(),
      "provider_call_count" => get(step_result, :provider_call_count),
      "judgment_settled" => to_string_safe(get(stage_state, :judgment_settled)),
      "judgment_explorations" =>
        get(stage_state, :judgment_explorations)
        |> List.wrap()
        |> Enum.map(fn observation ->
          %{
            "tool" => to_string_safe(get(observation, :tool)),
            "query" => truncate(to_string_safe(get(observation, :query)), 300),
            "summary" => truncate(to_string_safe(get(observation, :summary)), 600),
            "refs" => get(observation, :refs) || [],
            "prose_range" => get(observation, :prose_range),
            "next_offset" => get(observation, :next_offset)
          }
        end),
      "turn_result" => turn_result_summary(get(step_result, :turn_result)),
      "progress_signature" => get(step_result, :progress_signature),
      "error" => step_error(get(step_result, :error))
    }
  end

  defp step_outcome_summary(other), do: %{"raw" => truncate(inspect(other), 800)}

  defp turn_result_summary(nil), do: nil

  defp turn_result_summary(turn_result) when is_map(turn_result) do
    assistant =
      get(turn_result, :assistant_message) || get(turn_result, "assistant_message") || %{}

    %{
      "text" => truncate(to_string_safe(get(assistant, :text) || get(assistant, "text")), 4_000),
      "turn_id" => to_string_safe(get(turn_result, :turn_id)),
      "truthfulness" => jsonable(get(turn_result, :truthfulness)),
      "adoption_state" => jsonable(get(turn_result, :adoption_state)),
      "run_status" => to_string_safe(get(turn_result, :run_status)),
      "goal_unfulfilled" => get(turn_result, :goal_unfulfilled)
    }
  end

  defp turn_result_summary(other), do: %{"raw" => truncate(inspect(other), 800)}

  defp step_error(nil), do: nil
  defp step_error(error), do: truncate(inspect(error), 800)

  # ── provider 边界采集读取（log_fn 由 eval 脚本安装在 adapter 配置上）────────

  defp reset_capture!(capture_pid), do: Agent.update(capture_pid, fn _ -> [] end)

  defp all_calls(capture_pid), do: Agent.get(capture_pid, & &1)

  defp drain_calls(capture_pid, cursor) do
    calls = all_calls(capture_pid)
    new_calls = Enum.drop(calls, cursor)
    {new_calls, length(calls)}
  end

  defp total_calls(capture_pid), do: length(all_calls(capture_pid))

  # ── stage sink：只留作者安全事件摘要（供证据核对）──────────────────────────

  defp stage_sink do
    fn event ->
      Process.put(:b27_cp4_stage_events, [event | Process.get(:b27_cp4_stage_events, [])])
      :ok
    end
  end

  defp events_count, do: length(Process.get(:b27_cp4_stage_events, []))

  defp slice_events(before) do
    Process.get(:b27_cp4_stage_events, [])
    |> Enum.take(before)
    |> Enum.reverse()
    |> Enum.map(fn event ->
      %{
        "event_type" => to_string_safe(get(event, :event_type)),
        "visibility" => to_string_safe(get(event, :visibility)),
        "summary" => truncate(to_string_safe(get(event, :summary)), 400),
        "step_ref" => to_string_safe(get(event, :step_ref))
      }
    end)
  end

  # ── 输入与 run patch（与生产入口同形）────────────────────────────────────

  defp build_input(seeded, author_text) do
    case_id = seeded.case_id
    turn_id = "turn_#{case_id}_current"

    %{
      text: author_text,
      workspace_id: seeded.work_id,
      work_id: seeded.work_id,
      session_id: seeded.session_id,
      turn_id: turn_id,
      trace_persister: NovelApplication.persistence_tracer(),
      memory_recorder: NovelApplication.persistence_interaction_recorder()
    }
  end

  defp apply_run_patch(run, patch) when is_map(patch) do
    %{
      run
      | profile_ref: get(patch, :profile_ref) || run.profile_ref,
        authority_scope: get(patch, :authority_scope) || run.authority_scope,
        plan: get(patch, :plan) || run.plan,
        plan_ref: get(patch, :plan_ref) || run.plan_ref,
        plan_version: get(patch, :plan_version) || run.plan_version,
        budget: get(patch, :budget) || run.budget
    }
  end

  defp apply_run_patch(run, _patch), do: run

  # ── 夹具 seed（与 CP0 freeze 同源；确定性 UUID 命名空间保持 b27-cp0）──────

  defp seed_fixture!(case_id, fixture_bundle, fixture) do
    work_defaults = Map.get(fixture_bundle, :work_defaults, %{})
    prose_lib = Map.get(fixture_bundle, :prose, %{})

    work_id = det_uuid("#{case_id}:work")
    session_id = det_uuid("#{case_id}:session")

    work_attrs =
      work_defaults
      |> Map.merge(get(fixture, "work") || %{})
      |> stringify()

    insert_work!(work_id, work_attrs)

    volume_id = det_uuid("#{case_id}:volume:1")
    insert_volume!(volume_id, work_id)

    chapters = get(fixture, "chapters") || []

    chapter_rows =
      Enum.map(chapters, &insert_chapter!(case_id, work_id, volume_id, &1, prose_lib))

    characters = get(fixture, "characters") || []
    Enum.each(characters, &insert_character!(case_id, work_id, &1))

    session_fixture = get(fixture, "session") || %{}
    session_row = insert_session!(work_id, session_id, session_fixture)
    turns = get(session_fixture, "turns") || []
    Enum.each(turns, &insert_turn!(work_id, session_row.id, &1))

    {:ok,
     %{
       case_id: case_id,
       work_id: work_id,
       work: Repo.get!(Work, work_id),
       session: session_row,
       session_id: session_id,
       chapters: chapter_rows
     }}
  rescue
    error -> {:error, %{class: :seed_failed, message: Exception.message(error)}}
  end

  defp insert_work!(work_id, attrs) do
    %Work{id: work_id}
    |> Work.changeset(%{
      title: attrs["title"] || "长夜灯楼",
      genre: attrs["genre"],
      status: "ACCEPTED",
      premise: attrs["premise"],
      theme: attrs["theme"],
      main_goal: attrs["main_goal"],
      target_length: attrs["target_length"],
      planned_volumes: attrs["planned_volumes"],
      serial_form: attrs["serial_form"],
      tone_preference: attrs["tone_preference"]
    })
    |> Repo.insert!()
  end

  defp insert_volume!(volume_id, work_id) do
    %Volume{id: volume_id}
    |> Volume.changeset(%{work_id: work_id, title: "卷一", seq: 1, status: "COMPLETED"})
    |> Repo.insert!()
  end

  defp insert_chapter!(case_id, work_id, volume_id, chapter, prose_lib) do
    seq = int(get(chapter, "seq"), 1)
    chapter_id = det_uuid("#{case_id}:chapter:#{seq}")

    prose_refs = get(chapter, "prose") || []
    long_prose = get(chapter, "long_prose")
    superseded = get(chapter, "superseded_prose") || []
    has_prose = prose_refs != [] or is_map(long_prose) or superseded != []

    row =
      %Chapter{id: chapter_id}
      |> Chapter.changeset(%{
        work_id: work_id,
        volume_id: volume_id,
        title: get(chapter, "title") || "第#{seq}章",
        seq: seq,
        status: if(has_prose, do: "COMPLETED", else: "PLANNED"),
        summary: get(chapter, "summary"),
        plan_direction: normalize_map(get(chapter, "plan_direction"))
      })
      |> Repo.insert!()

    Enum.with_index(prose_refs, 1)
    |> Enum.each(fn {ref, index} ->
      insert_scene_draft!(
        case_id,
        work_id,
        chapter_id,
        index,
        resolve_prose!(prose_lib, ref),
        "ACCEPTED"
      )
    end)

    if is_map(long_prose) do
      body =
        resolve_prose!(prose_lib, get(long_prose, "unit"))
        |> to_string()
        |> String.duplicate(int(get(long_prose, "repeat"), 200))

      content =
        [get(long_prose, "head") || "", body, get(long_prose, "tail") || ""]
        |> Enum.reject(&(&1 in [nil, ""]))
        |> Enum.join("\n")

      insert_scene_draft!(case_id, work_id, chapter_id, 900, content, "ACCEPTED")
    end

    Enum.with_index(superseded, 1)
    |> Enum.each(fn {ref, index} ->
      insert_scene_draft!(
        case_id,
        work_id,
        chapter_id,
        800 + index,
        resolve_prose!(prose_lib, ref),
        "SUPERSEDED"
      )
    end)

    if get(chapter, "summary_status") == "accepted" do
      NovelPersistence.ChapterSummaryRepo.insert(%{
        work_id: work_id,
        chapter_id: chapter_id,
        status: "ACCEPTED",
        summary_text: get(chapter, "summary") || "",
        source_ref: "summary:#{chapter_id}"
      })
    end

    row
  end

  defp insert_scene_draft!(case_id, work_id, chapter_id, index, content, status) do
    scene_id = det_uuid("#{case_id}:chapter:#{chapter_id}:scene:#{index}")

    %Scene{id: scene_id}
    |> Scene.changeset(%{
      work_id: work_id,
      chapter_id: chapter_id,
      title: "场#{index}",
      seq: index,
      status: "COMPLETED"
    })
    |> Repo.insert!()

    draft =
      %Draft{id: det_uuid("#{case_id}:chapter:#{chapter_id}:draft:#{index}")}
      |> Draft.changeset(%{
        work_id: work_id,
        scene_id: scene_id,
        content: content,
        status: "ACCEPTED",
        revision: 1
      })
      |> Repo.insert!()

    # ADR-0019：TENTATIVE→SUPERSEDED 不允许一跳，先落 ACCEPTED 再 SUPERSEDED。
    if status == "SUPERSEDED" do
      draft |> Draft.changeset(%{status: "SUPERSEDED"}) |> Repo.update!()
    else
      draft
    end
  end

  defp insert_character!(case_id, work_id, char) do
    name = get(char, "name") || "角色"

    %Character{id: det_uuid("#{case_id}:character:#{name}")}
    |> Character.changeset(%{
      work_id: work_id,
      name: name,
      role: get(char, "role"),
      narrative_role: get(char, "narrative_role"),
      summary: get(char, "summary"),
      status: get(char, "status") || "ACCEPTED"
    })
    |> Repo.insert!()
  end

  defp insert_session!(work_id, session_id, session_fixture) do
    %WorkSession{id: session_id}
    |> WorkSession.changeset(%{
      work_id: work_id,
      title: "B27-CP4 合成会话",
      status: "ACTIVE",
      summary: get(session_fixture, "summary")
    })
    |> Repo.insert!()
  end

  defp insert_turn!(work_id, session_id, turn) do
    turn_id = get(turn, "turn_id") || det_uuid("#{work_id}:#{get(turn, "user")}")
    user_text = get(turn, "user") || ""
    assistant_text = get(turn, "assistant") || ""
    pending = get(turn, "pending") || []
    resolved = get(turn, "resolved") || []

    truthfulness =
      get(turn, "truthfulness") ||
        %{"provider_calls" => 1, "tool_calls" => 0, "business_writes" => 0}

    insert_interaction!(work_id, session_id, turn_id, "user", %{
      "text" => user_text,
      "agent_run_id" => "run_#{turn_id}",
      "message_handling" => %{
        "status" => "completed",
        "result_turn_refs" => [turn_id],
        "processed_at" => "2026-10-24T00:00:00Z"
      }
    })

    insert_interaction!(work_id, session_id, turn_id, "assistant", %{
      "text" => assistant_text,
      "agent_run_id" => "run_#{turn_id}",
      "turn_result" => %{
        "turn_id" => turn_id,
        "assistant_message" => %{"text" => assistant_text},
        "truthfulness" => stringify(truthfulness),
        "adoption_state" => %{
          "pending" => Enum.map(pending, &adoption_entry(&1, turn_id)),
          "resolved" => Enum.map(resolved, &adoption_entry(&1, turn_id))
        }
      }
    })

    :ok
  end

  defp adoption_entry(entry, default_turn) do
    %{
      "artifact_id" => get(entry, "artifact_id"),
      "artifact_type" => get(entry, "artifact_type"),
      "title" => get(entry, "title"),
      "adoption_status" => get(entry, "adoption_status") || "TENTATIVE",
      "source_turn_ref" => get(entry, "source_turn_ref") || default_turn
    }
  end

  defp insert_interaction!(work_id, session_id, turn_id, role, content) do
    %Interaction{}
    |> Interaction.changeset(%{
      workspace_id: work_id,
      session_id: session_id,
      turn_id: turn_id,
      role: role,
      content: content,
      source_ref: turn_id,
      scope_ref: work_id
    })
    |> Repo.insert!()
  end

  # ── 小工具 ──────────────────────────────────────────────────────────────

  defp safe_planner(planner, run, sequence, snapshot) do
    planner.(run, sequence, snapshot)
  rescue
    error -> {:error, %{class: :planner_exception, message: Exception.message(error)}}
  catch
    kind, reason ->
      {:error, %{class: :planner_exception, message: truncate(inspect({kind, reason}), 800)}}
  end

  defp safe_step(step, run, sequence, snapshot) do
    step.(run, sequence, snapshot)
  rescue
    error -> {:error, %{class: :step_exception, message: Exception.message(error)}}
  catch
    kind, reason ->
      {:error, %{class: :step_exception, message: truncate(inspect({kind, reason}), 800)}}
  end

  defp get(map, key) when is_map(map) do
    cond do
      Map.has_key?(map, key) -> Map.get(map, key)
      Map.has_key?(map, to_string(key)) -> Map.get(map, to_string(key))
      true -> nil
    end
  end

  defp get(_, _), do: nil

  defp int(nil, default), do: default
  defp int(value, _default) when is_integer(value), do: value
  defp int(value, _default) when is_binary(value), do: String.to_integer(value)
  defp int(_, default), do: default

  defp resolve_prose!(prose_lib, ref) when is_binary(ref) do
    case get(prose_lib, ref) do
      nil -> raise "prose fixture 未找到: #{ref}"
      text when is_binary(text) -> text
      other -> raise "prose fixture 形态不支持: #{ref} -> #{inspect(other)}"
    end
  end

  defp resolve_prose!(_prose_lib, other), do: raise("prose ref 非法: #{inspect(other)}")

  defp normalize_map(nil), do: nil
  defp normalize_map(map) when is_map(map), do: stringify(map)
  defp normalize_map(other), do: other

  defp stringify(map) when is_map(map) do
    Map.new(map, fn {key, value} -> {to_string(key), stringify(value)} end)
  end

  defp stringify(list) when is_list(list), do: Enum.map(list, &stringify/1)
  defp stringify(other), do: other

  defp det_uuid(seed) do
    bytes = :crypto.hash(:sha256, "b27-cp0:" <> seed)
    {:ok, uuid} = Ecto.UUID.load(binary_part(bytes, 0, 16))
    uuid
  end

  defp to_string_safe(nil), do: nil
  defp to_string_safe(value) when is_binary(value), do: value
  defp to_string_safe(value) when is_atom(value), do: Atom.to_string(value)
  defp to_string_safe(value), do: truncate(inspect(value), 400)

  defp safe_inspect(nil, _limit), do: nil
  defp safe_inspect(value, limit), do: truncate(inspect(value), limit)

  defp jsonable(%_{} = struct), do: struct |> Map.from_struct() |> jsonable()

  defp jsonable(map) when is_map(map),
    do: Map.new(map, fn {k, v} -> {to_string(k), jsonable(v)} end)

  defp jsonable(list) when is_list(list), do: Enum.map(list, &jsonable/1)
  defp jsonable(tuple) when is_tuple(tuple), do: inspect(tuple)
  defp jsonable(fun) when is_function(fun), do: "<fun>"

  defp jsonable(value)
       when is_binary(value) or is_number(value) or is_boolean(value) or is_nil(value),
       do: value

  defp jsonable(value) when is_atom(value), do: Atom.to_string(value)
  defp jsonable(value), do: inspect(value)

  defp truncate(nil, _limit), do: nil
  defp truncate(value, limit) when is_binary(value), do: String.slice(value, 0, limit)
  defp truncate(value, limit), do: value |> inspect() |> String.slice(0, limit)
end
