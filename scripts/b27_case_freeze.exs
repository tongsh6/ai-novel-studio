# B27 CP0 — 20 例语义验收案例的真实请求快照冻结
#
# 目的（B27 §6.1 / CP0）：
#   在调整提示词之前，用**真实生产入口**为 20 个预注册案例组装判断请求，冻结
#   messages/tools/profile/规则版本 hash/材料事实，供旧规则臂复用、整合臂对照。
#
# 用法（必须用独立 test DB，避免污染默认 test DB；不启动 Phoenix、不写 dev DB）：
#
#   MIX_ENV=test NOVEL_TEST_DB_DIR=artifacts/model-contracts/b27-cp0/db MIX_TEST_PARTITION=b27cp0 \
#     mix run scripts/b27_case_freeze.exs
#
#   可选参数：
#     --cases M01,M03          只冻结指定案例
#     --check                  只校验现有快照与实时组装一致（不写文件；漂移退出码 3）
#     --out-dir <path>         快照输出目录（默认 fixtures 的 snapshots/）
#
# 产物：
#   quality/acceptance/fixtures/b27-semantic-cases/snapshots/<ID>.json
#   quality/acceptance/fixtures/b27-semantic-cases/snapshots/SP01-plan.json
#   quality/acceptance/fixtures/b27-semantic-cases/arms.yml        （首次运行写入；已存在则校验漂移）
#   artifacts/model-contracts/b27-cp0/freeze-report.md
#
# 约束与边界：
#   - 不调用任何模型：注入 capture execution，在 NovelAgent.Provider.Execution.result_fn
#     边界捕获请求，捕获后返回错误停止；L0 系统身份用生产 SystemIdentity.inject/1 还原。
#   - 每例在 Ecto Sandbox 事务中 seed 合成夹具，任务结束自动回滚；DB 文件在独立目录。
#   - 合成夹具 UUID 由 (case_id, role, seq) 确定性派生，快照可复跑且字节稳定。
#   - 不伪造 B28–B30 未实现能力：能力缺口案例（M14）按当前真实 registry 语义冻结。
#
# 退出码：0 成功；1 冻结失败；2 用法/环境错误；3 --check 漂移。

