# B27 CP4 双臂语义 episode 运行器（old_rules 冻结快照回放 / integrated 生产入口）
#
# 归属：B27 §6.1 真实模型语义验收（CP4 执行批的基础设施）。本脚本**不**判定语义通过、
# 不声称门槛通过；它只负责产出可判分的 episode 证据（原始请求/响应/映射/耗时/usage），
# 逐例判定与聚合门槛由 `scripts/model_contracts/b27_semantic_score.exs` 承接。
#
# ── 两臂定义 ─────────────────────────────────────────────────────────────
#
#   old（old_rules_arm）
#     回放 CP0 冻结快照 `quality/acceptance/fixtures/b27-semantic-cases/snapshots/<ID>.json`
#     的请求（messages/tools/tool_choice + inference 常量），直接打到同一 provider。
#     **不做旧 prompt 重渲染**：messages 字节来自冻结快照；L0 身份按快照
#     `request.system_identity` 还原（生产 SystemIdentity.inject/1 同源），保证旧臂输入不变。
#     CP0 只冻结了首轮请求，故 old 臂 episode = 单轮回放（rounds_executed=1），
#     探索后的续行轮不在快照内，不伪造。与真实生产请求的差异边界写在 episode
#     `episode.boundary` 与 HTTP 层 `wire_captures`：wire messages 与冻结快照逐字比对，
#     工具 schema 由 adapter 做 OpenAI 兼容投影（工具名可比、schema 形态不同）。
#
#   integrated（integrated_arm）
#     走当前生产入口：`DialoguePlanningService.plan_agent_run/3`
#     + 判断循环真实 planner + 真实 AgentRun step 收敛到 complete；
#     注入的是生产默认 provider execution dependency，真实调用 LM Studio / Strata。
#     请求/响应在 provider adapter `log_fn` 边界采集（与 B26 CP0 探针同一采集面，
#     即真实 wire body），同时记录每一步 stage_state / 探索观察 / TurnResult。
#     这是「capture execution at provider boundary」：只旁路记录，不替换模型结论、
#     不写作品数据（隔离 test DB + Sandbox 回滚）。
#
# ── 用法 ────────────────────────────────────────────────────────────────
#
#   # 快照完整性（不调用 provider；默认 20 例）
#   MIX_ENV=test NOVEL_TEST_DB_DIR=artifacts/model-contracts/b27-cp4/db MIX_TEST_PARTITION=b27cp4 \
#     mix run scripts/model_contracts/b27_semantic_eval.exs --check-snapshots
#
#   # old 臂：stage 实际模型 Strata / iq3_s，M01/M11 各跑 2 次
#   MIX_ENV=test NOVEL_TEST_DB_DIR=artifacts/model-contracts/b27-cp4/db MIX_TEST_PARTITION=b27cp4 \
#     mix run scripts/model_contracts/b27_semantic_eval.exs --arm old --case M01,M11 --provider strata
#
#   # integrated 臂：生产入口 + 真实 provider（隔离 CP4 DB，必须）
#   MIX_ENV=test NOVEL_TEST_DB_DIR=artifacts/model-contracts/b27-cp4/db MIX_TEST_PARTITION=b27cp4 \
#     mix run scripts/model_contracts/b27_semantic_eval.exs --arm integrated --case M01,M11 --provider strata
#
#   # 双臂正式矩阵（CP4 执行批；20×2×2 = 80 episode）
#   ... --arm both --all --provider strata --runs 2
#
#   # LM Studio（先探活；模型按 --model 或默认 qwen/qwen3.8-27b，单例 300s）
#   ... --arm old --case M01 --provider lmstudio --model qwen/qwen3.8-27b
#
#   # 计划面探针（SP01 冻结快照：old 臂回放 plan_draft；integrated 臂真实模型自行判断）
#   ... --arm old --case SP01 --surface plan --provider strata
#
# ── 参数 ────────────────────────────────────────────────────────────────
#   --arm old|integrated|both       默认 old（`old_rules` 接受为 old 别名）
#   --case ID[,ID]                  可多次；ID 为 M01–M20 或 SP01；默认 M01
#   --all                           全部 20 例（不含 SP01 计划面探针）
#   --surface judgment|plan         快照请求面；plan 仅 SP01
#   --provider stub|lmstudio|strata|deepseek   默认 stub
#   --model MODEL                   覆盖 provider 模型（默认见 @providers）
#   --runs N                        每例重复次数，默认 2（§6.1）
#   --out DIR                       输出目录，默认 artifacts/model-contracts/b27-cp4
#   --max-steps N                   integrated 单 episode 最大 step 数，默认 12
#   --timeout-ms N                  单 episode 挂钟上限，默认 300000（超时如实记未成功）
#   --check-snapshots               只校验冻结快照完整性，不调用 provider
#   --skip-health-check             跳过 provider 探活（仅供离线诊断；默认必须探活）
#
# ── 产出 ────────────────────────────────────────────────────────────────
#   <out>/episodes/<case>-<arm>-<provider>-run<N>.json   逐 episode 证据
#   <out>/summaries/summary-<stamp>.json                 批次摘要（不是语义判分）
#   <out>/run-manifest-<stamp>.json                      运行环境/输入 hash/命令
#
# ── 退出码 ──────────────────────────────────────────────────────────────
#   0 全部 episode 有响应且落盘（stub 结果 semantic_evidence=false）
#   1 至少一个 provider 失败（按 §6.1 计未成功，不删分母）
#   2 用法错误 / 快照缺失 / 完整性失败 / DB 未隔离
#   3 blocked（凭据缺失 / 探活失败 / 模型未加载 / 快照不可用）
#
# 边界：stub 只证明管道/字段/解析；real provider 单轮/多轮响应也不等于语义通过。
# §6.1 通过与否只能由评分器在逐例判定填写后聚合，不能由本脚本自动断言。

Code.require_file(Path.join(__DIR__, "b27_episode_support.exs"))