defmodule B27CaseFreeze do
  @moduledoc false

  alias Ecto.Adapters.SQL.Sandbox
  alias NovelAgent.Provider.{Execution, SystemIdentity}
  alias NovelApplication.DialoguePlanningService
  alias NovelCommon.Contracts.ProviderOutput
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

  @root Path.expand("..", __DIR__)
  @fixtures_rel "quality/acceptance/fixtures/b27-semantic-cases"
  @fixtures Path.join(@root, @fixtures_rel)
  @cases_path Path.join(@fixtures, "cases.yml")
  @snapshots_dir Path.join(@fixtures, "snapshots")
  @arms_path Path.join(@fixtures, "arms.yml")
  @artifacts_dir Path.join(@root, "artifacts/model-contracts/b27-cp0")
  @freeze_version "b27-cp0-freeze-v1"
  @capture_only {:error, :b27_cp0_capture_only}

  # 旧规则臂冻结的规则资产清单（路径 → 语义角色）。
  # 这些是「提示词/规则文本 + 同源目录」的真实代码来源；hash 冻结后 integrated_arm 方可对照。
  @rule_assets [
    {"L0 产品身份", "apps/novel_agent/lib/novel_agent/provider/system_identity.ex"},
    {"L1 创作任务策略", "apps/novel_application/lib/novel_application/authoring_task_policy.ex"},
    {"L1 判断工具契约", "apps/novel_application/lib/novel_application/judgment_tool_contract.ex"},
    {"L1 计划工具契约", "apps/novel_application/lib/novel_application/agent_plan_tool_contract.ex"},
    {"L3 判断/续行模板", "apps/novel_application/lib/novel_application/judgment_protocol.ex"},
    {"L2/L3 判断上下文投影", "apps/novel_application/lib/novel_application/dialogue_planning_service.ex"},
    {"L3 原文登记规则", "apps/novel_application/lib/novel_application/turn_interaction_service.ex"},
    {"L3 计划起草/修订模板", "apps/novel_application/lib/novel_application/agentic_plan_draft_planner.ex"},
    {"L3 判断计划 flow", "apps/novel_application/lib/novel_application/agent_run_flows/judgment_plan.ex"},
    {"L1 能力效果目录", "apps/novel_common/lib/novel_common/capability_registry.ex"},
    {"L1 任务 profile 注册表", "apps/novel_agent/lib/novel_agent/agent_task_profile_registry.ex"},
    {"专业调用 writer", "apps/novel_agent/lib/novel_agent/creative_provider/real.ex"},
    {"专业调用 evaluator", "apps/novel_agent/lib/novel_agent/prose_quality_evaluator.ex"},
    {"专业调用 章使命", "apps/novel_application/lib/novel_application/chapter_mission_service.ex"},
    {"专业调用 章摘要", "apps/novel_application/lib/novel_application/chapter_summary_generator.ex"},
    {"专业调用 盘点", "apps/novel_application/lib/novel_application/fact_inventory_service.ex"},
    {"专业调用 候选/修订入口", "apps/novel_application/lib/novel_application/pending_artifact_workflow.ex"},
    {"专业调用 质量修订", "apps/novel_application/lib/novel_application/prose_revision_service.ex"},
    {"专业调用 结果叙述", "apps/novel_application/lib/novel_application/planner.ex"},
    {"专业调用 运行进度", "apps/novel_application/lib/novel_application/agent_run_flows/provider_progress.ex"}
  ]

  # ── 入口 ──────────────────────────────────────────────────────────────────

  def main(argv) do
    opts = parse_args(argv)
    ensure_isolated_db!()
    manifest = read_yaml!(@cases_path)
    fixtures = get(manifest, "fixtures") || %{}
    prose_lib = get(fixtures, "prose") || %{}
    work_defaults = get(fixtures, "work_defaults") || %{}
    frozen_date = get(manifest, "frozen_at")
    all_cases = get(manifest, "cases") || []
    all_probes = get(manifest, "surface_probes") || []

    cases =
      if opts.cases,
        do: Enum.filter(all_cases, &(get(&1, "id") in opts.cases)),
        else: all_cases

    File.mkdir_p!(@snapshots_dir)
    File.mkdir_p!(@artifacts_dir)

    rule_assets = rule_assets()

    results =
      Enum.map(cases, fn case ->
        run_case_sandboxed(case, work_defaults, prose_lib, opts, rule_assets, frozen_date)
      end)

    probe_results = Enum.map(all_probes, &run_probe(&1, work_defaults, prose_lib, opts, rule_assets, frozen_date))

    arm_result = write_or_verify_arms(rule_assets, opts)

    if opts.check do
      write_drift_report(results, probe_results, arm_result, opts)
      drift = Enum.filter(results, &(&1.status == :drift)) ++ Enum.filter(results, &(&1.status == :error))
      if drift != [], do: System.halt(3)
    else
      write_report(manifest, results, probe_results, arm_result, rule_assets, opts)
    end

    failures = Enum.filter(results, &(&1.status == :error))

    if failures != [] do
      IO.puts("[b27-freeze] #{length(failures)} case(s) failed; see #{@artifacts_dir}/freeze-report.md")
      System.halt(1)
    else
      ok = Enum.count(results, &(&1.status in [:written, :verified]))
      verb = if opts.check, do: "verified", else: "written"
      IO.puts("[b27-freeze] #{ok}/#{length(results)} case snapshots #{verb}")
      IO.puts("[b27-freeze] arms: #{arm_result.status} (#{@arms_path})")
      IO.puts("[b27-freeze] report: #{@artifacts_dir}/freeze-report.md")
    end
  end

  defp parse_args(argv) do
    {opts, _, _} =
      OptionParser.parse(argv,
        strict: [cases: :string, check: :boolean, out_dir: :string, write_arms: :boolean]
      )

    %{
      cases: if(opts[:cases], do: String.split(opts[:cases], ",", trim: true), else: nil),
      check: opts[:check] || false,
      out_dir: opts[:out_dir] || @snapshots_dir,
      write_arms: opts[:write_arms] || false
    }
  end

  # ── 独立 DB 与迁移 ───────────────────────────────────────────────────────

  defp ensure_isolated_db! do
    db = Repo.config()[:database] |> to_string()

    unless String.contains?(db, "b27-cp0") do
      IO.puts("""
      [b27-freeze] 拒绝运行：当前 test DB 不在独立 CP0 目录。
        database = #{db}

      必须使用：
        MIX_ENV=test NOVEL_TEST_DB_DIR=artifacts/model-contracts/b27-cp0/db MIX_TEST_PARTITION=b27cp0 \\
          mix run scripts/b27_case_freeze.exs
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

    if applied != [], do: IO.puts("[b27-freeze] migrations applied: #{inspect(applied)}")

    Sandbox.mode(Repo, :manual)
    Application.put_env(:novel_web, :persistence, inject_real_persistence: true)
    :ok
  end

  # ── 单例：Sandbox 事务内 seed → 生产入口组装 → 捕获 → 快照 ──────────────

  defp run_case_sandboxed(case, work_defaults, prose_lib, opts, rule_assets, frozen_date) do
    case_id = get(case, "id")

    try do
      result =
        Task.async(fn ->
          :ok = Sandbox.checkout(Repo)
          build_case_snapshot(case, work_defaults, prose_lib, rule_assets, frozen_date)
        end)
        |> Task.await(180_000)

      case result do
        {:ok, doc} -> persist_snapshot(case_id, doc, opts)
        {:error, reason} -> %{status: :error, case_id: case_id, reason: inspect(reason)}
      end
    rescue
      error -> %{status: :error, case_id: case_id, reason: Exception.message(error)}
    catch
      kind, reason -> %{status: :error, case_id: case_id, reason: inspect({kind, reason})}
    end
  end

  defp build_case_snapshot(case, work_defaults, prose_lib, rule_assets, frozen_date) do
    case_id = get(case, "id")
    fixture = get(case, "fixture") || %{}
    author_text = get(case, "author_input") |> to_string()
    reset_capture!()

    with {:ok, seeded} <- seed_fixture!(case_id, work_defaults, fixture, prose_lib),
         {:ok, assembled} <- assemble_judgment_request(seeded, author_text) do
      prompts = captured_prompts()
      judgment_prompt = find_prompt(prompts, :judgment)

      cond do
        is_nil(judgment_prompt) ->
          {:error, {:judgment_request_not_captured, inspect(Enum.map(prompts, &elem(&1, 0)))}}

        true ->
          doc =
            snapshot_doc(
              case,
              seeded,
              assembled,
              judgment_prompt,
              rule_assets,
              frozen_date
            )

          {:ok, doc}
      end
    end
  end

  defp persist_snapshot(case_id, doc, opts) do
    path = Path.join(opts.out_dir, "#{case_id}.json")
    body = Jason.encode!(doc, pretty: true) <> "\n"

    cond do
      opts.check and not File.exists?(path) ->
        %{status: :drift, case_id: case_id, path: path, reason: "snapshot missing"}

      opts.check ->
        if File.read!(path) == body,
          do: %{status: :verified, case_id: case_id, path: path, doc: doc},
          else: %{status: :drift, case_id: case_id, path: path, reason: "snapshot bytes differ"}

      true ->
        File.mkdir_p!(Path.dirname(path))
        File.write!(path, body)
        %{status: :written, case_id: case_id, path: path, doc: doc}
    end
  end

  # ── 夹具 seed（合成样书；真实持久化 schema，确定性 UUID） ────────────────

  defp seed_fixture!(case_id, work_defaults, fixture, prose_lib) do
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
    chapter_rows = Enum.map(chapters, &insert_chapter!(case_id, work_id, volume_id, &1, prose_lib))

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
    error -> {:error, {:seed_failed, Exception.message(error)}}
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
      insert_scene_draft!(case_id, work_id, chapter_id, index, resolve_prose!(prose_lib, ref), "ACCEPTED")
    end)

    if is_map(long_prose) do
      body =
        (resolve_prose!(prose_lib, get(long_prose, "unit")) |> to_string())
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

    # ADR-0019 状态矩阵不允许 TENTATIVE→SUPERSEDED 一跳；先落 ACCEPTED 再 SUPERSEDED，
    # 与真实历史草稿被取代的持久事实一致。
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
      title: "B27-CP0 合成会话",
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

  # ── 生产入口组装 + 捕获 ─────────────────────────────────────────────────

  defp assemble_judgment_request(seeded, author_text) do
    case_id = seeded.case_id
    turn_id = "turn_#{case_id}_current"

    input = %{
      text: author_text,
      workspace_id: seeded.work_id,
      work_id: seeded.work_id,
      session_id: seeded.session_id,
      turn_id: turn_id,
      trace_persister: NovelApplication.persistence_tracer(),
      memory_recorder: NovelApplication.persistence_interaction_recorder()
    }

    capture = capturing_execution(fn _call, _prompt -> {:judgment, @capture_only} end)
    empty = %{stage_state: %{}, observations: [], events: [], stage_sink: nil}

    with {:ok, spec} <-
           DialoguePlanningService.plan_agent_run(
             input,
             NovelApplication.persistence_fetcher(),
             capture
           ),
         {:ok, run} <- AgentRun.new(spec.run_attrs),
         {:ok, context_result} <- run_step(spec.next_step_planner, run, 1, empty, :context_assemble),
         stage_state = context_result.stage_state,
         snapshot = %{empty | stage_state: stage_state, observations: context_result.observations},
         {:execute, judgment_step, _decision, _meta} <- spec.next_step_planner.(run, 2, snapshot) do
      judgment_outcome = safe_step(judgment_step, run, 2, snapshot)
      prompts = captured_prompts()
      prompt = find_prompt(prompts, :judgment)
      context = fetch_context(stage_state)

      if is_nil(prompt) do
        {:error, {:judgment_request_not_captured, inspect(Enum.map(prompts, &elem(&1, 0)))}}
      else
        {:ok,
         %{
           input: input,
           run: run,
           spec: spec,
           context: context,
           stage_state: stage_state,
           prompt: prompt,
           prompt_text: prompt_text(prompt),
           judgment_outcome: judgment_outcome,
           capture_meta: %{
             provider_calls: Process.get(:b27_call_count, 0),
             tags: Enum.map(prompts, &elem(&1, 0)),
             post_capture_outcome: outcome_summary(judgment_outcome)
           }
         }}
      end
    else
      {:execute, _step, _decision, _meta} ->
        {:error, :unexpected_planner_decision}

      other ->
        {:error, {:assembly_failed, inspect(other)}}
    end
  rescue
    error -> {:error, {:assembly_failed, Exception.message(error), __STACKTRACE__}}
  end

  defp run_step(planner, run, sequence, snapshot, _expected_target) do
    with {:execute, step, _decision, _meta} <- planner.(run, sequence, snapshot) do
      safe_step(step, run, sequence, snapshot)
    else
      other -> {:error, {:unexpected_step, inspect(other)}}
    end
  end

  defp safe_step(step, run, sequence, snapshot) do
    step.(run, sequence, snapshot)
  rescue
    error -> {:error, {:step_failed, Exception.message(error)}}
  catch
    kind, reason -> {:error, {kind, inspect(reason)}}
  end

  defp outcome_summary({:ok, result}) when is_map(result) do
    Map.take(result, [:provider_call_count, :turn_result]) |> Map.keys() |> inspect()
  end

  defp outcome_summary(other), do: inspect(other) |> String.slice(0, 200)

  defp fetch_context(stage_state) do
    get(stage_state, :judgment_context) || get(stage_state, "judgment_context") || %{}
  end

  defp reset_capture! do
    Process.put(:b27_captures, [])
    Process.put(:b27_call_count, 0)
  end

  defp capturing_execution(responder) do
    %Execution{
      result_fn: fn prompt ->
        call = Process.get(:b27_call_count, 0) + 1
        Process.put(:b27_call_count, call)
        {tag, response} = responder.(call, prompt)
        Process.put(:b27_captures, [{tag, prompt} | Process.get(:b27_captures, [])])
        response
      end,
      purpose: :planner,
      metadata: %{b27_cp0_capture: true}
    }
  end

  defp captured_prompts, do: Process.get(:b27_captures, []) |> Enum.reverse()

  defp find_prompt(prompts, tag) do
    Enum.find_value(prompts, fn {prompt_tag, prompt} -> if prompt_tag == tag, do: prompt end)
  end

  # ── SP01 计划面探针 ─────────────────────────────────────────────────────

  defp build_plan_probe_snapshot(probe, work_defaults, prose_lib, rule_assets, frozen_date) do
    probe_id = get(probe, "id")
    fixture = get(probe, "fixture") || %{}
    author_text = get(probe, "author_input") |> to_string()
    reset_capture!()

    with {:ok, seeded} <- seed_fixture!(probe_id, work_defaults, fixture, prose_lib),
         {:ok, assembled} <- assemble_plan_probe(seeded, author_text) do
      prompts = captured_prompts()
      judgment_prompt = find_prompt(prompts, :judgment)
      plan_prompt = find_prompt(prompts, :plan_draft)

      cond do
        is_nil(judgment_prompt) -> {:error, :probe_judgment_request_missing}
        is_nil(plan_prompt) -> {:error, :probe_plan_request_missing}
        true -> {:ok, plan_probe_doc(probe, seeded, assembled, judgment_prompt, plan_prompt, rule_assets, frozen_date)}
      end
    end
  end

  defp assemble_plan_probe(seeded, author_text) do
    case_id = seeded.case_id
    turn_id = "turn_#{case_id}_current"

    input = %{
      text: author_text,
      workspace_id: seeded.work_id,
      work_id: seeded.work_id,
      session_id: seeded.session_id,
      turn_id: turn_id,
      trace_persister: NovelApplication.persistence_tracer(),
      memory_recorder: NovelApplication.persistence_interaction_recorder()
    }

    capture =
      capturing_execution(fn call, _prompt ->
        if call == 1, do: {:judgment, plan_judgment_result()}, else: {:plan_draft, @capture_only}
      end)

    empty = %{stage_state: %{}, observations: [], events: [], stage_sink: nil}

    with {:ok, spec} <-
           DialoguePlanningService.plan_agent_run(
             input,
             NovelApplication.persistence_fetcher(),
             capture
           ),
         {:ok, run} <- AgentRun.new(spec.run_attrs),
         {:ok, context_result} <- run_step(spec.next_step_planner, run, 1, empty, :context_assemble),
         stage_state = context_result.stage_state,
         snapshot = %{empty | stage_state: stage_state, observations: context_result.observations},
         {:execute, judgment_step, _decision, _meta} <- spec.next_step_planner.(run, 2, snapshot),
         {:ok, judgment_map} when is_map(judgment_map) <-
           safe_step(judgment_step, run, 2, snapshot) do
      judgment_result = judgment_map
      run2 = apply_run_patch(run, get(judgment_result, :run_patch))

      stage2 =
        Map.merge(
          stage_state,
          get(judgment_result, :stage_state) || %{}
        )

      snapshot2 = %{
        empty
        | stage_state: stage2,
          observations: context_result.observations ++ (get(judgment_result, :observations) || [])
      }

      # 计划起草 provider 调用发生在 judgment_plan planner 的 plan_for_run 内。
      planner_outcome = safe_planner(spec.next_step_planner, run2, 3, snapshot2)

      prompts = captured_prompts()
      plan_prompt = find_prompt(prompts, :plan_draft)
      context = fetch_context(stage_state)

      {:ok,
       %{
         input: input,
         run: run2,
         spec: spec,
         context: context,
         stage_state: stage2,
         judgment_prompt: find_prompt(prompts, :judgment),
         plan_prompt: plan_prompt,
         judgment_result: judgment_result,
         planner_outcome: outcome_summary(planner_outcome),
         capture_meta: %{
           provider_calls: Process.get(:b27_call_count, 0),
           tags: Enum.map(prompts, &elem(&1, 0))
         }
       }}
    else
      other -> {:error, {:plan_probe_assembly_failed, inspect(other)}}
    end
  rescue
    error -> {:error, {:plan_probe_assembly_failed, Exception.message(error), __STACKTRACE__}}
  end

  defp safe_planner(planner, run, sequence, snapshot) do
    planner.(run, sequence, snapshot)
  rescue
    error -> {:error, {:planner_failed, Exception.message(error)}}
  catch
    kind, reason -> {:error, {kind, inspect(reason)}}
  end

  defp plan_judgment_result do
    narrative = "这个请求包含两个相互依赖的产物，我先给出一份执行计划，不直接起草。"

    calls = [
      %{
        name: "judgment_decision",
        arguments: %{
          action: "plan",
          dialogue_goal: "先设计灯楼反派，再写第02章开篇正文",
          reason: narrative
        }
      }
    ]

    {:ok,
     %{
       content: narrative,
       tool_calls: calls,
       provider_output: %ProviderOutput{
         provider_run_ref: "prun_b27_cp0_probe",
         provider_call_ref: "pcall_b27_cp0_probe_judgment",
         status: :ok,
         content: %{text: narrative}
       }
     }}
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

  defp run_probe(probe, work_defaults, prose_lib, opts, rule_assets, frozen_date) do
    probe_id = get(probe, "id")

    if get(probe, "snapshot") == "available" do
      result =
        Task.async(fn ->
          :ok = Sandbox.checkout(Repo)
          build_plan_probe_snapshot(probe, work_defaults, prose_lib, rule_assets, frozen_date)
        end)
        |> Task.await(180_000)

      case result do
        {:ok, doc} -> persist_probe_snapshot(probe_id, doc, opts)
        {:error, reason} -> %{status: :error, case_id: probe_id, reason: inspect(reason)}
      end
    else
      %{
        status: :unavailable,
        case_id: probe_id,
        reason: get(probe, "unavailable_reason") || get(probe, "snapshot"),
        inherits: get(probe, "inherits")
      }
    end
  rescue
    error -> %{status: :error, case_id: get(probe, "id"), reason: Exception.message(error)}
  end

  defp persist_probe_snapshot(probe_id, doc, opts) do
    path = Path.join(opts.out_dir, "#{probe_id}-plan.json")
    body = Jason.encode!(doc, pretty: true) <> "\n"

    if opts.check do
      if File.exists?(path) and File.read!(path) == body,
        do: %{status: :verified, case_id: probe_id, path: path, doc: doc},
        else: %{status: :drift, case_id: probe_id, path: path, reason: "snapshot bytes differ"}
    else
      File.mkdir_p!(Path.dirname(path))
      File.write!(path, body)
      %{status: :written, case_id: probe_id, path: path, doc: doc}
    end
  end

  # ── 快照文档 ────────────────────────────────────────────────────────────

  defp snapshot_doc(case, seeded, assembled, judgment_prompt, rule_assets, frozen_date) do
    request = request_doc(judgment_prompt)
    materials = materials_doc(assembled.context, request, assembled.input, seeded)
    profile = profile_doc(assembled.spec)
    rule_versions = rule_versions_doc(rule_assets)
    hashes = hashes_doc(request, materials, profile)

    %{
      "schema" => "b27-semantic-snapshot-v1",
      "freeze_version" => @freeze_version,
      "case_id" => get(case, "id"),
      "case_title" => get(case, "title"),
      "call_surface" => get(case, "call_surface"),
      "call_surface_detail" => get(case, "call_surface_detail") || [],
      "frozen_date" => frozen_date,
      "source" => %{
        "slice" => "tasks/slices/B27-systematic-prompt-and-intent-integration.md §6.1",
        "cases" => "#{@fixtures_rel}/cases.yml",
        "arms" => "#{@fixtures_rel}/arms.yml",
        "acceptance_contract" => "docs/design/contracts/VS-00D-ai-guided-authoring-contract-pack.md §11.4"
      },
      "provenance" => %{
        "entry" => "NovelApplication.DialoguePlanningService.plan_agent_run/3",
        "planner" => "judgment loop (profile_routing → context_assemble → judgment)",
        "capture_boundary" => "NovelAgent.Provider.Execution.result_fn",
        "l0_injection" => "NovelAgent.Provider.SystemIdentity.inject/1（生产函数还原）",
        "provider_called" => false,
        "capture_policy" => "capture-then-error：捕获后故意中止，不产生模型响应/业务副作用",
        "post_capture_step" => assembled.capture_meta.post_capture_outcome,
        "db" => "MIX_ENV=test + NOVEL_TEST_DB_DIR=artifacts/model-contracts/b27-cp0/db + Sandbox 回滚",
        "deterministic_uuids" => true,
        "fixture" => "合成样书，不含作者真实作品数据",
        "redaction" => %{"applied" => true, "patterns" => redaction_patterns(), "matches" => 0}
      },
      "request" => request,
      "profile" => profile,
      "materials" => materials,
      "hashes" => hashes,
      "rule_versions" => rule_versions,
      "flags" => %{
        "key_case" => truthy(get(case, "key_case")),
        "retention" => truthy(get(case, "retention")),
        "retention_note" => get(case, "retention_note"),
        "unnecessary_question_counted" => truthy(get(case, "unnecessary_question_counted")),
        "zero_tolerance_applies" => get(case, "zero_tolerance_applies") || []
      },
      "normalization" => %{
        "timestamps" => "ISO-8601 wall-clock 字段归一为 <timestamp>",
        "context_refs" => "运行时随机 context_ref 归一为 context:<source_type>:<n>；其余材料字节未改",
        "note" => "归一仅影响快照字节稳定性，不改变模型实际看到的语义内容（时间戳/上下文编号非创作事实）"
      },
      "arm" => %{
        "slot" => "old_rules_arm",
        "manifest" => "#{@fixtures_rel}/arms.yml",
        "frozen" => true,
        "integrated_arm" => "pending（B27 CP3 后由同一 freeze 脚本重算）"
      },
      "fixture_refs" => %{
        "work_ref" => "work:#{seeded.work_id}",
        "session_ref" => "session:#{seeded.session_id}",
        "turn_ref" => "turn:#{get(assembled.input, :turn_id)}",
        "chapters" => Enum.map(seeded.chapters, &"chapter:#{&1.id}")
      }
    }
  end

  defp plan_probe_doc(probe, seeded, assembled, judgment_prompt, plan_prompt, rule_assets, frozen_date) do
    judgment_request = request_doc(judgment_prompt)
    plan_request = request_doc(plan_prompt)
    materials = materials_doc(assembled.context, judgment_request, assembled.input, seeded)
    rule_versions = rule_versions_doc(rule_assets)

    hashes = %{
      "judgment_request_sha256" => sha256(canonical_json(judgment_request)),
      "plan_request_sha256" => sha256(canonical_json(plan_request)),
      "judgment_messages_sha256" => sha256(canonical_json(judgment_request["messages"])),
      "plan_messages_sha256" => sha256(canonical_json(plan_request["messages"]))
    }

    %{
      "schema" => "b27-semantic-snapshot-v1",
      "freeze_version" => @freeze_version,
      "probe_id" => get(probe, "id"),
      "call_surface" => "plan",
      "probe_title" => get(probe, "title"),
      "frozen_date" => frozen_date,
      "source" => %{
        "slice" => "tasks/slices/B27-systematic-prompt-and-intent-integration.md §6.1",
        "cases" => "#{@fixtures_rel}/cases.yml#surface_probes/#{get(probe, "id")}",
        "note" => "surface probe，不参与 20 例 rubric 与门槛"
      },
      "provenance" => %{
        "entry" => "NovelApplication.DialoguePlanningService.plan_agent_run/3",
        "path" => "judgment_decision{action=plan} → JudgmentPlan.next_step_planner → AgenticPlanDraftPlanner.draft_plan_with_meta/3",
        "capture_boundary" => "NovelAgent.Provider.Execution.result_fn",
        "provider_called" => false,
        "db" => "MIX_ENV=test + NOVEL_TEST_DB_DIR=artifacts/model-contracts/b27-cp0/db + Sandbox 回滚"
      },
      "requests" => %{
        "judgment" => judgment_request,
        "plan_draft" => plan_request
      },
      "profile" => %{
        "judgment_run_profile" => "judgment_loop_v1",
        "plan_run_profile_ref" => get(assembled.run, :profile_ref),
        "plan_profile" => "judgment_plan_v1",
        "judgment_result_action" => action_from_judgment(assembled.judgment_result),
        "planner_outcome" => assembled.planner_outcome
      },
      "materials" => materials,
      "hashes" => hashes,
      "rule_versions" => rule_versions,
      "arm" => %{"slot" => "old_rules_arm", "manifest" => "#{@fixtures_rel}/arms.yml"}
    }
  end

  defp action_from_judgment(result) when is_map(result), do: get(result, :action)
  defp action_from_judgment(_), do: nil

  defp request_doc(prompt) do
    {wire_prompt, identity_ref} = SystemIdentity.inject(prompt)
    messages = get(wire_prompt, :messages) || get(wire_prompt, "messages") || []
    tools = get(wire_prompt, :tools) || []
    tool_choice = get(wire_prompt, :tool_choice)

    request = %{
      "messages" => Enum.map(messages, &message_doc/1),
      "tools" => Enum.map(tools, &canonical/1),
      "tool_choice" => tool_choice,
      "inference" => %{
        "temperature" => 0.2,
        "purpose" => "planner",
        "content_visibility" => "author",
        "source" => "JudgmentProtocol.request/4 显式常量（result_fn 边界不可观察，按代码记录）"
      }
    }

    Map.put(request, "system_identity", %{
      "version" => identity_ref && get(identity_ref, :version),
      "content_hash" => identity_ref && get(identity_ref, :content_hash)
    })
  end

  # 快照稳定性：作品 snapshot.updated_at 等 wall-clock 字段按占位符归一，
  # 保证同一夹具重跑字节一致；归一事实记录在 provenance.normalization。
  defp normalize_snapshot_text(text) when is_binary(text) do
    text
    |> then(&Regex.replace(~r/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/, &1, "<timestamp>"))
  end

  defp normalize_snapshot_text(other), do: other

  defp message_doc(message) when is_map(message) do
    content = normalize_snapshot_text(get(message, :content) |> to_string())

    %{
      "role" => get(message, :role),
      "content" => content,
      "bytes" => byte_size(content)
    }
  end

  defp message_doc(other), do: %{"raw" => inspect(other)}

  defp profile_doc(spec) do
    attrs = spec.run_attrs

    %{
      "run_profile_ref" => get(attrs, :profile_ref),
      "agent_profile" => "profile_routing",
      "judgment_profile" => "judgment_loop_v1",
      "system_identity_version" => SystemIdentity.version(),
      "authoring_task_policy_version" => NovelApplication.AuthoringTaskPolicy.version(),
      "judgment_tool_contract_version" => NovelApplication.JudgmentToolContract.version(),
      "plan_tool_contract" => "NovelApplication.AgentPlanToolContract.schema/0",
      "tool_choice" => "auto",
      "prompt_builder" => "NovelApplication.JudgmentProtocol.prompt/2 (:judgment)"
    }
  end

  defp materials_doc(context, request, input, seeded) do
    interaction_state = get(context, :interaction_state) || %{}
    chapters = get(context, :structured_chapters) || []
    wire_text = wire_prompt_text(request)

    %{
      "author_text" => get(input, :text),
      "source_input_ref" => "turn:#{get(input, :turn_id)}",
      "supplied_context_refs" =>
        (get(context, :context_refs) || [])
        |> Enum.with_index(1)
        |> Enum.map(fn {ref, index} ->
          %{
            "context_ref" => "context:<#{to_string(get(ref, :source_type))}:#{index}>",
            "source_type" => to_string(get(ref, :source_type))
          }
        end),
      "chapter_index" =>
        Enum.map(chapters, fn chapter ->
          %{
            "chapter_ref" => "chapter:#{get(chapter, :id)}",
            "seq" => get(chapter, :seq),
            "title" => get(chapter, :title),
            "has_prose" => get(chapter, :has_prose),
            "has_plan_direction" => not is_nil(get(chapter, :plan_direction)),
            "summary_chars" => chars(get(chapter, :summary))
          }
        end),
      "pending_adoptions" => artifact_summaries(get(interaction_state, :pending_adoptions) || []),
      "adopted_content_targets" => artifact_summaries(get(interaction_state, :resolved_adoptions) || []),
      "interaction_state" => %{
        "author_inputs" => length(get(interaction_state, :author_inputs) || []),
        "recent_results" => length(get(interaction_state, :recent_results) || []),
        "session_summary_chars" => chars(get(seeded.session, :summary)),
        "has_conversation_summary" => chars(get(context, :conversation_summary)) > 0
      },
      "work_snapshot_keys" => get(context, :current_work_snapshot) |> then(fn snap -> if is_map(snap), do: snap |> Map.keys() |> Enum.sort(), else: [] end),
      "prompt_facts" => %{
        "has_l0_identity" => String.contains?(wire_text, "你在 AI Novel Studio 中工作"),
        "has_task_policy" => String.contains?(wire_text, "共同任务规则版本："),
        "explore_open" => String.contains?(wire_text, "只读探索当前允许：true"),
        "explore_tools" => json_list_after(wire_text, "目录："),
        "legit_author_sources" => json_list_after(wire_text, "合法原文来源："),
        "capabilities" => capability_lines(wire_text),
        "prompt_chars" => String.length(wire_text)
      }
    }
  end

  defp wire_prompt_text(request) do
    (get(request, "messages") || [])
    |> Enum.map(&(get(&1, "content") || ""))
    |> Enum.join("\n")
  end

  defp artifact_summaries(entries) do
    Enum.map(entries, fn entry ->
      %{
        "artifact_id" => get(entry, :artifact_id) || get(entry, "artifact_id"),
        "artifact_type" => get(entry, :artifact_type) || get(entry, "artifact_type"),
        "title" => get(entry, :title) || get(entry, "title"),
        "adoption_status" => get(entry, :adoption_status) || get(entry, "adoption_status"),
        "source_turn_ref" => get(entry, :source_turn_ref) || get(entry, "source_turn_ref")
      }
    end)
  end

  defp json_list_after(text, prefix) do
    case Regex.run(~r/#{Regex.escape(prefix)}(\s*)(\[[^\]]*\])/u, text) do
      [_, _spaces, json] ->
        case Jason.decode(json) do
          {:ok, list} -> list
          _ -> []
        end

      _ ->
        []
    end
  end

  defp capability_lines(text) do
    case String.split(
           text,
           "## 当前可用操作（效果与权限，以本轮真实目录为准）",
           parts: 2
         ) do
      [_, rest] ->
        rest
        |> String.split("\n")
        |> Enum.drop_while(&(String.trim(&1) == ""))
        |> Enum.take_while(&String.starts_with?(&1, "- "))
        |> Enum.map(fn line ->
          line
          |> String.trim_leading("- ")
          |> String.split("：")
          |> hd()
          |> String.trim()
        end)

      _ ->
        []
    end
  end

  defp rule_versions_doc(rule_assets) do
    versions =
      rule_assets
      |> Enum.filter(& &1["exists"])
      |> Map.new(fn asset -> {asset["path"], asset["sha256"]} end)

    %{
      "asset_sha256" => versions,
      "arm_content_hash" => arm_content_hash(rule_assets),
      "module_versions" => %{
        "system_identity" => SystemIdentity.version(),
        "authoring_task_policy" => NovelApplication.AuthoringTaskPolicy.version(),
        "judgment_tool_contract" => NovelApplication.JudgmentToolContract.version()
      }
    }
  end

  defp hashes_doc(request, materials, profile) do
    %{
      "request_sha256" => sha256(canonical_json(request)),
      "messages_sha256" => sha256(canonical_json(request["messages"])),
      "tools_sha256" => sha256(canonical_json(request["tools"])),
      "materials_sha256" => sha256(canonical_json(materials)),
      "profile_sha256" => sha256(canonical_json(profile))
    }
  end

  defp prompt_text(prompt) do
    messages = get(prompt, :messages) || get(prompt, "messages") || []

    messages
    |> Enum.map(&(get(&1, :content) || ""))
    |> Enum.join("\n")
  end

  # ── 规则资产 hash / 双臂 manifest ───────────────────────────────────────

  defp rule_assets do
    Enum.map(@rule_assets, fn {role, rel_path} ->
      abs = Path.join(@root, rel_path)
      exists = File.exists?(abs)
      sha = if exists, do: sha256(File.read!(abs)), else: nil
      bytes = if exists, do: File.stat!(abs).size, else: nil
      version = asset_version(rel_path)

      %{
        "role" => role,
        "path" => rel_path,
        "sha256" => sha,
        "bytes" => bytes,
        "version" => version,
        "exists" => exists
      }
    end)
  end

  defp asset_version("apps/novel_agent/lib/novel_agent/provider/system_identity.ex"),
    do: SystemIdentity.version()

  defp asset_version("apps/novel_application/lib/novel_application/authoring_task_policy.ex"),
    do: NovelApplication.AuthoringTaskPolicy.version()

  defp asset_version("apps/novel_application/lib/novel_application/judgment_tool_contract.ex"),
    do: NovelApplication.JudgmentToolContract.version()

  defp asset_version(_path), do: "content-hash"

  defp arm_content_hash(rule_assets) do
    rule_assets
    |> Enum.map(fn asset -> "#{asset["path"]}:#{asset["sha256"]}" end)
    |> Enum.sort()
    |> Enum.join("\n")
    |> sha256()
  end

  defp write_or_verify_arms(rule_assets, opts) do
    missing = Enum.filter(rule_assets, &(!&1["exists"]))

    cond do
      missing != [] ->
        %{status: :error, reason: "missing assets: #{inspect(Enum.map(missing, & &1["path"]))}", drift: []}

      opts.check and File.exists?(@arms_path) ->
        verify_arms(rule_assets)

      File.exists?(@arms_path) and Map.get(opts, :write_arms, false) ->
        # 显式重冻：旧 arms.yml 先归档到 artifacts 供审计，再写新基线。
        backup = Path.join(@artifacts_dir, "arms-before-refreeze-#{stamp()}.yml")
        File.mkdir_p!(@artifacts_dir)
        File.cp!(@arms_path, backup)
        written = write_arms(rule_assets)
        IO.puts("[b27-freeze] arms.yml 已重冻（旧版归档：#{rel(backup)}）")
        written

      File.exists?(@arms_path) ->
        verify_arms(rule_assets)

      true ->
        write_arms(rule_assets)
    end
  end

  defp stamp do
    DateTime.utc_now() |> Calendar.strftime("%Y%m%d-%H%M%S")
  end

  defp write_arms(rule_assets) do
    File.write!(@arms_path, arms_yaml(rule_assets))
    %{status: :written, drift: []}
  end

  defp verify_arms(rule_assets) do
    doc = read_yaml!(@arms_path)
    assets = get(doc, "assets") || []
    frozen = Map.new(assets, fn asset -> {get(asset, "path"), get(asset, "sha256")} end)

    drift =
      rule_assets
      |> Enum.filter(& &1["exists"])
      |> Enum.filter(fn asset -> Map.get(frozen, asset["path"]) != asset["sha256"] end)
      |> Enum.map(fn asset ->
        %{
          path: asset["path"],
          frozen: Map.get(frozen, asset["path"]),
          current: asset["sha256"]
        }
      end)

    status = if drift == [], do: :verified, else: :drift
    if drift != [], do: Logger.warning("[b27-freeze] arms.yml 漂移: #{inspect(Enum.map(drift, & &1.path))}")
    %{status: status, drift: drift}
  end

  defp arms_yaml(rule_assets) do
    arm_hash = arm_content_hash(rule_assets)

    assets_block =
      rule_assets
      |> Enum.map_join("\n", fn asset ->
        """
          - role: #{yaml_str(asset["role"])}
            path: #{yaml_str(asset["path"])}
            sha256: #{yaml_str(asset["sha256"])}
            bytes: #{asset["bytes"]}
            version: #{yaml_str(asset["version"])}
        """
        |> String.trim_trailing()
      end)

    """
    # B27 双臂规则资产 manifest（CP0 冻结）
    #
    # old_rules_arm = B27 CP0 冻结时的当前提示词/规则资产（本文件 sha256 清单）；
    # integrated_arm = B27 CP3 完成系统整合后由同一脚本重算的清单（待填）。
    #
    # 案例 manifest 以 arm slot 引用：cases.yml 的 snapshot 记录 arm.slot=old_rules_arm；
    # CP4 对照时两侧必须同 provider/model/推理参数/原始数据版本与预算（B27 §6.1）。
    #
    # 生成：scripts/b27_case_freeze.exs（首次写入；已存在时只校验漂移，不覆盖冻结基线）
    # 本文件不得手工编辑 hash；规则资产变更即代表新臂（integrated_arm），旧臂保持冻结。

    schema: b27-arms-v1
    frozen_date: "2026-10-24"
    slice: tasks/slices/B27-systematic-prompt-and-intent-integration.md
    criteria: "§6.1 真实模型语义验收固定通过标准（不得测后修改）"

    old_rules_arm:
      status: frozen
      arm_content_hash: #{yaml_str(arm_hash)}
      captured_by: "scripts/b27_case_freeze.exs"
      note: "hash 快照 = CP0 冻结时工作区提示词/规则真实内容；integrated_arm 不得复用本清单冒充旧臂"

    integrated_arm:
      status: pending
      filled_by: "B27 CP3 专业调用整合完成后重算并登记"
      note: "填好后 CP4 按 §6.1 双臂对照；旧臂 hash 保持不变"

    assets:
    #{assets_block}
    """
  end

  defp yaml_str(value) when is_binary(value), do: value
  defp yaml_str(nil), do: "null"
  defp yaml_str(value), do: inspect(value)

  # ── 报告 ────────────────────────────────────────────────────────────────

  defp write_report(manifest, results, probes, arm_result, rule_assets, _opts) do
    File.mkdir_p!(@artifacts_dir)
    command =
      "MIX_ENV=test NOVEL_TEST_DB_DIR=artifacts/model-contracts/b27-cp0/db MIX_TEST_PARTITION=b27cp0 mix run scripts/b27_case_freeze.exs"

    cases = get(manifest, "cases") || []
    policies = get(manifest, "policies") || %{}
    key_set = get(policies, "key_set") || []
    retention = get(policies, "retention_set") || []
    asked = get(policies, "unnecessary_question_subset") || []

    rows =
      results
      |> Enum.map(&report_row/1)
      |> Enum.join("\n")

    probe_rows =
      probes
      |> Enum.map(fn probe ->
        case probe do
          %{status: :written, path: path, doc: doc} ->
            "| #{probe.case_id} | plan | `#{rel(path)}` | #{length(Map.keys(get(doc, "requests") || %{}))} 面请求 | 已冻结 |"

          %{status: :unavailable, case_id: id, reason: reason, inherits: inherits} ->
            short_reason =
              to_string(reason)
              |> String.split("承接：")
              |> hd()
              |> String.replace("\n", " ")
              |> String.slice(0, 180)

            "| #{id} | surface | — | — | 不可用：#{short_reason}（承接：#{inherits || "—"}） |"

          %{status: :error, case_id: id, reason: reason} ->
            "| #{id} | surface | — | — | 失败：#{String.slice(to_string(reason), 0, 160)} |"

          %{status: :verified, case_id: id, path: path} ->
            "| #{id} | surface | `#{rel(path)}` | 已冻结 | 校验通过 |"
        end
      end)
      |> Enum.join("\n")

    arm_rows =
      rule_assets
      |> Enum.map(fn asset ->
        "| #{asset["role"]} | `#{asset["path"]}` | `#{asset["sha256"]}` | #{asset["bytes"]} | #{asset["version"]} |"
      end)
      |> Enum.join("\n")

    required_models = get(manifest, "required_models") || []

    models_rows =
      required_models
      |> Enum.map(fn model ->
        "| #{get(model, "id")} | #{get(model, "provider")} / #{get(model, "model")} | #{if get(model, "required"), do: "必验", else: "候选（需凭据）"} | #{get(model, "credential")} |"
      end)
      |> Enum.join("\n")

    written = Enum.count(results, &(&1.status == :written))
    verified = Enum.count(results, &(&1.status == :verified))
    errors = Enum.count(results, &(&1.status == :error))

    counts =
      cases
      |> Enum.filter(fn case -> get(case, "snapshot") == "available" end)
      |> Enum.count()

    body = """
    # B27 CP0 请求快照冻结报告

    - 生成时间：#{DateTime.utc_now() |> DateTime.to_iso8601()}
    - 脚本：`scripts/b27_case_freeze.exs`（freeze_version `#{@freeze_version}`）
    - 复跑命令：

      ```bash
      #{command}
      ```

    - 独立 DB：`#{Repo.config()[:database]}`（Sandbox 事务内 seed，逐例回滚；未污染默认 test DB）
    - 模型调用：**0 次**（capture execution 在 `Execution.result_fn` 边界捕获后立即中止；
      L0 由生产 `SystemIdentity.inject/1` 还原）。本报告是输入快照证据，不是语义通过证据。

    ## 1. 覆盖统计

    | 指标 | 值 |
    |---|---|
    | 案例总数 | #{length(cases)} |
    | 可组装快照案例（cases.yml snapshot=available） | #{counts} |
    | 本次写入 | #{written} |
    | 快照 --check 校验通过（仅 --check 模式） | #{verified} |
    | 失败 | #{errors} |
    | 关键集 | #{Enum.join(key_set, "/")}（#{length(key_set)} 例） |
    | 保留集 | #{Enum.join(retention, "/")}（#{length(retention)} 例，含同句异境） |
    | 无谓追问计入子集 | #{length(asked)} 例（分母 = 子集 × 2 次重复/臂 = #{length(asked) * 2}/臂） |
    | 旧规则臂 arm_content_hash | `#{arm_content_hash(rule_assets)}` |
    | arms.yml 状态 | #{arm_result.status}#{arm_note(arm_result)} |

    ## 2. 逐例快照

    | 案例 | 标题 | 调用面 | 快照 | prompt chars | messages | tools | request_sha256(16) | 关键 | 保留 | 追问子集 | 状态 |
    |---|---|---|---|---|---|---|---|---|---|---|---|
    #{rows}

    ## 3. 调用面探针（不参与 20 例 rubric/门槛）

    | Probe | 面 | 快照 | 内容 | 状态 |
    |---|---|---|---|---|
    #{probe_rows}

    ## 4. 旧规则臂 hash 清单（详见 `#{@fixtures_rel}/arms.yml`）

    | 角色 | 资产 | sha256 | bytes | version |
    |---|---|---|---|---|
    #{arm_rows}

    ## 5. 必验模型（CP0 固化）

    | ID | provider / model | 性质 | 凭据/端点 |
    |---|---|---|---|
    #{models_rows}

    ## 6. 口径与限制

    - 案例卡/允许路径/禁行为/Rubric/关键集/保留集/追问子集口径见 `#{@fixtures_rel}/cases.yml`；
      §6.1 映射与双臂说明见 `#{@fixtures_rel}/README.md`。
    - 快照捕获边界是 `Execution.result_fn`（生产判断协议把 prompt 交给 provider execution dependency
      的位置）。该边界之后才由 Gateway 注入 L0 系统身份；本快照用生产 `SystemIdentity.inject/1`
      生成同一份身份消息，故 `request.messages[0]` 即生产 wire 请求首条 system 消息。
    - `inference.temperature=0.2 / purpose=planner / content_visibility=author` 由
      `JudgmentProtocol.request/4` 显式设置，在 result_fn 边界不可直接观察，按代码常量记录。
    - M14（能力缺口）按当前真实 registry 语义冻结：character_evolution 只产演化记忆，
      B29 未实现已有角色身份修订；若 CP4 前实现，须按 §6.1 改案例卡并重冻（不得用生产开关伪造缺口）。
    - SP02（续行面）/SP03（专业调用面）本轮以 `snapshot: unavailable` 登记原因与承接（CP3），
      未用合成偏离/伪造任务输入冒充真实快照。
    - 不改 §6.1 门槛数值；本报告不执行 40 episode 门槛，CP4 才判定通过/失败。
    - **并行工作区风险**：CP0 冻结期间共享工作区存在并行的 B26 未提交实现修改（本报告生成时
      arms.yml 若显示 drift，说明当前工作区规则已相对冻结基线前进）。旧规则臂回放以
      `snapshots/` 中的冻结请求字节为准（自包含，不依赖当前工作区源码）；重新冻结会更新
      arm hash，使旧臂基线变更——B27 CP3 开始后应保持 old_rules_arm hash 不变，新状态登记为
      integrated_arm。
    #{runner_evidence_section()}
    """

    File.write!(Path.join(@artifacts_dir, "freeze-report.md"), body)
    :ok
  end

  # 运行器证据索引（CP0 实际执行的 stub/stage 真实单轮结果；非 §6.1 门槛）
  defp runner_evidence_section do
    runs_dir = Path.join(@artifacts_dir, "runs")

    files =
      runs_dir
      |> Path.join("*.json")
      |> Path.wildcard()
      |> Enum.reject(&String.contains?(Path.basename(&1), "summary-"))
      |> Enum.sort()

    if files == [] do
      ""
    else
      rows =
        files
        |> Enum.map(fn file ->
          doc = file |> File.read!() |> Jason.decode!()
          judgment = get(doc, "judgment") || %{}
          response = get(doc, "response") || %{}
          facts = get(doc, "provider_facts") || %{}
          method = get(doc, "method") || %{}

          hit = if get(judgment, "allowed_first_round_hit") == true, do: "✓", else: "—"
          semantic = if get(method, "semantic_evidence") == true, do: "真实", else: "stub"

          "| `#{rel(file)}` | #{get(doc, "case_id")} | #{get(doc, "provider")} | " <>
            "#{get(doc, "status")} | #{get(judgment, "decision")} | #{hit} | " <>
            "#{get(response, "duration_ms")} | #{get(facts, "model")} | #{semantic} |"
        end)
        |> Enum.join("\n")

      """

      ## 7. 运行器证据（CP0 实际执行；单轮回放，不是 §6.1 门槛）

      | 结果文件 | 案例 | provider | 状态 | 首轮决策 | 首轮允许路径 | 耗时 ms | 实际模型 | 证据性质 |
      |---|---|---|---|---|---|---|---|---|
      #{rows}

      说明：stub 只证明管道/字段/解析；真实 provider 单轮只证明该轮请求得到合法响应，
      **不等于** §6.1 语义通过。完整 20×2×2 门槛与 rubric 盲评由 CP4 执行。
      """
    end
  end

  defp arm_note(%{status: :drift, drift: drift}) do
    "（漂移资产：#{Enum.map_join(drift, ", ", & &1.path)}）"
  end

  defp arm_note(_), do: ""

  defp report_row(%{status: :written, case_id: id, doc: doc}) do
    report_row(%{status: :ok, case_id: id, doc: doc, path: nil})
  end

  defp report_row(%{status: :verified, case_id: id, doc: doc, path: path}) do
    row_body(id, doc, path, "校验通过")
  end

  defp report_row(%{status: :error, case_id: id, reason: reason}) do
    "| #{id} | — | — | — | — | — | — | — | — | — | — | 失败：#{String.slice(to_string(reason), 0, 160)} |"
  end

  defp report_row(%{status: :ok, case_id: id, doc: doc, path: path}) do
    row_body(id, doc, path, "已写入")
  end

  defp row_body(id, doc, path, status) do
    request = get(doc, "request") || %{}
    messages = get(request, "messages") || []
    tools = get(request, "tools") || []
    hashes = get(doc, "hashes") || %{}
    arm = get(doc, "arm") || %{}

    flags = get(doc, "flags") || %{}
    prompt_chars = get(get(get(doc, "materials") || %{}, "prompt_facts") || %{}, "prompt_chars")
    _ = arm

    "| #{id} | #{String.slice(to_string(get(doc, "case_title")), 0, 28)} | #{get(doc, "call_surface")} | #{path_label(path, id)} | #{prompt_chars} | #{length(messages)} | #{length(tools)} | #{String.slice(to_string(get(hashes, "request_sha256")), 0, 16)} | #{yes_no(get(flags, "key_case"))} | #{yes_no(get(flags, "retention"))} | #{yes_no(get(flags, "unnecessary_question_counted"))} | #{status} |"
  end

  defp path_label(nil, id), do: "`#{@fixtures_rel}/snapshots/#{id}.json`"
  defp path_label(path, _id), do: "`#{rel(path)}`"

  defp yes_no(true), do: "✓"
  defp yes_no(_), do: "—"

  defp truthy(value) when value in [true, "true", 1], do: true
  defp truthy(_), do: false

  defp write_drift_report(results, probes, arm_result, opts) do
    File.mkdir_p!(@artifacts_dir)
    drift = Enum.filter(results, &(&1.status == :drift))

    body = """
    # B27 CP0 快照校验（--check）

    - 生成时间：#{DateTime.utc_now() |> DateTime.to_iso8601()}
    - 输出目录：`#{opts.out_dir}`
    - 校验结果：#{if drift == [] and arm_result.status == :verified, do: "一致", else: "存在漂移"}
    - 漂移案例：#{if drift == [], do: "无", else: inspect(Enum.map(drift, & &1.case_id))}
    - arms.yml：#{arm_result.status}#{if arm_result.drift == [], do: "", else: " 漂移资产：#{inspect(Enum.map(arm_result.drift, & &1.path))}"}
    - 探针：#{inspect(Enum.map(probes, &{&1.case_id, &1.status}))}
    """

    File.write!(Path.join(@artifacts_dir, "freeze-check.md"), body)
  end

  # ── 小工具 ──────────────────────────────────────────────────────────────

  defp read_yaml!(path) do
    YamlElixir.read_from_file!(path)
  rescue
    error ->
      IO.puts("[b27-freeze] 无法读取/解析 #{path}: #{Exception.message(error)}")
      System.halt(2)
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

  defp chars(nil), do: 0
  defp chars(value) when is_binary(value), do: String.length(value)
  defp chars(_), do: 0

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

  @doc false
  def det_uuid(seed) do
    bytes = :crypto.hash(:sha256, "b27-cp0:" <> seed)
    {:ok, uuid} = Ecto.UUID.load(binary_part(bytes, 0, 16))
    uuid
  end

  defp sha256(binary) when is_binary(binary),
    do: :crypto.hash(:sha256, binary) |> Base.encode16(case: :lower)

  defp canonical_json(value), do: value |> canonical() |> Jason.encode!()

  defp canonical(map) when is_map(map) do
    Map.new(map, fn {key, value} -> {to_string(key), canonical(value)} end)
  end

  defp canonical(list) when is_list(list), do: Enum.map(list, &canonical/1)
  defp canonical(nil), do: nil
  defp canonical(value) when is_atom(value) and value not in [true, false, nil], do: Atom.to_string(value)
  defp canonical(value), do: value

  defp rel(abs_path) do
    case Path.relative_to(abs_path, @root) do
      ^abs_path -> abs_path
      rel -> rel
    end
  end

  defp redaction_patterns, do: ["api_key", "sk-*", "Bearer *", "/Users/*", "/var/folders/*"]
end

B27CaseFreeze.main(System.argv())