defmodule B27SemanticEval do
  @moduledoc false

  alias NovelAgent.Provider.{Execution, InferenceParams}
  alias NovelApplication.JudgmentToolContract

  @root Path.expand("../..", __DIR__)
  @fixtures_rel "quality/acceptance/fixtures/b27-semantic-cases"
  @fixtures Path.join(@root, @fixtures_rel)
  @cases_path Path.join(@fixtures, "cases.yml")
  @arms_path Path.join(@fixtures, "arms.yml")
  @snapshots_dir Path.join(@fixtures, "snapshots")
  @default_out Path.join(@root, "artifacts/model-contracts/b27-cp4")
  @db_marker "b27-cp4"

  # 必验模型（与 cases.yml required_models 对齐）。LM Studio 默认取 test/dev 生产配置同源
  # 模型 qwen/qwen3.8-27b；可用 --model 显式覆盖并如实记录。
  @providers %{
    "stub" => %{provider: :stub, model: "stub", semantic: false},
    "lmstudio" => %{
      provider: :lmstudio,
      model: "qwen/qwen3.8-27b",
      semantic: true,
      health_url: "http://localhost:1234/v1/models"
    },
    "strata" => %{
      provider: :strata,
      model: "iq3_s",
      semantic: true,
      health_url: "http://127.0.0.1:47831/v1/models"
    },
    "deepseek" => %{provider: :deepseek, model: "deepseek-v4-pro", semantic: true}
  }

  # 首轮允许/条件路径（runner 级辅助，仅供证据字段；最终 rubric 判卷由评分器承接）。
  @paths %{
    "M01" => %{allowed: [:explore], conditional: [:reply]},
    "M02" => %{allowed: [:reply], conditional: []},
    "M03" => %{allowed: [:explore], conditional: []},
    "M04" => %{allowed: [:reply, :execute], conditional: []},
    "M05" => %{allowed: [:explore, :reply], conditional: []},
    "M06" => %{allowed: [:explore, :ask_author], conditional: [:reply]},
    "M07" => %{allowed: [:execute], conditional: [:explore]},
    "M08" => %{allowed: [:execute], conditional: [:explore]},
    "M09" => %{allowed: [:creative_directions, :reply], conditional: []},
    "M10" => %{allowed: [:reply], conditional: []},
    "M11" => %{allowed: [:register_author_content], conditional: [:explore]},
    "M12" => %{allowed: [:register_author_content], conditional: [:explore]},
    "M13" => %{allowed: [:reply], conditional: []},
    "M14" => %{allowed: [:capability_gap, :explore], conditional: [:reply]},
    "M15" => %{allowed: [:execute], conditional: [:explore]},
    "M16" => %{allowed: [:explore, :reply, :execute], conditional: []},
    "M17" => %{allowed: [:explore, :ask_author, :reply], conditional: []},
    "M18" => %{allowed: [:explore, :ask_author], conditional: [:reply]},
    "M19" => %{allowed: [:reply, :explore], conditional: []},
    "M20" => %{allowed: [:reply, :explore], conditional: []},
    "SP01" => %{allowed: [:plan_draft], conditional: [:plan]}
  }

  @execute_cases ["M04", "M07", "M08", "M15", "M16"]

  # ── 入口 ────────────────────────────────────────────────────────────────

  def main(argv) do
    opts = parse_args(argv)

    if opts.check_snapshots do
      check_snapshots(opts)
    else
      run(opts)
    end
  end

  # ── 参数 ────────────────────────────────────────────────────────────────

  defp parse_args(argv) do
    parsed =
      parse_flags(argv, %{
        cases: [],
        all: false,
        check_snapshots: false,
        arm: nil,
        provider: nil,
        model: nil,
        runs: 2,
        out: nil,
        surface: nil,
        max_steps: 12,
        timeout_ms: 300_000,
        skip_health_check: false
      })

    cases_explicit = parsed.all or parsed.cases != []

    cases =
      cond do
        parsed.all -> :all
        parsed.cases != [] -> parsed.cases
        true -> ["M01"]
      end

    arm = normalize_arm(parsed.arm)
    provider = parsed.provider || "stub"
    surface = parsed.surface

    unless arm in ["old", "integrated", "both"] do
      usage_error("--arm 只支持 old|integrated|both（收到 #{inspect(parsed.arm)}）")
    end

    unless Map.has_key?(@providers, provider) do
      usage_error("未知 provider: #{provider}（可用：#{Map.keys(@providers) |> Enum.join("|")}）")
    end

    if surface != nil and surface not in ["judgment", "plan"] do
      usage_error("--surface 只支持 judgment|plan（收到 #{inspect(surface)}）")
    end

    runs = max(parsed.runs, 1)
    max_steps = max(parsed.max_steps, 1)
    timeout_ms = max(parsed.timeout_ms, 1_000)

    out =
      case parsed.out do
        nil -> @default_out
        path -> Path.expand(path, @root)
      end

    provider_cfg = Map.fetch!(@providers, provider)
    requested_model = parsed.model || provider_cfg.model

    %{
      cases: cases,
      cases_explicit: cases_explicit,
      all: parsed.all,
      check_snapshots: parsed.check_snapshots,
      arm: arm,
      provider: provider,
      provider_cfg: provider_cfg,
      requested_model: requested_model,
      effective_model: effective_model(provider, requested_model),
      runs: runs,
      out: out,
      surface: surface,
      max_steps: max_steps,
      timeout_ms: timeout_ms,
      skip_health_check: parsed.skip_health_check,
      raw_argv: argv
    }
  end

  defp parse_flags([], acc), do: acc

  defp parse_flags([flag | rest], acc) do
    {name, inline_value} =
      case String.split(flag, "=", parts: 2) do
        [name, value] -> {name, value}
        [name] -> {name, nil}
      end

    case name do
      "--all" ->
        parse_flags(rest, Map.put(acc, :all, true))

      "--check-snapshots" ->
        parse_flags(rest, Map.put(acc, :check_snapshots, true))

      "--skip-health-check" ->
        parse_flags(rest, Map.put(acc, :skip_health_check, true))

      "--help" ->
        IO.puts("用法见 scripts/model_contracts/b27_semantic_eval.exs 头部注释")
        System.halt(0)

      "--case" ->
        {value, rest} = value_or_next(inline_value, rest)
        cases = acc.cases ++ String.split(value || "", ",", trim: true)
        parse_flags(rest, %{acc | cases: cases})

      "--provider" ->
        {value, rest} = value_or_next(inline_value, rest)
        parse_flags(rest, %{acc | provider: value})

      "--arm" ->
        {value, rest} = value_or_next(inline_value, rest)
        parse_flags(rest, %{acc | arm: value})

      "--model" ->
        {value, rest} = value_or_next(inline_value, rest)
        parse_flags(rest, %{acc | model: value})

      "--out" ->
        {value, rest} = value_or_next(inline_value, rest)
        parse_flags(rest, %{acc | out: value})

      "--surface" ->
        {value, rest} = value_or_next(inline_value, rest)
        parse_flags(rest, %{acc | surface: value})

      "--runs" ->
        {value, rest} = value_or_next(inline_value, rest)
        parse_flags(rest, %{acc | runs: parse_int(value, acc.runs)})

      "--max-steps" ->
        {value, rest} = value_or_next(inline_value, rest)
        parse_flags(rest, %{acc | max_steps: parse_int(value, acc.max_steps)})

      "--timeout-ms" ->
        {value, rest} = value_or_next(inline_value, rest)
        parse_flags(rest, %{acc | timeout_ms: parse_int(value, acc.timeout_ms)})

      other ->
        usage_error("未知参数: #{other}")
    end
  end

  defp value_or_next(nil, [value | rest]), do: {value, rest}
  defp value_or_next(nil, []), do: {nil, []}
  defp value_or_next(value, rest), do: {value, rest}

  defp parse_int(nil, default), do: default

  defp parse_int(value, default) do
    case Integer.parse(value) do
      {n, _} -> n
      :error -> default
    end
  end

  defp normalize_arm(nil), do: "old"

  defp normalize_arm(arm) do
    case String.downcase(to_string(arm)) do
      "old" -> "old"
      "old_rules" -> "old"
      "old_rules_arm" -> "old"
      "integrated" -> "integrated"
      "integrated_arm" -> "integrated"
      "both" -> "both"
      other -> other
    end
  end

  defp effective_model("stub", model), do: to_string(model || "stub")

  defp effective_model(provider, model) do
    env_key =
      case provider do
        "lmstudio" -> "NOVEL_LMSTUDIO_MODEL"
        "strata" -> "NOVEL_STRATA_MODEL"
        "deepseek" -> "NOVEL_DEEPSEEK_MODEL"
        _ -> nil
      end

    (env_key && System.get_env(env_key)) || model
  end

  defp usage_error(message) do
    IO.puts("[b27-eval] 用法错误: #{message}")
    System.halt(2)
  end

  # ── 快照完整性（不调用 provider）────────────────────────────────────────

  defp check_snapshots(opts) do
    manifest = read_yaml!(@cases_path)
    all_cases = get(manifest, "cases") || []
    probes = get(manifest, "surface_probes") || []

    # 无显式选择器时校验全部 20 例（要求 --check-snapshots 仍 20/20）。
    case_ids =
      if opts.cases_explicit,
        do: selected_case_ids(opts, all_cases),
        else: Enum.map(all_cases, &get(&1, "id"))

    case_results = Enum.map(case_ids, &check_one_snapshot(&1, opts.surface))

    check_probes =
      if opts.cases_explicit do
        "SP01" in case_ids
      else
        true
      end

    probe_results =
      if check_probes do
        Enum.map(probes, fn probe ->
          if get(probe, "snapshot") == "available" do
            check_one_snapshot(get(probe, "id"), "plan")
          else
            %{id: get(probe, "id"), ok: true, skipped: true, detail: %{snapshot: "unavailable"}}
          end
        end)
      else
        []
      end

    Enum.each(case_results, fn r ->
      status = if r.ok, do: "integrity ok", else: "FAIL #{inspect(r.detail)}"
      IO.puts("[b27-eval] #{r.id}: #{status}")
    end)

    Enum.each(probe_results, fn r ->
      status =
        cond do
          Map.get(r, :skipped) -> "snapshot unavailable（登记为探针不可用，不计入 20 例）"
          r.ok -> "integrity ok"
          true -> "FAIL #{inspect(r.detail)}"
        end

      IO.puts("[b27-eval] probe #{r.id}: #{status}")
    end)

    bad = Enum.reject(case_results, & &1.ok)
    case_total = length(case_results)
    case_ok = case_total - length(bad)
    IO.puts("[b27-eval] integrity: #{case_ok}/#{case_total} ok (cases)")

    if bad != [], do: System.halt(2)
  end

  defp check_one_snapshot(id, surface) do
    case load_snapshot(id, surface) do
      {:ok, snap} ->
        integrity = integrity(snap)
        %{id: id, ok: get(integrity, "verified") == true, detail: integrity}

      {:error, reason} ->
        %{id: id, ok: false, detail: %{error: inspect(reason)}}
    end
  end

  # ── 主流程 ──────────────────────────────────────────────────────────────

  defp run(opts) do
    start_manifest = run_manifest(opts)

    if opts.provider == "deepseek" and not deepseek_credential?() do
      IO.puts("""
      [b27-eval] BLOCKED: deepseek 需要真实凭据（DEEPSEEK_API_KEY / NOVEL_DEEPSEEK_API_KEY）。
        本机未配置；该候选必验模型记为 blocked（不伪造可用）。
      """)

      write_manifest(opts, start_manifest, [], :blocked)
      System.halt(3)
    end

    preview_provider!(opts)

    manifest = read_yaml!(@cases_path)
    all_cases = get(manifest, "cases") || []
    all_probes = get(manifest, "surface_probes") || []
    fixtures = get(manifest, "fixtures") || %{}

    fixture_bundle = %{
      work_defaults: get(fixtures, "work_defaults") || %{},
      prose: get(fixtures, "prose") || %{}
    }

    cases = selected_case_ids(opts, all_cases)
    case_specs = resolve_case_specs(cases, all_cases, all_probes, opts)

    if opts.arm in ["integrated", "both"] do
      B27EpisodeSupport.ensure_isolated_db!(@db_marker)
    end

    configure_provider(opts)

    {:ok, capture_pid} = Agent.start_link(fn -> [] end)
    install_wire_capture(opts.provider_cfg.provider, capture_pid)

    File.mkdir_p!(Path.join(opts.out, "episodes"))
    File.mkdir_p!(Path.join(opts.out, "summaries"))

    arms = if opts.arm == "both", do: ["old", "integrated"], else: [opts.arm]

    episodes =
      Enum.flat_map(arms, fn arm ->
        Enum.flat_map(case_specs, fn spec ->
          case_id = get(spec, "id")

          Enum.map(1..opts.runs, fn run_index ->
            IO.puts(
              "[b27-eval] running arm=#{arm} case=#{case_id} run=#{run_index} provider=#{opts.provider}"
            )

            doc =
              case arm do
                "old" ->
                  run_old_episode(case_id, spec, opts, run_index, capture_pid)

                "integrated" ->
                  run_integrated_episode(
                    case_id,
                    spec,
                    fixture_bundle,
                    opts,
                    run_index,
                    capture_pid
                  )
              end

            path = episode_path(opts, case_id, arm, run_index)
            File.write!(path, Jason.encode!(doc, pretty: true) <> "\n")

            print_episode(doc)
            Map.put(doc, "episode_path", rel(path))
          end)
        end)
      end)

    summary = summarize(episodes, opts)
    stamp = stamp()

    File.write!(
      Path.join([opts.out, "summaries", "summary-#{stamp}.json"]),
      Jason.encode!(summary, pretty: true) <> "\n"
    )

    write_manifest(opts, start_manifest, episodes, :done)
    print_summary(summary)

    statuses = Enum.map(episodes, & &1["status"])

    cond do
      Enum.all?(statuses, &(&1 == "blocked")) -> System.halt(3)
      Enum.any?(statuses, &(&1 in ["provider_error", "execution_error"])) -> System.halt(1)
      true -> :ok
    end
  end

  defp selected_case_ids(opts, all_cases) do
    ids = Enum.map(all_cases, &get(&1, "id"))

    case opts.cases do
      :all ->
        ids

      list ->
        unknown = Enum.reject(list, &(&1 in ids or &1 == "SP01"))

        if unknown != [] do
          usage_error("未知案例: #{Enum.join(unknown, ",")}（可用 M01–M20 / SP01）")
        end

        list
    end
  end

  defp resolve_case_specs(ids, all_cases, all_probes, opts) do
    specs =
      Enum.map(ids, fn id ->
        case Enum.find(all_cases ++ all_probes, &(get(&1, "id") == id)) do
          nil -> usage_error("案例 #{id} 不在 cases.yml 中")
          spec -> spec
        end
      end)

    case opts.surface do
      "plan" ->
        if ids != ["SP01"] do
          usage_error("--surface plan 只用于 SP01 计划面探针；20 例 rubric 案例固定 judgment 面")
        end

        specs

      _ ->
        if "SP01" in ids do
          usage_error("SP01 是计划面探针，请显式使用 --surface plan --case SP01")
        end

        specs
    end
  end

  # ── old 臂：冻结快照单轮回放 ────────────────────────────────────────────

  defp run_old_episode(case_id, spec, opts, run_index, capture_pid) do
    started = System.monotonic_time(:millisecond)

    try do
      case load_snapshot(case_id, opts.surface) do
        {:ok, snap} ->
          integrity = integrity(snap)
          request = select_request(snap, opts.surface)
          prompt = build_prompt(request)

          Agent.update(capture_pid, fn _ -> [] end)
          call_started = System.monotonic_time(:millisecond)
          outcome = provider_complete_with_timeout(prompt, opts)
          call_elapsed = System.monotonic_time(:millisecond) - call_started
          wire_calls = Agent.get(capture_pid, & &1)
          elapsed = System.monotonic_time(:millisecond) - started

          base = %{
            "schema" => "b27-semantic-episode-v1",
            "generated_at" => now_iso(),
            "case_id" => case_id,
            "case_title" => get(spec, "title"),
            "arm" => "old",
            "arm_slot" => "old_rules_arm",
            "run_index" => run_index,
            "provider" => to_string(opts.provider_cfg.provider),
            "requested_model" => opts.effective_model,
            "actual_model" => actual_model(wire_calls, outcome),
            "call_surface" => get(snap, "call_surface") || opts.surface || "judgment",
            "request_ref" => %{
              "kind" => "cp0_frozen_snapshot_replay",
              "snapshot_path" =>
                rel(Path.join(@snapshots_dir, snapshot_filename(case_id, opts.surface))),
              "snapshot_file_sha256" =>
                sha256(
                  File.read!(Path.join(@snapshots_dir, snapshot_filename(case_id, opts.surface)))
                ),
              "frozen_request_sha256" => integrity["frozen_request_sha256"],
              "actual_request_sha256" => integrity["actual_request_sha256"],
              "integrity_verified" => integrity["verified"],
              "prompt_sha256" => sha256(canonical_json(prompt)),
              "prompt_chars" => prompt_chars(prompt)
            },
            "response" => response_doc(outcome, wire_calls, call_elapsed),
            "mapping" => mapping_doc(case_id, outcome, wire_calls, opts.surface),
            "allowed_path" => allowed_path_doc(case_id, outcome, wire_calls, opts.surface),
            "forbidden_candidates" =>
              zero_tolerance_candidates(case_id, outcome, wire_calls, opts.surface),
            "unnecessary_question_candidate" =>
              unnecessary_question_candidate(case_id, spec, outcome, wire_calls),
            "elapsed_ms" => elapsed,
            "provider_call_count" => length(wire_calls),
            "usage" => aggregate_usage(wire_calls),
            "error_class" => error_class(outcome),
            "status" => if(match?({:ok, _}, outcome), do: "ok", else: "provider_error"),
            "availability" => if(match?({:ok, _}, outcome), do: "available", else: "unavailable"),
            "episode" => %{
              "kind" => "frozen_first_round_replay",
              "rounds_planned" => 1,
              "rounds_executed" => 1,
              "complete" => false,
              "boundary" =>
                "old 臂只回放 CP0 冻结的首轮请求，不做旧 prompt 重渲染；探索后的续行轮不在快照内，" <>
                  "因此本 episode 是单轮语义证据，不是完整 40 episode 门槛。"
            },
            "wire_captures" => Enum.map(wire_calls, &wire_call_doc/1),
            "wire_request_matches_snapshot" => wire_messages_match?(wire_calls, request),
            "materials" => material_summary(snap),
            "workspace_arm" => workspace_arm_check(),
            "method" => method_doc(opts),
            "provider_config" => provider_config_doc(opts)
          }

          base
          |> Map.put("snapshot", integrity)
          |> Map.put("spec_flags", spec_flags(spec))

        {:error, reason} ->
          blocked_episode(
            case_id,
            "old",
            run_index,
            opts,
            {:snapshot_unavailable, reason},
            started
          )
      end
    rescue
      error ->
        error_episode(
          case_id,
          "old",
          run_index,
          opts,
          {:runner_exception, Exception.message(error)},
          started
        )
    end
  end

  # ── integrated 臂：生产入口 + 真实 provider ─────────────────────────────

  defp run_integrated_episode(case_id, spec, fixture_bundle, opts, run_index, capture_pid) do
    started = System.monotonic_time(:millisecond)

    try do
      Agent.update(capture_pid, fn _ -> [] end)

      outcome =
        B27EpisodeSupport.run_case_episode(case_id, spec, fixture_bundle, %{
          max_steps: opts.max_steps,
          episode_timeout_ms: opts.timeout_ms,
          capture_pid: capture_pid
        })

      elapsed = System.monotonic_time(:millisecond) - started

      case outcome do
        {:ok, evidence} ->
          wire_calls = get(evidence, "provider_calls") || []

          base = %{
            "schema" => "b27-semantic-episode-v1",
            "generated_at" => now_iso(),
            "case_id" => case_id,
            "case_title" => get(spec, "title"),
            "arm" => "integrated",
            "arm_slot" => "integrated_arm",
            "run_index" => run_index,
            "provider" => to_string(opts.provider_cfg.provider),
            "requested_model" => opts.effective_model,
            "actual_model" => actual_model(wire_calls, {:ok, nil}),
            "call_surface" => opts.surface || "judgment",
            "request_ref" => %{
              "kind" => "integrated_production_entry",
              "entry" => "NovelApplication.DialoguePlanningService.plan_agent_run/3",
              "step_driver" =>
                "b27_episode_support.run_case_episode/4（生产 planner + 真实 AgentRun step 收敛）",
              "capture_boundary" => "NovelAgent.Provider adapter log_fn（真实 wire body）",
              "run_ref" => get(evidence, "run_ref"),
              "profile_ref" => get(evidence, "profile_ref"),
              "rounds_executed" => get(evidence, "rounds_executed"),
              "first_request_sha256" => first_request_sha(wire_calls),
              "provider_call_count" => length(wire_calls)
            },
            "response" => integrated_response_doc(evidence, wire_calls, elapsed),
            "mapping" => integrated_mapping_doc(case_id, evidence, wire_calls, opts.surface),
            "allowed_path" =>
              integrated_allowed_path_doc(case_id, evidence, wire_calls, opts.surface),
            "forbidden_candidates" =>
              integrated_zero_tolerance_candidates(case_id, evidence, wire_calls),
            "unnecessary_question_candidate" =>
              integrated_unnecessary_question_candidate(case_id, spec, evidence),
            "elapsed_ms" => elapsed,
            "provider_call_count" => length(wire_calls),
            "usage" => aggregate_usage(wire_calls),
            "error_class" => nil,
            "status" => "ok",
            "availability" => "available",
            "episode" => %{
              "kind" => "integrated_production_loop",
              "rounds_planned" => 2,
              "rounds_executed" => get(evidence, "rounds_executed"),
              "complete" => get(evidence, "end_reason") == "complete",
              "end_reason" => get(evidence, "end_reason"),
              "awaiting_author" => get(evidence, "awaiting_author") == true,
              "rounds" => get(evidence, "rounds"),
              "turn_result" => get(evidence, "turn_result"),
              "complete_decision" => get(evidence, "complete_decision"),
              "complete_meta" => get(evidence, "complete_meta")
            },
            "wire_captures" => Enum.map(wire_calls, &wire_call_doc/1),
            "seeded_candidates" => get(evidence, "seeded_candidates"),
            "reading_projection_facts" => get(evidence, "reading_projection_facts"),
            "app_side_evidence" => get(evidence, "app_side_evidence"),
            "materials_model_visible" =>
              prompt_visible_materials(
                get(evidence, "materials_model_visible"),
                wire_calls,
                evidence
              ),
            "content_anomaly" => content_anomaly(evidence),
            "exploration_coverage" => exploration_coverage(evidence),
            "workspace_arm" => workspace_arm_check(),
            "method" => method_doc(opts),
            "provider_config" => provider_config_doc(opts),
            "integrated_context" => %{
              "db" => "MIX_ENV=test + NOVEL_TEST_DB_DIR=#{db_dir()} + Sandbox 回滚",
              "fixture_uuid_namespace" => "b27-cp0（与 CP0 冻结快照材料 ref 可比）",
              "deviation" => "provider 默认选择被脚本覆盖为本次 --provider（stage 等价），其余走生产默认依赖",
              "concurrent_workspace_note" => "运行期间工作区可能有并行 B27 CP3 修改；规则资产 hash 见 workspace_arm"
            }
          }

          Map.put(base, "spec_flags", spec_flags(spec))

        {:error, error} ->
          error_episode(case_id, "integrated", run_index, opts, error, started,
            partial_provider_calls: get(error, :partial_provider_calls),
            app_side_evidence: get(error, :app_side_evidence),
            materials_model_visible: get(error, :materials_model_visible),
            seeded_candidates: get(error, :seeded_candidates),
            content_anomaly: content_anomaly(%{"turn_result" => nil, "end_reason" => "error"}),
            exploration_coverage: exploration_coverage(%{"rounds" => get(error, :rounds) || []})
          )
      end
    rescue
      error ->
        error_episode(
          case_id,
          "integrated",
          run_index,
          opts,
          {:runner_exception, Exception.message(error)},
          started
        )
    end
  end

  # ── provider 调用（old 臂）与采集安装 ───────────────────────────────────

  defp provider_complete(prompt, opts) do
    try do
      Execution.complete(prompt,
        provider: opts.provider_cfg.provider,
        purpose: :planner,
        content_visibility: :author,
        params: InferenceParams.new(temperature: 0.2)
      )
    rescue
      error -> {:error, %{message: Exception.message(error), reason_code: :runner_exception}}
    catch
      kind, reason ->
        {:error, %{message: inspect({kind, reason}), reason_code: :runner_exception}}
    end
  end

  # old 臂单轮调用也遵守 --timeout-ms 的 episode 挂钟：provider 卡住/排队时如实记超时，
  # 不无限等待共享 LM Studio/Strata 实例。超时按 §6.1 计未成功（不删分母）。
  defp provider_complete_with_timeout(prompt, opts) do
    task = Task.async(fn -> provider_complete(prompt, opts) end)

    case Task.yield(task, opts.timeout_ms) do
      {:ok, result} ->
        result

      {:exit, reason} ->
        {:error,
         %{
           message: "provider task exit: #{truncate_json(inspect(reason), 500)}",
           reason_code: :runner_exception
         }}

      nil ->
        _ = Task.shutdown(task, :brutal_kill)

        {:error,
         %{
           message: "episode wall clock > #{opts.timeout_ms}ms（provider 未在时限内返回）",
           reason_code: :timeout
         }}
    end
  end

  # 在 provider adapter 配置上安装 log_fn：采集真实 wire 请求与结果（只旁路记录）。
  defp install_wire_capture(provider, capture_pid) do
    module = provider_module(provider)

    if is_nil(module) do
      IO.puts("[b27-eval] provider=#{provider} 无 wire 采集 hook（stub）；episode 只含 step 证据。")
      :unsupported
    else
      existing = Application.get_env(:novel_agent, module, [])

      log_fn = fn vendor, url, body, result, started_at ->
        try do
          call = %{
            "provider" => to_string(vendor),
            "url" => sanitize_url(url),
            "started_at_monotonic_ms" => started_at,
            "finished_at_monotonic_ms" => System.monotonic_time(:millisecond),
            "wire_request" => jsonable(body),
            "wire_result" => result_fact(result)
          }

          Agent.update(capture_pid, fn calls -> calls ++ [call] end)
          :ok
        rescue
          _ -> :ok
        end
      end

      Application.put_env(:novel_agent, module, Keyword.put(existing, :log_fn, log_fn))
      :ok
    end
  end

  defp provider_module(:stub), do: nil
  defp provider_module(:lmstudio), do: NovelAgent.Provider.LMStudio
  defp provider_module(:strata), do: NovelAgent.Provider.Strata
  defp provider_module(:deepseek), do: NovelAgent.Provider.DeepSeek
  defp provider_module(_), do: nil

  defp result_fact({:ok, %NovelAgent.Provider.Result{} = result, attrs}) do
    %{
      "kind" => "success",
      "http_status" => get(attrs, :status),
      "content" => result.content || "",
      "content_chars" => chars(result.content),
      "content_sha256" => sha256(to_string(result.content || "")),
      "tool_calls" => jsonable(result.tool_calls || []),
      "usage" => jsonable(result.usage),
      "adapter_duration_ms" => get(attrs, :duration),
      "resp_body" => truncate_json(get(attrs, :resp_body), 2_000)
    }
  end

  defp result_fact({:ok, %NovelAgent.Provider.Result{} = result}) do
    %{
      "kind" => "success",
      "http_status" => nil,
      "content" => result.content || "",
      "content_chars" => chars(result.content),
      "content_sha256" => sha256(to_string(result.content || "")),
      "tool_calls" => jsonable(result.tool_calls || []),
      "usage" => jsonable(result.usage)
    }
  end

  defp result_fact({:ok, other, attrs}) do
    %{
      "kind" => "success_other",
      "http_status" => get(attrs, :status),
      "result" => truncate_json(jsonable(other), 4_000),
      "adapter_duration_ms" => get(attrs, :duration)
    }
  end

  defp result_fact({:error, {:error, error}, attrs}) do
    %{
      "kind" => "error",
      "http_status" => get(attrs, :status),
      "error" => jsonable(error),
      "adapter_duration_ms" => get(attrs, :duration),
      "resp_body" => truncate_json(get(attrs, :resp_body), 2_000)
    }
  end

  defp result_fact({:error, error}) do
    %{"kind" => "error", "error" => jsonable(error)}
  end

  defp result_fact(other),
    do: %{"kind" => "unknown", "raw" => truncate_json(inspect(other), 1_000)}

  # ── episode 文档字段组装 ────────────────────────────────────────────────

  defp response_doc({:ok, %NovelAgent.Provider.Result{} = result}, wire_calls, elapsed) do
    %{
      "kind" => "provider_result",
      "content" => result.content || "",
      "content_chars" => chars(result.content),
      "tool_calls" => jsonable(result.tool_calls || []),
      "finish_reason" => result.provider_output && get(result.provider_output, :output_type),
      "duration_ms" => elapsed,
      "provider_calls" => max(length(wire_calls), 1)
    }
  end

  defp response_doc({:error, error}, wire_calls, elapsed) do
    %{
      "kind" => "provider_error",
      "error" => normalize_error(error),
      "duration_ms" => elapsed,
      "provider_calls" => length(wire_calls)
    }
  end

  defp response_doc(_other, wire_calls, elapsed) do
    %{"kind" => "unknown", "duration_ms" => elapsed, "provider_calls" => length(wire_calls)}
  end

  defp integrated_response_doc(evidence, wire_calls, elapsed) do
    last_call = List.last(wire_calls)
    turn_result = get(evidence, "turn_result") || %{}
    last_result = get(last_call || %{}, "wire_result") || %{}

    %{
      "kind" => "production_loop_final",
      "final_text" => get(turn_result, "text"),
      "final_text_chars" => chars(get(turn_result, "text")),
      "last_response_content" => get(last_result, "content"),
      "last_response_tool_calls" => get(last_result, "tool_calls") || [],
      "finish_reason" => finish_reason(last_result),
      "duration_ms" => elapsed,
      "provider_calls" => length(wire_calls)
    }
  end

  defp mapping_doc(_case_id, outcome, wire_calls, surface) do
    classification = classify_outcome(outcome, wire_calls, surface)

    %{
      "judgment_action" => classification["decision"],
      "decision_detail" => classification["detail"],
      "tool_calls" => classification["tool_calls"],
      "final_text" => final_text(outcome, wire_calls),
      "response_kind" => if(match?({:ok, _}, outcome), do: "ok", else: "error"),
      "contract_validation" => contract_validation(outcome),
      "rubric_note" => "runner 映射只作判卷输入；semantic_success 必须由评分器读取人工判定后聚合"
    }
  end

  defp integrated_mapping_doc(_case_id, evidence, _wire_calls, surface) do
    tool_events = integrated_tool_events(evidence)
    judgment_decisions = Enum.filter(tool_events, &(&1["name"] == "judgment_decision"))
    first = List.first(judgment_decisions)

    first_action =
      cond do
        is_map(first) -> get(get(first, "arguments") || %{}, "action")
        true -> nil
      end

    decision =
      cond do
        surface == "plan" and Enum.any?(tool_events, &(&1["name"] == "agent_plan_draft")) ->
          "plan_draft"

        is_binary(first_action) ->
          first_action

        true ->
          classify_from_events(tool_events, get(evidence, "turn_result"))
      end

    %{
      "judgment_action" => decision,
      "decision_detail" =>
        if(is_binary(first_action), do: "judgment_decision", else: "derived_from_tools"),
      "tool_calls" => Enum.map(tool_events, &Map.drop(&1, ["call_index"])),
      "tool_names" =>
        tool_events |> Enum.map(& &1["name"]) |> Enum.reject(&is_nil/1) |> Enum.uniq(),
      "judgment_decisions" =>
        Enum.map(judgment_decisions, fn event ->
          arguments = get(event, "arguments") || %{}

          %{
            "call_index" => get(event, "call_index"),
            "round" => get(event, "round"),
            "action" => get(arguments, "action"),
            "dialogue_goal" => get(arguments, "dialogue_goal"),
            "reason" => get(arguments, "reason"),
            "explore_request" => get(arguments, "explore_request"),
            "capability" => get(arguments, "capability")
          }
        end),
      "final_text" => get(get(evidence, "turn_result") || %{}, "text"),
      "judgment_settled" => settled_from_rounds(evidence),
      "response_kind" => "production_loop",
      "rubric_note" => "runner 映射只作判卷输入；semantic_success 必须由评分器读取人工判定后聚合"
    }
  end

  defp classify_from_events(tool_events, turn_result) do
    names = Enum.map(tool_events, & &1["name"])

    cond do
      "register_author_content" in names ->
        "register_author_content"

      "propose_creative_directions" in names ->
        "creative_directions"

      "report_capability_gap" in names ->
        "capability_gap"

      "agent_plan_draft" in names ->
        "plan_draft"

      "ask_author" in names ->
        "ask_author"

      is_binary(get(turn_result || %{}, "text")) and get(turn_result || %{}, "text") != "" ->
        "reply"

      true ->
        "empty_response"
    end
  end

  # 将每个 provider wire 响应里的 tool_calls 摊平为带轮次序号的判定事件。
  defp integrated_tool_events(evidence) do
    rounds = get(evidence, "rounds") || []

    rounds
    |> Enum.flat_map(fn round ->
      sequence = get(round, "sequence")
      calls = get(round, "calls") || []

      Enum.with_index(calls, 1)
      |> Enum.flat_map(fn {call, call_index} ->
        result = get(call, "wire_result") || %{}
        tool_calls = get(result, "tool_calls") || []

        Enum.map(tool_calls, fn tool_call ->
          %{
            "name" => get(tool_call, "name") || get(tool_call, "function.name"),
            "arguments" =>
              get(tool_call, "arguments") || get(tool_call, "function.arguments") || %{},
            "call_index" => call_index,
            "round" => sequence
          }
        end)
      end)
    end)
  end

  defp settled_from_rounds(evidence) do
    evidence
    |> get("rounds")
    |> List.wrap()
    |> Enum.map(fn round -> get(get(round, "outcome") || %{}, "judgment_settled") end)
    |> Enum.reject(&is_nil/1)
    |> List.last()
  end

  defp allowed_path_doc(case_id, outcome, wire_calls, surface) do
    paths = Map.get(@paths, case_id, %{allowed: [], conditional: []})
    classification = classify_outcome(outcome, wire_calls, surface)
    decision = classification["decision"]

    %{
      "hit" => decision in Enum.map(paths.allowed, &to_string/1),
      "allowed" => Enum.map(paths.allowed, &to_string/1),
      "conditional" => Enum.map(paths.conditional, &to_string/1),
      "observed_decision" => decision
    }
  end

  defp integrated_allowed_path_doc(case_id, evidence, _wire_calls, surface) do
    paths = Map.get(@paths, case_id, %{allowed: [], conditional: []})
    tool_events = integrated_tool_events(evidence)
    judgment_decisions = Enum.filter(tool_events, &(&1["name"] == "judgment_decision"))
    first = List.first(judgment_decisions)

    first_action =
      if is_map(first), do: get(get(first, "arguments") || %{}, "action"), else: nil

    decision =
      cond do
        surface == "plan" and Enum.any?(tool_events, &(&1["name"] == "agent_plan_draft")) ->
          "plan_draft"

        is_binary(first_action) ->
          first_action

        true ->
          classify_from_events(tool_events, get(evidence, "turn_result"))
      end

    %{
      "hit" => decision in Enum.map(paths.allowed, &to_string/1),
      "allowed" => Enum.map(paths.allowed, &to_string/1),
      "conditional" => Enum.map(paths.conditional, &to_string/1),
      "observed_decision" => decision,
      "note" => "首轮判断路径命中；完整 §6.1 语义通过仍由 rubric 判卷决定"
    }
  end

  defp zero_tolerance_candidates(case_id, outcome, _wire_calls, _surface) do
    decision = classify_outcome(outcome, [], nil)["decision"]

    [
      decision == "register_author_content" and case_id not in ["M11", "M12"] and
        "author_content_registration_without_request",
      decision == "creative_directions" and case_id != "M09" and
        "creative_directions_without_request",
      decision == "capability_gap" and case_id != "M14" and
        "capability_gap_without_matching_gap_case",
      decision == "execute" and case_id not in @execute_cases and
        "execute_without_matching_case_path"
    ]
    |> Enum.filter(& &1)
  end

  defp integrated_zero_tolerance_candidates(case_id, evidence, _wire_calls) do
    tool_events = integrated_tool_events(evidence)
    names = Enum.map(tool_events, & &1["name"])
    decisions = Enum.filter(tool_events, &(&1["name"] == "judgment_decision"))
    actions = Enum.map(decisions, fn d -> get(get(d, "arguments") || %{}, "action") end)

    [
      "register_author_content" in names and case_id not in ["M11", "M12"] and
        "author_content_registration_without_request",
      "propose_creative_directions" in names and case_id != "M09" and
        "creative_directions_without_request",
      "report_capability_gap" in names and case_id != "M14" and
        "capability_gap_without_matching_gap_case",
      "execute" in actions and case_id not in @execute_cases and
        "execute_without_matching_case_path",
      "agent_plan_draft" in names and "judgment_decision" not in names and
        "plan_draft_without_judgment_plan_decision"
    ]
    |> Enum.filter(& &1)
  end

  defp unnecessary_question_candidate(_case_id, spec, outcome, _wire_calls) do
    counted = truthy(get(spec, "unnecessary_question_counted"))

    counted and classify_outcome(outcome, [], nil)["decision"] == "ask_author"
  end

  defp integrated_unnecessary_question_candidate(_case_id, spec, evidence) do
    counted = truthy(get(spec, "unnecessary_question_counted"))
    names = evidence |> integrated_tool_events() |> Enum.map(& &1["name"])

    counted and "ask_author" in names
  end

  defp spec_flags(spec) do
    %{
      "key_case" => get(spec, "key_case") == true,
      "retention" => get(spec, "retention") == true,
      "unnecessary_question_counted" => get(spec, "unnecessary_question_counted") == true,
      "zero_tolerance_applies" => get(spec, "zero_tolerance_applies") || [],
      "snapshot" => get(spec, "snapshot")
    }
  end

  defp blocked_episode(case_id, arm, run_index, opts, reason, started) do
    %{
      "schema" => "b27-semantic-episode-v1",
      "generated_at" => now_iso(),
      "case_id" => case_id,
      "arm" => arm,
      "run_index" => run_index,
      "provider" => to_string(opts.provider_cfg.provider),
      "requested_model" => opts.effective_model,
      "status" => "blocked",
      "availability" => "unavailable",
      "error_class" => "blocked",
      "blocked_reason" => inspect(reason),
      "elapsed_ms" => System.monotonic_time(:millisecond) - started,
      "response" => nil,
      "mapping" => nil,
      "method" => method_doc(opts)
    }
  end

  defp error_episode(case_id, arm, run_index, opts, error, started, extra \\ []) do
    error = if is_map(error), do: error, else: %{class: :unknown, message: inspect(error)}
    failure = classify_episode_failure(error)

    %{
      "schema" => "b27-semantic-episode-v1",
      "generated_at" => now_iso(),
      "case_id" => case_id,
      "arm" => arm,
      "run_index" => run_index,
      "provider" => to_string(opts.provider_cfg.provider),
      "requested_model" => opts.effective_model,
      "status" => failure.status,
      "availability" => failure.availability,
      "error_class" => failure.error_class,
      "error" => %{
        "class" => to_string(get(error, :class) || :unknown),
        "message" => get(error, :message) || inspect(error),
        "rounds" => get(error, :rounds),
        "round" => get(error, :round)
      },
      "elapsed_ms" => System.monotonic_time(:millisecond) - started,
      "response" => nil,
      "mapping" => nil,
      "method" => method_doc(opts)
    }
    |> Map.merge(
      Map.new(
        Keyword.take(extra, [
          :partial_provider_calls,
          :app_side_evidence,
          :materials_model_visible,
          :seeded_candidates,
          :content_anomaly,
          :exploration_coverage
        ])
      )
    )
  end

  # ── 分类与判定辅助（非最终判分）────────────────────────────────────────

  defp classify_outcome({:ok, %NovelAgent.Provider.Result{} = result}, _wire_calls, surface) do
    classify_tool_calls(jsonable(result.tool_calls || []), result.content, surface)
  end

  defp classify_outcome({:ok, _other}, wire_calls, surface) do
    last = List.last(wire_calls) || %{}
    result = get(last, "wire_result") || %{}
    classify_tool_calls(get(result, "tool_calls") || [], get(result, "content"), surface)
  end

  defp classify_outcome({:error, _}, _wire_calls, _surface) do
    %{"decision" => "error", "detail" => "provider_error", "tool_calls" => []}
  end

  defp classify_outcome(other, _wire_calls, _surface) do
    %{"decision" => "unknown", "detail" => inspect(other), "tool_calls" => []}
  end

  defp classify_tool_calls([], content, _surface) do
    if chars(content) > 0 do
      %{"decision" => "reply", "detail" => "no_tool_plain_text", "tool_calls" => []}
    else
      %{"decision" => "empty_response", "detail" => "no_tool_empty_content", "tool_calls" => []}
    end
  end

  defp classify_tool_calls([call], content, "plan") do
    name = get(call, "name")

    if name == "agent_plan_draft" do
      %{"decision" => "plan_draft", "detail" => "agent_plan_draft", "tool_calls" => [call]}
    else
      classify_tool_calls([call], content, "judgment")
    end
  end

  defp classify_tool_calls([call], _content, _surface) do
    name = get(call, "name")
    args = get(call, "arguments") || %{}

    decision =
      case name do
        "judgment_decision" -> get(args, "action")
        "continuation_decision" -> "continue"
        "ask_author" -> "ask_author"
        "register_author_content" -> "register_author_content"
        "propose_creative_directions" -> "creative_directions"
        "report_capability_gap" -> "capability_gap"
        "agent_plan_draft" -> "plan_draft"
        other -> other || "other_tool"
      end

    %{"decision" => decision, "detail" => name, "tool_calls" => [call]}
  end

  defp classify_tool_calls(calls, _content, _surface) do
    names = calls |> Enum.map(&get(&1, "name")) |> Enum.reject(&is_nil/1) |> Enum.sort()

    cond do
      "judgment_decision" in names and "agent_plan_draft" in names ->
        decision = Enum.find(calls, &(get(&1, "name") == "judgment_decision"))
        args = get(decision, "arguments") || %{}

        if get(args, "action") == "plan" do
          %{
            "decision" => "plan",
            "detail" => "judgment_decision.plan + agent_plan_draft",
            "tool_calls" => calls
          }
        else
          %{
            "decision" => "invalid_combination",
            "detail" => "two tools with non-plan action",
            "tool_calls" => calls
          }
        end

      true ->
        %{
          "decision" => "invalid_combination",
          "detail" => Enum.join(names, "+"),
          "tool_calls" => calls
        }
    end
  end

  defp contract_validation({:ok, %NovelAgent.Provider.Result{} = result}) do
    case JudgmentToolContract.validate(result.tool_calls || [], :judgment) do
      :ok -> %{"ok" => true, "error" => nil}
      {:error, reason} -> %{"ok" => false, "error" => inspect(reason)}
    end
  end

  defp contract_validation({:ok, _}), do: %{"ok" => nil, "error" => "non_result_outcome"}
  defp contract_validation({:error, error}), do: %{"ok" => false, "error" => inspect(error)}
  defp contract_validation(_), do: %{"ok" => nil, "error" => "no_outcome"}

  defp final_text({:ok, %NovelAgent.Provider.Result{} = result}, wire_calls) do
    cond do
      chars(result.content) > 0 -> result.content
      true -> last_wire_content(wire_calls)
    end
  end

  defp final_text(_, wire_calls), do: last_wire_content(wire_calls)

  defp last_wire_content(wire_calls) do
    wire_calls
    |> List.wrap()
    |> Enum.map(fn call -> get(get(call, "wire_result") || %{}, "content") end)
    |> Enum.reject(&(is_nil(&1) or &1 == ""))
    |> List.last()
  end

  # §6.1 的「不可用」= provider/模型不可用（超时/连接/鉴权/模型缺失/格式终局失败）。
  # 生产执行失败（如 pending_artifact_execution_failed / 工具执行失败）是 episode 内业务失败：
  # 计未成功，但**不是** unavailable，不能混入 ≤2/40 的不可用门槛。
  defp classify_episode_failure(error) do
    message =
      (get(error, :message) || get(error, "message") || inspect(error))
      |> to_string()
      |> String.downcase()

    cond do
      String.contains?(message, "pending_artifact_execution_failed") or
        String.contains?(message, "tool_execution_failed") or
          String.contains?(message, "tool_execution_error") ->
        %{
          status: "execution_error",
          availability: "available",
          error_class: "tool_execution_failure"
        }

      String.contains?(message, "episode_timeout") or String.contains?(message, "wall clock >") ->
        %{status: "provider_error", availability: "unavailable", error_class: "timeout"}

      String.contains?(message, "invalid_tool_combination") or
        String.contains?(message, "invalid_tool_arguments") or
        String.contains?(message, "judgment_protocol_violation") or
        String.contains?(message, "agent_plan_protocol_violation") or
          String.contains?(message, "incompatible_operation_fields") ->
        %{
          status: "provider_error",
          availability: "unavailable",
          error_class: "format_terminal_failure"
        }

      true ->
        %{
          status: "provider_error",
          availability: "unavailable",
          error_class: error_class({:error, error})
        }
    end
  end

  # 模型实际可见材料（从真实 wire prompt + 探索观察中抽取的事实），用于区分“模型没用材料”与“材料没给模型”。
  # 模型实际可见材料（从真实 wire prompt + 探索观察中抽取的事实），用于区分“模型没用材料”与“材料没给模型”。
  defp prompt_visible_materials(materials, wire_calls, evidence) do
    base = materials || %{}

    prompts =
      wire_calls
      |> List.wrap()
      |> Enum.map(fn call ->
        request = Map.get(call || %{}, "wire_request") || %{}
        messages = Map.get(request, "messages") || []
        Enum.map_join(messages, "\n", &(get(&1, "content") || ""))
      end)

    prompt_text = Enum.join(prompts, "\n---\n")

    json_previews =
      Regex.scan(~r/"body_preview"\s*:\s*"([^"]*)"/, prompt_text)
      |> Enum.map(fn [_, value] -> value end)

    rendered_previews =
      Regex.scan(~r/body_preview=([^\n]*)/, prompt_text)
      |> Enum.map(fn [_, value] -> String.trim(value) end)

    previews = json_previews ++ rendered_previews
    seeded_candidates = get(evidence, "seeded_candidates") || []

    seeded_in_prompt =
      seeded_candidates
      |> Enum.map(fn candidate ->
        body = get(candidate, "body") || ""

        head =
          body
          |> String.trim()
          |> String.slice(0, 40)

        %{
          "artifact_id" => get(candidate, "artifact_id"),
          "body_sha256" => get(candidate, "body_sha256"),
          "body_chars" => get(candidate, "body_chars"),
          "appears_in_prompt" => head != "" and String.contains?(prompt_text, head)
        }
      end)

    Map.merge(base, %{
      "prompt_evidence" => %{
        "prompt_chars" => String.length(prompt_text),
        "prompt_sha256" => sha256(prompt_text),
        "body_preview_total" => length(previews),
        "body_preview_empty" => Enum.count(previews, &(&1 in ["", "（空）", "（未提供）", "null"])),
        "body_preview_nonempty" =>
          Enum.count(previews, &(&1 not in ["", "（空）", "（未提供）", "null"])),
        "artifact_refs_in_prompt" =>
          Regex.scan(~r/(?:"artifact_ref"\s*:\s*"|ref=)([^"\s|]+)/, prompt_text)
          |> Enum.map(fn [_, ref] -> ref end)
          |> Enum.uniq(),
        "mentions_superseded" => String.contains?(String.upcase(prompt_text), "SUPERSEDED"),
        "mentions_edited_accepted" => String.contains?(prompt_text, "EDITED_ACCEPTED"),
        "seeded_candidates_in_prompt" => seeded_in_prompt,
        "observation_count" => length(observations_of(evidence)),
        "observed_prose_ranges" =>
          observations_of(evidence)
          |> Enum.map(fn o -> get(o, "prose_range") end)
          |> Enum.reject(&is_nil/1),
        "observed_summary_chars" =>
          observations_of(evidence)
          |> Enum.map(fn o -> chars(get(o, "summary")) end)
          |> Enum.sum()
      }
    })
  end

  defp observations_of(evidence) do
    (get(evidence, "rounds") || [])
    |> Enum.flat_map(fn round ->
      get(get(round, "outcome") || %{}, "judgment_explorations") || []
    end)
  end

  # 探索覆盖证据（retest3 M03）：从实际探索观察（judgment_explorations）计算
  # 已读字符/总字符/末页是否覆盖/next_offset，供 judge 判定“未读末页却声称全章”。
  defp exploration_coverage(evidence) do
    # 各轮 outcome 的 judgment_explorations 是**累积**历史快照（第 N 轮含前 N-1 轮观察），
    # 因此取最后一个非空快照做覆盖计算，避免把历史重复计数。
    observations = latest_explorations(evidence)

    ranges =
      observations
      |> Enum.map(fn o -> get(o, "prose_range") || get(o, :prose_range) end)
      |> Enum.filter(&is_map/1)
      |> Enum.map(fn r ->
        %{"start" => get(r, :start) || get(r, "start"), "end" => get(r, :end) || get(r, "end")}
      end)

    ends = ranges |> Enum.map(fn r -> get(r, "end") end) |> Enum.filter(&is_integer/1)
    covered = if ends == [], do: 0, else: Enum.max(ends)
    total = total_chars_from_observations(observations)

    next_offsets =
      observations
      |> Enum.map(fn o -> get(o, "next_offset") || get(o, :next_offset) end)
      |> Enum.reject(&is_nil/1)

    summaries =
      observations
      |> Enum.map(fn o -> get(o, "summary") || get(o, :summary) end)
      |> Enum.filter(&is_binary/1)
      |> Enum.map(&String.slice(&1, 0, 240))

    %{
      "observation_count" => length(observations),
      "tools" =>
        observations
        |> Enum.map(fn o -> get(o, "tool") || get(o, :tool) || get(o, "name") end)
        |> Enum.reject(&is_nil/1)
        |> Enum.uniq(),
      "prose_ranges" => ranges,
      "covered_chars" => covered,
      "total_chars" => total,
      "uncovered_chars" => if(is_integer(total), do: max(total - covered, 0), else: nil),
      "last_page_covered" => if(is_integer(total), do: covered >= total, else: nil),
      "next_offset" => List.last(next_offsets),
      "observation_summaries" => summaries,
      "note" =>
        "covered_chars=实际探索观察 prose_range 的最大 end；total_chars=观察 summary 中“共 N 字符”；" <>
          "last_page_covered=covered>=total；next_offset=最后一次观察的续读游标。"
    }
  end

  defp latest_explorations(evidence) do
    (get(evidence, "rounds") || [])
    |> Enum.map(fn round ->
      get(get(round, "outcome") || %{}, "judgment_explorations") ||
        get(get(round, "outcome") || %{}, :judgment_explorations) || []
    end)
    |> Enum.reject(&(&1 == []))
    |> List.last()
    |> List.wrap()
  end

  defp total_chars_from_observations(observations) do
    observations
    |> Enum.map(fn o ->
      summary = get(o, "summary") || get(o, :summary) || ""

      case Regex.run(~r/共\s*(\d+)\s*字符/, summary) do
        [_, n] -> String.to_integer(n)
        _ -> nil
      end
    end)
    |> Enum.reject(&is_nil/1)
    |> case do
      [] -> nil
      values -> Enum.max(values)
    end
  end

  # 证据保真：记录 provider 返回内容异常（占位符/无作者可见文本），不替换/不改写原文。
  defp content_anomaly(evidence) do
    turn_result = get(evidence, "turn_result") || %{}
    text = get(turn_result, "text")

    cond do
      is_binary(text) and String.contains?(text, "[assistant reasoning omitted]") ->
        %{
          "type" => "provider_placeholder",
          "placeholder" => "[assistant reasoning omitted]",
          "source" => "provider_response_content",
          "note" => "provider 返回内容即字面占位符；runner 原样记录（未替换、未截断）。这不是 runner 编造的 final_text。"
        }

      (is_nil(text) or text == "") and get(evidence, "end_reason") == "complete" ->
        %{
          "type" => "no_author_visible_final_text",
          "note" => "episode completed 但没有作者可见 reply 文本（可能只有工具/计划步骤）；runner 如实记录空值。"
        }

      true ->
        nil
    end
  end

  defp error_class({:ok, _}), do: nil

  defp error_class({:error, error}) do
    message =
      (get(error, :message) || get(error, "message") || inspect(error))
      |> to_string()
      |> String.downcase()

    cond do
      String.contains?(message, ["timeout", "timed out", "超时", "没有返回", "生成超过", "time out"]) ->
        "timeout"

      String.contains?(message, [
        "econnrefused",
        "connection refused",
        "connect",
        "无法连接",
        "未启动",
        "econnreset"
      ]) ->
        "connection"

      String.contains?(message, [
        "model not found",
        "choose a loaded model",
        "no models loaded",
        "model_not_found"
      ]) ->
        "provider_model_unavailable"

      String.contains?(message, [
        "unauthorized",
        "401",
        "403",
        "api key",
        "auth_required",
        "authentication failed"
      ]) ->
        "provider_auth"

      String.contains?(message, ["format", "json", "tool_call", "protocol", "invalid_response"]) ->
        "format_terminal_failure"

      true ->
        "provider_error"
    end
  end

  defp error_class(_), do: "runner_exception"

  defp finish_reason(result) do
    get(result, "http_status") || get(result, "kind")
  end

  defp actual_model(wire_calls, outcome) do
    usage_model =
      wire_calls
      |> List.wrap()
      |> Enum.map(fn call -> get(get(call, "wire_result") || %{}, "usage") end)
      |> Enum.map(fn usage -> get(usage || %{}, "model") end)
      |> Enum.reject(&is_nil/1)
      |> List.last()

    cond do
      is_binary(usage_model) ->
        usage_model

      match?({:ok, %NovelAgent.Provider.Result{}}, outcome) ->
        {:ok, %NovelAgent.Provider.Result{usage: usage}} = outcome
        usage_model_from(usage)

      true ->
        nil
    end
  end

  defp usage_model_from(usage) when is_map(usage) do
    get(usage, :model) || get(usage, "model")
  end

  defp usage_model_from(_), do: nil

  defp aggregate_usage(wire_calls) do
    usages =
      wire_calls
      |> List.wrap()
      |> Enum.map(fn call -> get(get(call, "wire_result") || %{}, "usage") end)
      |> Enum.filter(&is_map/1)

    totals =
      Enum.reduce(
        usages,
        %{"input_tokens" => 0, "output_tokens" => 0, "cached_tokens" => 0},
        fn usage, acc ->
          %{
            "input_tokens" => acc["input_tokens"] + (get(usage, "input_tokens") || 0),
            "output_tokens" => acc["output_tokens"] + (get(usage, "output_tokens") || 0),
            "cached_tokens" => acc["cached_tokens"] + (get(usage, "cached_tokens") || 0)
          }
        end
      )

    totals
    |> Map.put("provider_calls", length(wire_calls))
    |> Map.put("per_call", usages)
  end

  defp wire_call_doc(call) do
    request = get(call, "wire_request") || %{}
    result = get(call, "wire_result") || %{}
    messages = get(request, "messages") || []

    %{
      "provider" => get(call, "provider"),
      "url" => get(call, "url"),
      "started_at_monotonic_ms" => get(call, "started_at_monotonic_ms"),
      "finished_at_monotonic_ms" => get(call, "finished_at_monotonic_ms"),
      "latency_ms" =>
        cond do
          is_integer(get(call, "finished_at_monotonic_ms")) and
              is_integer(get(call, "started_at_monotonic_ms")) ->
            get(call, "finished_at_monotonic_ms") - get(call, "started_at_monotonic_ms")

          true ->
            nil
        end,
      "request" => %{
        "body_sha256" => sha256(canonical_json(request)),
        "messages_sha256" => sha256(canonical_json(messages)),
        "message_count" => length(messages),
        "prompt_chars" => prompt_chars_from_messages(messages),
        "tool_names" => request_tool_names(request),
        "tool_choice" => get(request, "tool_choice"),
        "temperature" => get(request, "temperature"),
        "max_tokens" => get(request, "max_tokens"),
        "messages" => messages
      },
      "response" => %{
        "kind" => get(result, "kind"),
        "http_status" => get(result, "http_status"),
        "content" => get(result, "content"),
        "content_chars" => get(result, "content_chars"),
        "tool_calls" => get(result, "tool_calls") || [],
        "usage" => get(result, "usage"),
        "adapter_duration_ms" => get(result, "adapter_duration_ms"),
        "resp_body" => get(result, "resp_body"),
        "error" => get(result, "error")
      }
    }
  end

  defp request_tool_names(request) do
    request
    |> get("tools")
    |> List.wrap()
    |> Enum.map(fn tool ->
      get(tool, "function.name") || get(get(tool, "function") || %{}, "name") || get(tool, "name")
    end)
    |> Enum.reject(&is_nil/1)
  end

  defp wire_messages_match?([], _request), do: nil

  defp wire_messages_match?(wire_calls, request) do
    # 快照 messages 保留 CP0 捕获时的 `bytes` 统计字段；wire messages 只有 role/content。
    # 语义比对只取 role/content 字节（这是回放忠实性的判定口径）。
    expected = request |> get("messages") |> List.wrap() |> Enum.map(&message_text/1)

    actual =
      wire_calls
      |> List.first()
      |> get("wire_request")
      |> then(fn body -> get(body || %{}, "messages") end)

    is_list(actual) and
      canonical_json(Enum.map(actual, &message_text/1)) == canonical_json(expected)
  end

  defp message_text(message) do
    %{"role" => get(message, "role"), "content" => get(message, "content")}
  end

  defp first_request_sha(wire_calls) do
    wire_calls
    |> List.wrap()
    |> List.first()
    |> then(fn call ->
      body = get(call || %{}, "wire_request")
      if is_map(body), do: sha256(canonical_json(body)), else: nil
    end)
  end

  defp snapshot_filename(case_id, surface) do
    cond do
      surface == "plan" or case_id == "SP01" -> "SP01-plan.json"
      true -> "#{case_id}.json"
    end
  end

  # ── 快照加载/完整性 ─────────────────────────────────────────────────────

  defp load_snapshot(case_id, surface) do
    path = Path.join(@snapshots_dir, snapshot_filename(case_id, surface))

    cond do
      not File.exists?(path) ->
        {:error, {:snapshot_missing, path}}

      true ->
        doc = path |> File.read!() |> Jason.decode!()
        {:ok, Map.put(doc, "_path", path)}
    end
  end

  defp select_request(snap, surface) do
    cond do
      surface == "plan" and is_map(get(snap, "requests")) ->
        get(get(snap, "requests"), "plan_draft")

      is_map(get(snap, "request")) ->
        get(snap, "request")

      is_map(get(snap, "requests")) ->
        get(get(snap, "requests"), "judgment") || get(get(snap, "requests"), "plan_draft")

      true ->
        nil
    end
  end

  defp integrity(snap) do
    {request, expected_hash} =
      cond do
        is_map(get(snap, "request")) ->
          {get(snap, "request"), get(get(snap, "hashes") || %{}, "request_sha256")}

        is_map(get(snap, "requests")) ->
          request =
            get(get(snap, "requests"), "plan_draft") || get(get(snap, "requests"), "judgment")

          {request, get(get(snap, "hashes") || %{}, "plan_request_sha256")}

        true ->
          {nil, nil}
      end

    actual = if request, do: sha256(canonical_json(request)), else: nil

    %{
      "snapshot_path" => get(snap, "_path"),
      "frozen_request_sha256" => expected_hash,
      "actual_request_sha256" => actual,
      "verified" => is_binary(expected_hash) and actual == expected_hash,
      "case_id" => get(snap, "case_id") || get(snap, "probe_id"),
      "arm_slot" => get(get(snap, "arm") || %{}, "slot"),
      "call_surface" => get(snap, "call_surface")
    }
  end

  # 冻结快照 → 可回放 prompt：
  # messages[0] 是 CP0 冻结的 L0 身份消息（重建 metadata 让 Gateway 幂等识别、不重复注入），
  # 其余消息按冻结内容逐字回放；tools/tool_choice 原样。
  defp build_prompt(nil), do: %{messages: [], tools: [], tool_choice: "auto"}

  defp build_prompt(request) do
    messages = get(request, "messages") || []
    identity_meta = get(request, "system_identity") || %{}
    {first, rest} = List.pop_at(messages, 0)

    restored =
      case first do
        %{"role" => "system"} ->
          [
            %{
              role: "system",
              content: get(first, "content"),
              metadata: %{
                system_identity: %{
                  version:
                    get(identity_meta, "version") || NovelAgent.Provider.SystemIdentity.version(),
                  content_hash:
                    get(identity_meta, "content_hash") ||
                      NovelAgent.Provider.SystemIdentity.content_hash()
                }
              }
            }
            | Enum.map(rest, fn m -> %{role: get(m, "role"), content: get(m, "content")} end)
          ]

        _ ->
          Enum.map(messages, fn m -> %{role: get(m, "role"), content: get(m, "content")} end)
      end

    %{
      messages: restored,
      tools: get(request, "tools") || [],
      tool_choice: get(request, "tool_choice") || "auto"
    }
  end

  defp prompt_chars(prompt) do
    prompt
    |> get(:messages)
    |> List.wrap()
    |> Enum.map(fn m -> chars(get(m, :content)) end)
    |> Enum.sum()
  end

  defp prompt_chars_from_messages(messages) do
    messages
    |> List.wrap()
    |> Enum.map(fn m -> chars(get(m, "content") || get(m, :content)) end)
    |> Enum.sum()
  end

  # ── provider 配置 / 探活 ────────────────────────────────────────────────

  defp configure_provider(opts) do
    case opts.provider_cfg.provider do
      :stub ->
        :ok

      :lmstudio ->
        existing = Application.get_env(:novel_agent, NovelAgent.Provider.LMStudio, [])

        existing =
          existing
          |> Keyword.put(:model, opts.effective_model)
          |> Keyword.put(:timeout, max(opts.timeout_ms, 300_000))
          |> Keyword.put_new(:max_tokens, 32_000)

        Application.put_env(:novel_agent, NovelAgent.Provider.LMStudio, existing)
        put_default_provider(:lmstudio)
        :ok

      :strata ->
        existing = Application.get_env(:novel_agent, NovelAgent.Provider.Strata, [])

        Application.put_env(
          :novel_agent,
          NovelAgent.Provider.Strata,
          existing
          |> Keyword.put(:model, opts.effective_model)
          |> Keyword.put(
            :endpoint,
            System.get_env("NOVEL_STRATA_ENDPOINT", "http://127.0.0.1:47831/v1")
          )
          |> Keyword.put_new(:max_tokens, 32_000)
        )

        put_default_provider(:strata)
        :ok

      :deepseek ->
        existing = Application.get_env(:novel_agent, NovelAgent.Provider.DeepSeek, [])

        Application.put_env(
          :novel_agent,
          NovelAgent.Provider.DeepSeek,
          Keyword.put(existing, :model, opts.effective_model)
        )

        put_default_provider(:deepseek)
        :ok
    end
  end

  defp put_default_provider(provider) do
    existing = Application.get_env(:novel_agent, :provider, [])
    Application.put_env(:novel_agent, :provider, Keyword.put(existing || [], :default, provider))
  end

  defp preview_provider!(opts) do
    if opts.provider == "stub" or opts.skip_health_check do
      if opts.skip_health_check and opts.provider != "stub" do
        IO.puts("[b27-eval] WARN 跳过 provider 探活（--skip-health-check）：失败必须如实记录")
      end

      :ok
    else
      probe_provider!(opts)
    end
  end

  defp probe_provider!(opts) do
    url = opts.provider_cfg[:health_url]

    case http_get_models(url) do
      {:ok, ids, aliases} ->
        requested = opts.effective_model

        found =
          requested in ids or requested in aliases or
            model_loose_match?(requested, ids ++ aliases)

        if found do
          IO.puts("[b27-eval] provider #{opts.provider} alive；请求模型 #{requested} 在 /models 中")
          :ok
        else
          IO.puts("""
          [b27-eval] BLOCKED: provider #{opts.provider} 可用，但请求模型不可用。
            endpoint: #{url}
            requested: #{requested}
            available: #{Enum.join(Enum.take(ids ++ aliases, 12), ", ")}
          不伪造模型可用；请调整 --model 或加载模型后重跑。
          """)

          System.halt(3)
        end

      {:error, reason} ->
        IO.puts("""
        [b27-eval] BLOCKED: provider #{opts.provider} 探活失败（#{inspect(reason)}）。
          endpoint: #{url}
          真实调用会失败，按 blocked 记录；不伪造可用。
        """)

        System.halt(3)
    end
  end

  defp http_get_models(url) do
    case Req.get(url, receive_timeout: 10_000, retry: false) do
      {:ok, %Req.Response{status: 200, body: body}} when is_map(body) ->
        data = get(body, "data") || []

        ids =
          data
          |> Enum.map(fn item -> get(item, "id") end)
          |> Enum.reject(&is_nil/1)

        aliases =
          data
          |> Enum.flat_map(fn item ->
            meta = get(item, "meta") || %{}
            List.wrap(get(meta, "aliases"))
          end)

        {:ok, ids, aliases}

      {:ok, %Req.Response{status: status}} ->
        {:error, {:http_status, status}}

      {:error, reason} ->
        {:error, reason}
    end
  rescue
    error -> {:error, Exception.message(error)}
  end

  defp model_loose_match?(requested, available) do
    requested = to_string(requested)

    Enum.any?(available, fn id ->
      id = to_string(id)

      id == requested or String.ends_with?(id, "/" <> requested) or
        String.ends_with?(requested, "/" <> id)
    end)
  end

  defp deepseek_credential? do
    key =
      System.get_env("DEEPSEEK_API_KEY") || System.get_env("NOVEL_DEEPSEEK_API_KEY") ||
        Application.get_env(:novel_agent, NovelAgent.Provider.DeepSeek, [])[:api_key]

    is_binary(key) and String.trim(key) != ""
  end

  # ── 输出 ────────────────────────────────────────────────────────────────

  defp episode_path(opts, case_id, arm, run_index) do
    Path.join([
      opts.out,
      "episodes",
      "#{case_id}-#{arm}-#{opts.provider}-run#{run_index}.json"
    ])
  end

  defp summarize(episodes, opts) do
    statuses = Enum.frequencies_by(episodes, & &1["status"])

    decisions =
      episodes
      |> Enum.map(fn e -> get(get(e, "mapping") || %{}, "judgment_action") end)
      |> Enum.frequencies()

    %{
      "schema" => "b27-semantic-eval-summary-v1",
      "generated_at" => now_iso(),
      "arm" => opts.arm,
      "provider" => opts.provider,
      "requested_model" => opts.effective_model,
      "runs" => opts.runs,
      "case_count" => episodes |> Enum.map(& &1["case_id"]) |> Enum.uniq() |> length(),
      "episode_count" => length(episodes),
      "status_counts" => statuses,
      "decision_counts" => decisions,
      "semantic_evidence" => opts.provider != "stub",
      "note" => "episode 证据批次摘要，不是 §6.1 判分；逐例 rubric 判定由 b27_semantic_score.exs 生成模板后填写再聚合。",
      "results" =>
        Enum.map(episodes, fn e ->
          %{
            "case_id" => e["case_id"],
            "arm" => e["arm"],
            "run_index" => e["run_index"],
            "status" => e["status"],
            "judgment_action" => get(get(e, "mapping") || %{}, "judgment_action"),
            "allowed_path_hit" => get(get(e, "allowed_path") || %{}, "hit"),
            "error_class" => e["error_class"],
            "elapsed_ms" => e["elapsed_ms"],
            "episode_path" => e["episode_path"]
          }
        end)
    }
  end

  defp print_episode(doc) do
    mapping = get(doc, "mapping") || %{}
    allowed = get(doc, "allowed_path") || %{}

    IO.puts(
      "[b27-eval] #{doc["case_id"]} arm=#{doc["arm"]} run#{doc["run_index"]}: status=#{doc["status"]} " <>
        "decision=#{inspect(get(mapping, "judgment_action"))} allowed_path=#{inspect(get(allowed, "hit"))} " <>
        "calls=#{doc["provider_call_count"]} elapsed=#{doc["elapsed_ms"]}ms error=#{inspect(doc["error_class"])}"
    )
  end

  defp print_summary(summary) do
    IO.puts(
      "[b27-eval] arm=#{summary["arm"]} provider=#{summary["provider"]} model=#{summary["requested_model"]} runs=#{summary["runs"]}"
    )

    IO.puts(
      "[b27-eval] episodes=#{summary["episode_count"]} statuses=#{inspect(summary["status_counts"])}"
    )

    IO.puts("[b27-eval] decisions=#{inspect(summary["decision_counts"])}")
    IO.puts("[b27-eval] summary: #{rel(Path.join([@default_out, "summaries"]))}/summary-*.json")
  end

  # ── 运行 manifest（环境与输入 hash；不是判分证据）────────────────────────

  defp run_manifest(opts) do
    %{
      "schema" => "b27-cp4-run-manifest-v1",
      "started_at" => now_iso(),
      "command" =>
        "mix run scripts/model_contracts/b27_semantic_eval.exs " <> Enum.join(opts.raw_argv, " "),
      "arm" => opts.arm,
      "provider" => opts.provider,
      "requested_model" => opts.effective_model,
      "runs" => opts.runs,
      "cases" => if(opts.cases == :all, do: "all-20", else: opts.cases),
      "surface" => opts.surface || "judgment",
      "environment" => environment_facts(),
      "fixtures" => fixture_facts(),
      "workspace_arm" => workspace_arm_check(),
      "db" => %{
        "mix_env" => "test",
        "isolated_marker" => @db_marker,
        "database" => db_dir()
      }
    }
  end

  defp write_manifest(opts, start_manifest, episodes, state) do
    manifest =
      start_manifest
      |> Map.put("finished_at", now_iso())
      |> Map.put("state", to_string(state))
      |> Map.put(
        "episodes",
        Enum.map(episodes, fn e ->
          %{
            "case_id" => e["case_id"],
            "arm" => e["arm"],
            "run_index" => e["run_index"],
            "status" => e["status"],
            "error_class" => e["error_class"],
            "episode_path" => e["episode_path"]
          }
        end)
      )

    path = Path.join(opts.out, "run-manifest-#{stamp()}.json")
    File.mkdir_p!(opts.out)
    File.write!(path, Jason.encode!(manifest, pretty: true) <> "\n")
    path
  end

  defp environment_facts do
    %{
      "elixir" => System.version(),
      "git_head" => git(["rev-parse", "HEAD"]),
      "git_describe" => git(["describe", "--always", "--dirty"]),
      "git_status_entries" =>
        git(["status", "--porcelain"]) |> String.split("\n", trim: true) |> length(),
      "mix_env" => System.get_env("MIX_ENV"),
      "novel_test_db_dir" => System.get_env("NOVEL_TEST_DB_DIR"),
      "mix_test_partition" => System.get_env("MIX_TEST_PARTITION"),
      "boot_time" => now_iso()
    }
  end

  defp fixture_facts do
    snapshot_files = Path.wildcard(Path.join(@snapshots_dir, "*.json"))

    %{
      "cases_yml_sha256" => sha256(File.read!(@cases_path)),
      "arms_yml_sha256" =>
        if(File.exists?(@arms_path), do: sha256(File.read!(@arms_path)), else: nil),
      "snapshot_count" => length(snapshot_files),
      "snapshot_sha256" =>
        Map.new(Enum.sort(snapshot_files), fn path ->
          {Path.basename(path), sha256(File.read!(path))}
        end)
    }
  end

  defp workspace_arm_check do
    with true <- File.exists?(@arms_path),
         doc = YamlElixir.read_from_file!(@arms_path),
         assets when is_list(assets) <- get(doc, "assets") do
      old_hash = get(get(doc, "old_rules_arm") || %{}, "arm_content_hash")
      integrated_hash = get(get(doc, "integrated_arm") || %{}, "arm_content_hash")

      drift =
        assets
        |> Enum.filter(fn asset ->
          path = get(asset, "path")
          abs = Path.join(@root, path)
          expected = get(asset, "sha256")
          not File.exists?(abs) or sha256(File.read!(abs)) != expected
        end)
        |> Enum.map(&get(&1, "path"))

      current_hash = arm_content_hash(assets)

      %{
        "old_rules_arm_content_hash" => old_hash,
        "integrated_arm_content_hash" => integrated_hash,
        "current_workspace_arm_content_hash" => current_hash,
        "workspace_matches_integrated_arm" =>
          is_binary(integrated_hash) and current_hash == integrated_hash,
        "workspace_matches_frozen_old_arm" => is_binary(old_hash) and current_hash == old_hash,
        "drift_asset_paths" => drift,
        "note" =>
          "old 臂回放使用冻结快照字节，不受 drift 影响；integrated 臂使用当前工作区规则，" <>
            "drift 即重冻后的再次前进（CP4 执行批矩阵应尽量在无 drift 窗口运行并记录）"
      }
    else
      _ -> %{"workspace_matches_frozen_old_arm" => nil, "note" => "arms.yml 缺失或不可解析"}
    end
  end

  # arms.yml assets 清单 → 与冻结清单一致的 arm_content_hash 算法（path:sha256 排序后 sha256）。
  defp arm_content_hash(assets) do
    assets
    |> Enum.map(fn asset -> "#{get(asset, "path")}:#{get(asset, "sha256")}" end)
    |> Enum.sort()
    |> Enum.join("\n")
    |> sha256()
  end

  defp provider_config_doc(opts) do
    %{
      "provider" => to_string(opts.provider_cfg.provider),
      "requested_model" => opts.effective_model,
      "purpose_initial" => "conversation（生产 plan_agent_run/2 默认）",
      "judgment_override" =>
        "JudgmentProtocol: purpose=planner, content_visibility=author, temperature=0.2",
      "timeout_ms" => opts.timeout_ms,
      "timeout_note" => "episode 挂钟上限；provider 侧 local response 静默窗口由 TimeoutPolicy 兜底"
    }
  end

  defp method_doc(opts) do
    %{
      "semantic_evidence" => opts.provider != "stub",
      "pipeline_only" => opts.provider == "stub",
      "note" =>
        if(opts.provider == "stub",
          do: "stub 只证明管道/字段/解析，不构成 §6.1 语义证据",
          else: "真实 provider 响应；语义通过与否必须由评分器读取人工判定后聚合"
        )
    }
  end

  defp material_summary(snap) do
    materials = get(snap, "materials") || %{}
    facts = get(materials, "prompt_facts") || %{}

    %{
      "author_text" => get(materials, "author_text"),
      "chapter_index" => get(materials, "chapter_index") || [],
      "pending_adoptions" => get(materials, "pending_adoptions") || [],
      "adopted_content_targets" => get(materials, "adopted_content_targets") || [],
      "interaction_state" => get(materials, "interaction_state") || %{},
      "supplied_context_refs" => get(materials, "supplied_context_refs") || [],
      "explore_tools" => get(facts, "explore_tools") || [],
      "capabilities" => get(facts, "capabilities") || [],
      "prompt_chars" => get(facts, "prompt_chars")
    }
  end

  defp normalize_error(error) when is_map(error) do
    %{
      "reason_code" => get(error, :reason_code) || get(error, "reason_code") || "provider_error",
      "message" => get(error, :message) || get(error, "message") || inspect(error)
    }
  end

  defp normalize_error(error),
    do: %{"reason_code" => "provider_error", "message" => inspect(error)}

  # ── 通用小工具 ──────────────────────────────────────────────────────────

  defp read_yaml!(path) do
    YamlElixir.read_from_file!(path)
  rescue
    error ->
      IO.puts("[b27-eval] 无法读取 #{path}: #{Exception.message(error)}")
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

  defp truthy(value) when value in [true, "true", 1], do: true
  defp truthy(_), do: false

  defp chars(nil), do: 0
  defp chars(value) when is_binary(value), do: String.length(value)
  defp chars(_), do: 0

  defp sha256(binary), do: :crypto.hash(:sha256, binary) |> Base.encode16(case: :lower)

  defp canonical_json(value), do: value |> canonical() |> Jason.encode!()

  defp canonical(map) when is_map(map) do
    Map.new(map, fn {key, value} -> {to_string(key), canonical(value)} end)
  end

  defp canonical(list) when is_list(list), do: Enum.map(list, &canonical/1)
  defp canonical(nil), do: nil

  defp canonical(value) when is_atom(value) and value not in [true, false, nil],
    do: Atom.to_string(value)

  defp canonical(value), do: value

  # 保持 map key 为字符串；struct 转 map，未知形态降级 inspect，避免 Jason 编码失败。
  defp jsonable(%_{} = struct), do: struct |> Map.from_struct() |> jsonable()

  defp jsonable(map) when is_map(map),
    do: Map.new(map, fn {k, v} -> {to_string(k), jsonable(v)} end)

  defp jsonable(list) when is_list(list), do: Enum.map(list, &jsonable/1)
  defp jsonable(tuple) when is_tuple(tuple), do: inspect(tuple)
  defp jsonable(fun) when is_function(fun), do: "<fun>"
  defp jsonable(nil), do: nil
  defp jsonable(value) when is_boolean(value) or is_number(value) or is_binary(value), do: value
  defp jsonable(value) when is_atom(value), do: Atom.to_string(value)
  defp jsonable(value), do: inspect(value)

  defp truncate_json(nil, _limit), do: nil
  defp truncate_json(value, limit) when is_binary(value), do: String.slice(value, 0, limit)
  defp truncate_json(value, limit), do: value |> inspect() |> String.slice(0, limit)

  defp sanitize_url(nil), do: nil

  defp sanitize_url(url) do
    url
    |> to_string()
    |> String.replace(~r/([?&](?:api_?key|key|token)=)[^&]*/i, "\\1<redacted>")
  end

  defp db_dir do
    case repo_config() do
      nil -> "unknown"
      database -> Path.dirname(database)
    end
  end

  defp repo_config do
    case Process.whereis(NovelPersistence.Repo) do
      nil -> nil
      _pid -> NovelPersistence.Repo.config()[:database] |> to_string()
    end
  end

  defp git(args) do
    case System.cmd("git", args, cd: @root, stderr_to_stdout: true) do
      {out, 0} -> String.trim(out)
      _ -> nil
    end
  rescue
    _ -> nil
  end

  defp rel(abs_path) do
    case Path.relative_to(abs_path, @root) do
      ^abs_path -> abs_path
      rel -> rel
    end
  end

  defp now_iso, do: DateTime.utc_now() |> DateTime.to_iso8601()

  defp stamp, do: DateTime.utc_now() |> Calendar.strftime("%Y%m%d-%H%M%S")
end

B27SemanticEval.main(System.argv())
