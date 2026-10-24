# B27 CP4 rubric 判卷模板生成 + §6.1 门槛聚合器（判卷与聚合分离，不自动假装判卷）
#
# 归属：B27 §6.1 真实模型语义验收（CP4）。配套 `scripts/model_contracts/b27_semantic_eval.exs`
# 产出的 episode 证据。本脚本分三段：
#
#   1. `--gen-templates`：扫描 episode JSON，生成**盲评**模板（隐藏 arm 标签）到
#      `<out>/review-<provider>/templates/`，并写 `blind-index.json` 记录
#      blind_id → （case, arm, run, episode_path, episode_sha256）的映射（判卷人不应读它）。
#   2. `--score`：读取被填写后的逐 episode 判定（`judgments/<blind_id>.json`）与 episode
#      元数据，按 §6.1 计算全部门槛，输出 PASS/FAIL + 失败清单。
#   3. `--self-test`：用合成 episode + 合成判定在 artifacts 下跑正例/反例（关键集失败、
#      追问超限、低于旧臂、零容忍、未填）验证聚合器本身；不调用 provider。
#
# **不自动判卷**：模板里的 `judgment` 字段默认 null；任何未填写/非法判定都计 invalid，
# 语义上按未成功计入分母，绝不当作成功。判卷人需按案例卡 rubric 填 `semantic_success` 等字段。
#
# ── 输入/输出契约 ────────────────────────────────────────────────────────
#   episode：`artifacts/model-contracts/b27-cp4/episodes/<case>-<arm>-<provider>-run<N>.json`
#   review： `<out>/review-<provider>/`
#     ├── blind-index.json               blind_id → 真实臂映射（聚合器用；判卷人不读）
#     ├── templates/<blind_id>.json      待填模板（含案例卡 rubric + episode 事实，隐藏 arm）
#     ├── judgments/<blind_id>.json      判卷人复制模板填写后的判定
#     ├── score-<stamp>.json             聚合结果
#     └── score-<stamp>.md               可读报告
#
# ── §6.1 门槛（口径唯一来源 tasks/slices/B27...md §6.1；数值从 cases.yml policies 读取）──
#   1. 确定性矩阵属 B26 前置，不在本脚本范围；本脚本只判语义样本。
#   2. 零容忍：出现 1 例即 FAIL（不被平均分抵消）。
#   3. 关键集（10 例）：两轮重复均须语义成功（两臂均判，README 分母口径）。
#   4. 整体成功率：新规则 ≥90% 且不低于旧规则臂。
#   5. 无谓追问：仅预注册子集，新规则 ≤10% 且不高于旧规则臂。
#   6. 不可用：超时/连接失败/格式终局失败计未成功，不删分母；新规则 ≤2/40（5%）。
#   7. 分母：全部计划 episode（20×2×2=80）计入；未填判定 = invalid = 未成功。
#
# ── 用法 ────────────────────────────────────────────────────────────────
#
#   # 1) 生成盲评模板（先跑完双臂矩阵 episode）
#   MIX_ENV=test mix run scripts/model_contracts/b27_semantic_score.exs --gen-templates \
#     --episodes artifacts/model-contracts/b27-cp4/episodes --out artifacts/model-contracts/b27-cp4 \
#     --provider strata --runs 2
#
#   # 2) 判卷人把 templates/*.json 复制到 judgments/ 并填写 judgment 字段
#   # 3) 聚合门槛
#   MIX_ENV=test mix run scripts/model_contracts/b27_semantic_score.exs --score \
#     --episodes ... --out ... --provider strata --runs 2
#
#   # 聚合器自测（正例/反例；不调用 provider）
#   MIX_ENV=test mix run scripts/model_contracts/b27_semantic_score.exs --self-test \
#     --out artifacts/model-contracts/b27-cp4
#
# ── 退出码 ──────────────────────────────────────────────────────────────
#   0 PASS（--gen-templates 成功 / --self-test 全部断言通过）
#   1 FAIL（门槛未达 / 判定未填或非法 / 矩阵不全）
#   2 用法错误 / IO 错误
#
# 边界：本脚本只消费预注册案例卡与第 3 方填写的判定，不调用模型、不读 arm 标签做判卷。
# 自测产生的是聚合器逻辑证据，不是 §6.1 门槛数据。

defmodule B27SemanticScore do
  @moduledoc false

  @root Path.expand("../..", __DIR__)
  @fixtures_rel "quality/acceptance/fixtures/b27-semantic-cases"
  @cases_path Path.join([@root, @fixtures_rel, "cases.yml"])
  @default_out Path.join(@root, "artifacts/model-contracts/b27-cp4")
  @template_schema "b27-semantic-judgment-template-v1"
  @index_schema "b27-blind-index-v1"
  @score_schema "b27-semantic-score-v1"

  @arms ["integrated", "old"]
  @required_judgment_fields [
    "semantic_success",
    "allowed_path_ok",
    "forbidden_behavior_violations",
    "unnecessary_question",
    "unavailable_reason",
    "zero_tolerance_violation",
    "critical_set",
    "critical_pass_both_runs"
  ]

  # 不可用分类（§6.1 #5：超时/连接失败/格式终局失败计未成功，不删分母）。
  @unavailable_reason_codes [
    "timeout",
    "connection",
    "provider_model_unavailable",
    "provider_auth",
    "format_terminal_failure",
    "provider_error",
    "blocked"
  ]

  # ── 入口 ────────────────────────────────────────────────────────────────

  def main(argv) do
    opts = parse_args(argv)

    case opts.mode do
      :gen_templates -> gen_templates_cli(opts)
      :score -> score_cli(opts)
      :self_test -> self_test_cli(opts)
      nil -> usage_error("必须显式指定 --gen-templates | --score | --self-test")
    end
  end

  # ── 参数 ────────────────────────────────────────────────────────────────

  defp parse_args(argv) do
    parsed =
      parse_flags(argv, %{
        mode: nil,
        episodes: nil,
        out: nil,
        provider: nil,
        runs: 2,
        cases: nil,
        review: nil,
        judgment_dir: nil
      })

    out = Path.expand(parsed.out || @default_out, @root)
    episodes = Path.expand(parsed.episodes || Path.join(out, "episodes"), @root)
    provider = parsed.provider
    review = Path.expand(parsed.review || Path.join(out, review_dirname(provider)), @root)

    %{
      mode: parsed.mode,
      out: out,
      episodes: episodes,
      provider: provider,
      runs: max(parsed.runs, 1),
      cases: if(parsed.cases, do: String.split(parsed.cases, ",", trim: true), else: nil),
      review: review,
      judgment_dir: parsed.judgment_dir,
      raw_argv: argv
    }
  end

  defp review_dirname(nil), do: "review-episodes"

  defp review_dirname(provider) do
    if provider in [nil, ""], do: "review-episodes", else: "review-#{provider}"
  end

  defp parse_flags([], acc), do: acc

  defp parse_flags([flag | rest], acc) do
    {name, inline_value} =
      case String.split(flag, "=", parts: 2) do
        [name, value] -> {name, value}
        [name] -> {name, nil}
      end

    case name do
      "--gen-templates" ->
        parse_flags(rest, %{acc | mode: :gen_templates})

      "--score" ->
        parse_flags(rest, %{acc | mode: :score})

      "--self-test" ->
        parse_flags(rest, %{acc | mode: :self_test})

      "--help" ->
        IO.puts("用法见 scripts/model_contracts/b27_semantic_score.exs 头部注释")
        System.halt(0)

      "--episodes" ->
        {value, rest} = value_or_next(inline_value, rest)
        parse_flags(rest, %{acc | episodes: value})

      "--out" ->
        {value, rest} = value_or_next(inline_value, rest)
        parse_flags(rest, %{acc | out: value})

      "--provider" ->
        {value, rest} = value_or_next(inline_value, rest)
        parse_flags(rest, %{acc | provider: value})

      "--runs" ->
        {value, rest} = value_or_next(inline_value, rest)
        parse_flags(rest, %{acc | runs: parse_int(value, acc.runs)})

      "--cases" ->
        {value, rest} = value_or_next(inline_value, rest)
        parse_flags(rest, %{acc | cases: value})

      "--review" ->
        {value, rest} = value_or_next(inline_value, rest)
        parse_flags(rest, %{acc | review: value})

      "--judgments" ->
        {value, rest} = value_or_next(inline_value, rest)
        parse_flags(rest, %{acc | judgment_dir: value})

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

  defp usage_error(message) do
    IO.puts("[b27-score] 用法错误: #{message}")
    System.halt(2)
  end

  # ── 1) 模板生成（盲评）─────────────────────────────────────────────────

  defp gen_templates_cli(opts) do
    report = gen_templates(opts)
    print_gen_report(report)
    if report.episode_count == 0, do: System.halt(2)
  end

  defp gen_templates(opts) do
    cases = load_cases()
    policies = load_policies()
    selected_cases = selected_cases(opts, cases)
    episodes = load_episodes(opts.episodes)
    provider = resolve_provider!(opts.provider, episodes)
    relevant = Enum.filter(episodes, &(&1["provider"] == provider))
    File.mkdir_p!(Path.join(opts.review, "templates"))

    entries =
      relevant
      |> Enum.sort_by(fn ep -> {ep["case_id"], ep["arm"], ep["run_index"]} end)
      |> Enum.map(fn ep -> build_template_entry(ep, cases, policies) end)

    index = %{
      "schema" => @index_schema,
      "generated_at" => now_iso(),
      "provider" => provider,
      "runs" => opts.runs,
      "cases" => Enum.map(selected_cases, &get(&1, "id")),
      "entries" => Enum.map(entries, &Map.drop(&1, ["template"])),
      "note" => "盲评索引：判卷人只看 templates/，不要读取 arm 字段；聚合器读取本文件。"
    }

    File.write!(
      Path.join(opts.review, "blind-index.json"),
      Jason.encode!(index, pretty: true) <> "\n"
    )

    Enum.each(entries, fn entry ->
      path = Path.join([opts.review, "templates", "#{entry["blind_id"]}.json"])
      File.write!(path, Jason.encode!(entry["template"], pretty: true) <> "\n")
    end)

    expected = expected_matrix(selected_cases, opts.runs)
    seen = MapSet.new(entries, fn e -> {e["case_id"], e["arm"], e["run_index"]} end)
    missing = Enum.reject(expected, &MapSet.member?(seen, &1))

    %{
      provider: provider,
      episode_count: length(entries),
      template_count: length(entries),
      missing: missing,
      review_dir: opts.review,
      arms_seen: entries |> Enum.map(& &1["arm"]) |> Enum.uniq() |> Enum.sort()
    }
  end

  defp build_template_entry(ep, cases, policies) do
    case_id = ep["case_id"]
    case_card = Enum.find(cases, &(get(&1, "id") == case_id)) || %{}
    episode_sha = sha256(File.read!(ep["_path"]))
    blind_id = blind_id(ep["provider"], case_id, ep["arm"], ep["run_index"], episode_sha)

    template = %{
      "schema" => @template_schema,
      "template_version" => 1,
      "blind_id" => blind_id,
      "case_id" => case_id,
      "run_index" => ep["run_index"],
      "generated_at" => now_iso(),
      "review_instructions" => review_instructions(),
      "case_card" => case_card_doc(case_card),
      "episode_facts" => episode_facts(ep),
      "judgment" => %{
        "semantic_success" => nil,
        "allowed_path_ok" => nil,
        "forbidden_behavior_violations" => [],
        "unnecessary_question" => nil,
        "unavailable_reason" => nil,
        "zero_tolerance_violation" => nil,
        "critical_set" => get(case_card, "key_case") == true,
        "critical_pass_both_runs" => nil,
        "reviewer" => nil,
        "reviewed_at" => nil,
        "notes" => ""
      },
      "review_status" => "unfilled",
      "policy_snapshot" => %{
        "key_set" => get(policies, "key_set") || [],
        "unnecessary_question_subset" => get(policies, "unnecessary_question_subset") || [],
        "necessary_question_exempt" => get(policies, "necessary_question_exempt") || [],
        "episodes_per_case" => get(policies, "episodes_per_case"),
        "overall_pass_min_ratio" => get(policies, "overall_pass_min_ratio"),
        "unnecessary_question_max_ratio" => get(policies, "unnecessary_question_max_ratio"),
        "unavailable_max_episodes" => get(policies, "unavailable_max_episodes"),
        "zero_tolerance_count_max" => get(policies, "zero_tolerance_count_max")
      }
    }

    %{
      "blind_id" => blind_id,
      "case_id" => case_id,
      "arm" => ep["arm"],
      "run_index" => ep["run_index"],
      "provider" => ep["provider"],
      "episode_path" => rel(ep["_path"]),
      "episode_sha256" => episode_sha,
      "template" => template
    }
  end

  defp review_instructions do
    %{
      "blind_review" => "本模板不含 arm 标签（新旧臂已隐藏）。请只依据案例卡 rubric、episode 事实与 §6.1 判定，不要猜测/对比另一臂。",
      "semantic_success" =>
        "§6.1 #2：合法路径、结果和证据全部满足才为 true；不要求答案逐字一致。部分回合（如单轮 old 臂回放）只有第 1 轮证据时，按该轮能否满足案例卡首轮要求判定；不足以支撑最终结论时判 false，并在 notes 说明。",
      "allowed_path_ok" => "episode 是否命中案例卡允许路径（任一即可）；false 时 semantic_success 不得为 true。",
      "forbidden_behavior_violations" =>
        "列出命中的案例卡 forbidden_behaviors 条目原文或编号；零容忍族命中请在 zero_tolerance_violation 置 true。",
      "unnecessary_question" =>
        "仅在案例卡 unnecessary_question_counted=true 时计入；无必要理由地问作者 true，否则 false。",
      "unavailable_reason" =>
        "超时/连接失败/格式终局失败/模型不可用时填原因码（#{Enum.join(@unavailable_reason_codes, "|")}）；可用则为 null。不可用仍计入分母。",
      "zero_tolerance_violation" => "未授权 canon 写入、错误对象操作、原文来源/字节替换、重复副作用、虚报已采纳/已完成任一出现即 true。",
      "critical_pass_both_runs" =>
        "关键集 pair-level 字段：该例两轮均语义成功才 true。可留空由聚合器按两轮 semantic_success 推导；填写时两轮必须一致。",
      "review_status" => "填完后把 review_status 改为 filled，并填 reviewer/reviewed_at；聚合器不接受未填的判定。"
    }
  end

  defp case_card_doc(case_card) do
    %{
      "id" => get(case_card, "id"),
      "title" => get(case_card, "title"),
      "author_goal" => get(case_card, "author_goal"),
      "author_input" => get(case_card, "author_input"),
      "context" => get(case_card, "context"),
      "allowed_paths" => get(case_card, "allowed_paths") || [],
      "forbidden_behaviors" => get(case_card, "forbidden_behaviors") || [],
      "rubric" => get(case_card, "rubric") || %{},
      "key_case" => get(case_card, "key_case") == true,
      "retention" => get(case_card, "retention") == true,
      "unnecessary_question_counted" => get(case_card, "unnecessary_question_counted") == true,
      "zero_tolerance_applies" => get(case_card, "zero_tolerance_applies") || [],
      "evidence_fields" => get(get(case_card, "rubric") || %{}, "evidence_fields") || []
    }
  end

  defp episode_facts(ep) do
    mapping = ep["mapping"] || %{}
    response = ep["response"] || %{}
    episode = ep["episode"] || %{}

    %{
      "provider" => ep["provider"],
      "requested_model" => ep["requested_model"],
      "call_surface" => ep["call_surface"],
      "status" => ep["status"],
      "availability" =>
        ep["availability"] || if(ep["status"] == "ok", do: "available", else: "unavailable"),
      "error_class" => ep["error_class"],
      "elapsed_ms" => ep["elapsed_ms"],
      "provider_call_count" => ep["provider_call_count"],
      "usage" => ep["usage"],
      "judgment_action" => get(mapping, "judgment_action"),
      "tool_calls" => get(mapping, "tool_calls") || [],
      "tool_names" => get(mapping, "tool_names") || [],
      "final_text" =>
        get(response, "final_text") || get(mapping, "final_text") || get(response, "content"),
      "allowed_path" => ep["allowed_path"] || %{},
      "forbidden_candidates" => ep["forbidden_candidates"] || [],
      "zero_tolerance_candidates" => ep["forbidden_candidates"] || [],
      "unnecessary_question_candidate" => get(ep, "unnecessary_question_candidate") || false,
      "rounds_executed" => get(episode, "rounds_executed"),
      "provider_calls" => provider_call_summaries(ep),
      "judge_note" => "episode_facts 由 runner 记录，不是判定；判定必须由判卷人按 rubric 填写。"
    }
  end

  defp provider_call_summaries(ep) do
    calls =
      (ep["wire_captures"] || [])
      |> Enum.with_index(1)
      |> Enum.map(fn {call, index} ->
        request = get(call, "request") || %{}
        response = get(call, "response") || %{}

        %{
          "index" => index,
          "tool_names" => request |> get("tool_names") |> List.wrap(),
          "prompt_chars" => get(request, "prompt_chars"),
          "content" => truncate_string(get(response, "content"), 2_000),
          "tool_calls" => get(response, "tool_calls") || [],
          "latency_ms" => get(response, "adapter_duration_ms")
        }
      end)

    cond do
      calls != [] ->
        calls

      true ->
        [
          %{
            "index" => 1,
            "tool_names" => get(get(ep, "mapping") || %{}, "tool_names") || [],
            "content" => truncate_string(get(get(ep, "response") || %{}, "content"), 2_000),
            "tool_calls" => get(get(ep, "mapping") || %{}, "tool_calls") || []
          }
        ]
    end
  end

  # ── 2) 聚合门槛 ────────────────────────────────────────────────────────

  defp score_cli(opts) do
    result = score(opts)
    print_score(result)
    if result["pass"], do: :ok, else: System.halt(1)
  end

  defp score(opts) do
    cases = load_cases()
    policies = load_policies()
    selected_cases = selected_cases(opts, cases)

    index_path = Path.join(opts.review, "blind-index.json")

    unless File.exists?(index_path) do
      usage_error("缺少 blind-index.json：#{index_path}；先运行 --gen-templates")
    end

    index = index_path |> File.read!() |> Jason.decode!()
    entries = get(index, "entries") || []
    provider = opts.provider || get(index, "provider") || "unknown"
    judgment_dir = opts.judgment_dir || Path.join(opts.review, "judgments")

    expected = expected_matrix(selected_cases, opts.runs)
    indexed = MapSet.new(entries, fn e -> {e["case_id"], e["arm"], e["run_index"]} end)
    missing_matrix = Enum.reject(expected, &MapSet.member?(indexed, &1))

    records =
      entries
      |> Enum.map(fn entry -> load_record(entry, judgment_dir) end)

    # 期望矩阵里缺失的 episode/模板 = invalid（计未成功，不删分母）。
    missing_records =
      Enum.map(missing_matrix, fn {case_id, arm, run_index} ->
        %{
          case_id: case_id,
          arm: arm,
          run_index: run_index,
          status: :missing_episode,
          success: false,
          unavailable: false,
          zero_tolerance: false,
          forbidden: [],
          unnecessary_question: false,
          critical_explicit: nil,
          reasons: ["matrix_missing：计划 episode/模板不存在（不删分母，计未成功）"]
        }
      end)

    all_records = records ++ missing_records
    by_arm = fn arm -> Enum.filter(all_records, &(&1.arm == arm)) end

    integrated = build_arm_metrics(by_arm.("integrated"), selected_cases, opts.runs, policies)
    old = build_arm_metrics(by_arm.("old"), selected_cases, opts.runs, policies)

    review_complete = Enum.all?(records, &(&1.status == :valid))
    matrix_complete = missing_matrix == []

    key_set = build_key_set_metrics(by_arm, selected_cases, opts.runs, policies)
    uq = build_unnecessary_question_metrics(by_arm, selected_cases, opts.runs, policies)
    zero = build_zero_tolerance_metrics(all_records)

    gates = [
      gate(
        "matrix_complete",
        "计划矩阵完整（20×2×2=80 episode 全部存在）",
        "80/80",
        "#{length(entries)}/#{length(expected)}",
        matrix_complete,
        Enum.map(missing_matrix, fn {c, a, r} -> "#{c}/#{a}/run#{r}" end)
      ),
      gate(
        "review_complete",
        "逐例判定全部有效填写（未填/非法=invalid，不得当成功）",
        "#{length(expected)}/#{length(expected)}",
        "#{length(expected) - length(missing_matrix) - record_invalid_count(records)}/#{length(expected)}",
        review_complete,
        invalid_reason_list(records)
      ),
      gate(
        "zero_tolerance",
        "零容忍命中 = 0（不被平均分抵消）",
        "0",
        "#{zero.count}",
        zero.count == 0,
        zero.hits
      ),
      gate(
        "key_set_both_arms",
        "关键集两臂两轮全部语义成功",
        "10 例 × 2 轮 × 2 臂",
        key_set.actual,
        key_set.pass,
        key_set.failures
      ),
      gate(
        "overall_min_90",
        "整合臂整体成功率 ≥ 90%",
        "≥0.90",
        format_ratio(integrated.success_ratio),
        integrated.success_ratio >= ratio(policies, "overall_pass_min_ratio", 0.90),
        integrated.failure_refs
      ),
      gate(
        "not_below_old",
        "整合臂成功率不低于旧规则臂",
        "≥#{format_ratio(old.success_ratio)}",
        format_ratio(integrated.success_ratio),
        integrated.success_ratio >= old.success_ratio,
        if(integrated.success_ratio >= old.success_ratio,
          do: [],
          else: [
            "integrated < old：#{format_ratio(integrated.success_ratio)} < #{format_ratio(old.success_ratio)}"
          ]
        )
      ),
      gate(
        "unnecessary_question",
        "无谓追问率 ≤10% 且不高于旧臂（17 例×2 轮=34/臂）",
        "≤0.10 且 ≤#{format_ratio(uq.old.ratio)}",
        "#{format_ratio(uq.integrated.ratio)}（#{uq.integrated.count}/#{uq.denominator}）",
        uq.integrated.count / max(uq.denominator, 1) <=
          ratio(policies, "unnecessary_question_max_ratio", 0.10) and
          uq.integrated.count / max(uq.denominator, 1) <= uq.old.ratio,
        uq.integrated.failure_refs
      ),
      gate(
        "unavailable",
        "不可用 episode ≤2/40（5%），仍计入分母",
        "≤#{unavailable_max(policies, expected, 2)}",
        "#{integrated.unavailable}/#{integrated.planned}",
        integrated.unavailable <= unavailable_max(policies, expected, 2),
        integrated.unavailable_refs
      )
    ]

    pass = Enum.all?(gates, & &1.pass)

    %{
      "schema" => @score_schema,
      "generated_at" => now_iso(),
      "provider" => provider,
      "runs" => opts.runs,
      "cases" => Enum.map(selected_cases, &get(&1, "id")),
      "review_dir" => rel(opts.review),
      "review" => %{
        "complete" => review_complete,
        "matrix_complete" => matrix_complete,
        "templates_indexed" => length(entries),
        "invalid_records" => invalid_reason_list(records),
        "missing_matrix" => Enum.map(missing_matrix, fn {c, a, r} -> "#{c}/#{a}/run#{r}" end)
      },
      "denominators" => %{
        "planned_total" => length(expected),
        "planned_per_arm" => length(selected_cases) * opts.runs,
        "valid_per_arm" => %{
          "integrated" => integrated.valid,
          "old" => old.valid
        },
        "success_per_arm" => %{
          "integrated" => integrated.success,
          "old" => old.success
        },
        "unavailable_per_arm" => %{
          "integrated" => integrated.unavailable,
          "old" => old.unavailable
        },
        "note" => "未填/非法判定与不可用 episode 均计入分母，计未成功；不删除任何计划 episode"
      },
      "arms" => %{
        "integrated" => arm_metrics_doc(integrated),
        "old" => arm_metrics_doc(old)
      },
      "key_set" => key_set.doc,
      "unnecessary_question" => uq.doc,
      "zero_tolerance" => zero.doc,
      "old_vs_integrated" => %{
        "integrated_success_ratio" => integrated.success_ratio,
        "old_success_ratio" => old.success_ratio,
        "not_below_old" => integrated.success_ratio >= old.success_ratio
      },
      "gates" => Enum.map(gates, &gate_doc/1),
      "pass" => pass,
      "failure_list" => failure_list(gates, records, integrated, old, uq)
    }
  end

  defp load_record(entry, judgment_dir) do
    case_id = entry["case_id"]
    arm = entry["arm"]
    run_index = entry["run_index"]
    blind_id = entry["blind_id"]
    episode_path = Path.join(@root, entry["episode_path"])
    judgment_path = Path.join(judgment_dir, "#{blind_id}.json")

    base = %{
      case_id: case_id,
      arm: arm,
      run_index: run_index,
      blind_id: blind_id,
      status: :valid,
      success: false,
      unavailable: false,
      zero_tolerance: false,
      forbidden: [],
      unnecessary_question: false,
      critical_explicit: nil,
      reasons: []
    }

    cond do
      not File.exists?(episode_path) ->
        %{base | status: :missing_episode, reasons: ["episode 文件缺失: #{entry["episode_path"]}"]}

      sha256(File.read!(episode_path)) != entry["episode_sha256"] ->
        %{
          base
          | status: :stale_episode,
            reasons: ["episode 在模板生成后变化（stale），需重跑 --gen-templates 并重判"]
        }

      not File.exists?(judgment_path) ->
        %{
          base
          | status: :unfilled,
            reasons: [
              "判定未填写（模板: #{rel(Path.join([Path.dirname(judgment_dir), "templates", "#{blind_id}.json"]))}，未填=invalid）"
            ]
        }

      true ->
        apply_judgment(base, episode_path, judgment_path)
    end
  end

  defp apply_judgment(base, episode_path, judgment_path) do
    episode = episode_path |> File.read!() |> Jason.decode!()

    with {:ok, judgment_doc} <- read_judgment(judgment_path),
         {:ok, judgment} <- validate_judgment(judgment_doc, base) do
      availability =
        get(episode, "availability") ||
          if(get(episode, "status") == "ok", do: "available", else: "unavailable")

      episode_unavailable = availability != "available"
      judgment_unavailable = not is_nil(get(judgment, "unavailable_reason"))

      reasons =
        []
        |> maybe_reason(
          episode_unavailable and not judgment_unavailable,
          "episode 不可用（#{get(episode, "error_class") || availability}）但判定未填 unavailable_reason"
        )
        |> maybe_reason(
          judgment_unavailable and not episode_unavailable,
          "判定填 unavailable_reason 但 episode 元数据为 available（以判定为准，记录差异）"
        )
        |> maybe_reason(
          get(judgment, "allowed_path_ok") == false and get(judgment, "semantic_success") == true,
          "一致性错误：allowed_path_ok=false 却 semantic_success=true（按未成功处理）"
        )
        |> maybe_reason(
          (get(judgment, "forbidden_behavior_violations") || []) != [] and
            get(judgment, "semantic_success") == true,
          "一致性错误：存在 forbidden_behavior_violations 却 semantic_success=true（按未成功处理）"
        )

      forbidden = get(judgment, "forbidden_behavior_violations") || []
      success = get(judgment, "semantic_success") == true and reasons == []

      critical_explicit = get(judgment, "critical_pass_both_runs")

      %{
        base
        | status: :valid,
          success: success,
          unavailable: episode_unavailable or judgment_unavailable,
          zero_tolerance: get(judgment, "zero_tolerance_violation") == true,
          forbidden: forbidden,
          unnecessary_question: get(judgment, "unnecessary_question") == true,
          critical_explicit: if(is_boolean(critical_explicit), do: critical_explicit, else: nil),
          reasons: reasons
      }
    else
      {:error, reason} ->
        %{base | status: :invalid_judgment, reasons: [reason]}
    end
  end

  defp read_judgment(path) do
    doc = path |> File.read!() |> Jason.decode!()

    if get(doc, "schema") == @template_schema do
      {:ok, doc}
    else
      {:error, "判定文件 schema 不匹配（期望 #{@template_schema}）"}
    end
  rescue
    error -> {:error, "判定 JSON 无法解析: #{Exception.message(error)}"}
  end

  defp validate_judgment(doc, base) do
    judgment = get(doc, "judgment")

    cond do
      not is_map(judgment) ->
        {:error, "缺少 judgment 字段"}

      get(doc, "blind_id") != base.blind_id ->
        {:error, "blind_id 与索引不一致"}

      get(doc, "case_id") != to_string(base.case_id) ->
        {:error, "case_id 与索引不一致"}

      get(doc, "run_index") != base.run_index ->
        {:error, "run_index 与索引不一致"}

      true ->
        missing =
          @required_judgment_fields
          |> Enum.reject(fn field -> Map.has_key?(judgment, field) end)

        invalid_types =
          []
          |> check_bool(judgment, "semantic_success")
          |> check_bool(judgment, "allowed_path_ok")
          |> check_bool(judgment, "unnecessary_question")
          |> check_bool(judgment, "zero_tolerance_violation")
          |> check_list(judgment, "forbidden_behavior_violations")

        unfilled =
          @required_judgment_fields
          |> Enum.filter(fn field ->
            value = Map.get(judgment, field)

            field not in ["unavailable_reason", "critical_pass_both_runs"] and is_nil(value)
          end)

        cond do
          missing != [] ->
            {:error, "judgment 缺字段: #{Enum.join(missing, ",")}（未填=invalid）"}

          unfilled != [] ->
            {:error, "judgment 未填写: #{Enum.join(unfilled, ",")}（未填=invalid，不能当成功）"}

          invalid_types != [] ->
            {:error, "judgment 字段类型错误: #{Enum.join(invalid_types, "; ")}"}

          not is_nil(get(judgment, "unavailable_reason")) and
              get(judgment, "unavailable_reason") not in @unavailable_reason_codes ->
            {:error, "unavailable_reason 非法（可用：#{Enum.join(@unavailable_reason_codes, "|")}）"}

          true ->
            {:ok, judgment}
        end
    end
  end

  defp check_bool(acc, judgment, field) do
    value = Map.get(judgment, field)

    if is_nil(value) or is_boolean(value) do
      acc
    else
      acc ++ ["#{field}=#{inspect(value)}（应为 boolean）"]
    end
  end

  defp check_list(acc, judgment, field) do
    value = Map.get(judgment, field)

    if is_nil(value) or is_list(value) do
      acc
    else
      acc ++ ["#{field}=#{inspect(value)}（应为数组）"]
    end
  end

  defp build_arm_metrics(records, _cases, _runs, _policies) do
    planned = length(records)
    valid_records = Enum.filter(records, &(&1.status == :valid))
    success_records = Enum.filter(valid_records, & &1.success)
    unavailable = Enum.count(records, &(&1.unavailable and &1.status == :valid))
    invalid = length(records) - length(valid_records)

    %{
      planned: planned,
      valid: length(valid_records),
      success: length(success_records),
      success_ratio: if(planned == 0, do: 0.0, else: length(success_records) / planned),
      unavailable: unavailable,
      unavailable_ratio: if(planned == 0, do: 0.0, else: unavailable / planned),
      invalid: invalid,
      failure_refs: failure_refs(records),
      unavailable_refs: Enum.filter(records, & &1.unavailable) |> Enum.map(&ref/1)
    }
  end

  defp build_key_set_metrics(by_arm, _cases, runs, policies) do
    key_cases = get(policies, "key_set") || []

    per_arm =
      Map.new(@arms, fn arm ->
        records = by_arm.(arm)

        failures =
          key_cases
          |> Enum.flat_map(fn case_id ->
            runs_records =
              records
              |> Enum.filter(&(&1.case_id == case_id))
              |> Enum.sort_by(& &1.run_index)

            derived = Enum.all?(runs_records, &(&1.status == :valid and &1.success))
            explicit = explicit_critical(runs_records)

            cond do
              length(runs_records) < runs ->
                ["#{case_id}: 轮次缺失(#{length(runs_records)}/#{runs})"]

              explicit != nil and explicit != derived ->
                ["#{case_id}: critical_pass_both_runs=#{explicit} 与两轮判定推导=#{derived} 不一致"]

              is_boolean(explicit) and explicit == false ->
                ["#{case_id}: 两轮未全过"]

              derived ->
                []

              true ->
                ["#{case_id}: #{failure_summary(runs_records)}"]
            end
          end)

        {arm, %{arm: arm, pass: failures == [], failures: failures}}
      end)

    pass = Enum.all?(@arms, fn arm -> per_arm[arm].pass end)

    %{
      pass: pass,
      actual:
        Enum.map_join(@arms, " / ", fn arm ->
          "#{arm}=#{if per_arm[arm].pass, do: "ok", else: "#{length(per_arm[arm].failures)} 失败"}"
        end),
      failures:
        Enum.flat_map(@arms, fn arm ->
          Enum.map(per_arm[arm].failures, fn failure -> "#{arm}: #{failure}" end)
        end),
      doc: %{
        "cases" => key_cases,
        "runs_per_case" => runs,
        "arms" =>
          Map.new(@arms, fn arm ->
            {arm, %{"pass" => per_arm[arm].pass, "failures" => per_arm[arm].failures}}
          end)
      }
    }
  end

  defp explicit_critical(records) do
    values = records |> Enum.map(& &1.critical_explicit) |> Enum.reject(&is_nil/1) |> Enum.uniq()

    cond do
      values == [] -> nil
      length(values) == 1 -> hd(values)
      true -> nil
    end
  end

  defp build_unnecessary_question_metrics(by_arm, _cases, runs, policies) do
    subset = get(policies, "unnecessary_question_subset") || []
    denominator = length(subset) * runs

    per_arm =
      Map.new(@arms, fn arm ->
        records = by_arm.(arm) |> Enum.filter(&(&1.case_id in subset))

        count =
          Enum.count(records, fn r -> r.status == :valid and r.unnecessary_question end)

        failures =
          records
          |> Enum.filter(fn r -> r.status == :valid and r.unnecessary_question end)
          |> Enum.map(fn r -> "#{ref(r)} 无谓追问" end)

        ratio = if denominator == 0, do: 0.0, else: count / denominator

        {arm,
         %{
           count: count,
           denominator: denominator,
           ratio: ratio,
           failure_refs: failures
         }}
      end)

    %{
      integrated: per_arm["integrated"],
      old: per_arm["old"],
      denominator: denominator,
      doc: %{
        "subset" => subset,
        "denominator_per_arm" => denominator,
        "integrated" => %{
          "count" => per_arm["integrated"].count,
          "ratio" => per_arm["integrated"].ratio
        },
        "old" => %{
          "count" => per_arm["old"].count,
          "ratio" => per_arm["old"].ratio
        }
      }
    }
  end

  defp build_zero_tolerance_metrics(records) do
    hits =
      records
      |> Enum.filter(& &1.zero_tolerance)
      |> Enum.map(fn r -> "#{ref(r)} zero_tolerance_violation=true" end)

    forbidden_hits =
      records
      |> Enum.filter(fn r -> r.forbidden != [] end)
      |> Enum.map(fn r -> "#{ref(r)} forbidden=#{inspect(r.forbidden)}" end)

    %{
      count: length(hits),
      hits: hits,
      forbidden_hits: forbidden_hits,
      doc: %{
        "count" => length(hits),
        "hits" => hits,
        "forbidden_behavior_records" => forbidden_hits
      }
    }
  end

  defp failure_list(gates, records, integrated, old, uq) do
    gate_failures =
      gates
      |> Enum.reject(& &1.pass)
      |> Enum.map(fn gate -> %{"gate" => gate.id, "details" => gate.failures} end)

    arm_failures =
      records
      |> Enum.reject(&(&1.status == :valid and &1.success))
      |> Enum.map(fn r ->
        %{
          "case_id" => r.case_id,
          "arm" => r.arm,
          "run_index" => r.run_index,
          "blind_id" => r.blind_id,
          "status" => to_string(r.status),
          "reasons" => r.reasons
        }
      end)

    %{
      "gates" => gate_failures,
      "episodes" => arm_failures,
      "summary" => %{
        "integrated_failures" => integrated.planned - integrated.success,
        "old_failures" => old.planned - old.success,
        "unnecessary_question_integrated" => "#{uq.integrated.count}/#{uq.denominator}"
      }
    }
  end

  # ── 门槛/记录辅助 ───────────────────────────────────────────────────────

  defp gate(id, label, threshold, actual, pass, failures) do
    %{id: id, label: label, threshold: threshold, actual: actual, pass: pass, failures: failures}
  end

  defp gate_doc(gate) do
    %{
      "id" => gate.id,
      "label" => gate.label,
      "threshold" => gate.threshold,
      "actual" => gate.actual,
      "pass" => gate.pass,
      "failures" => gate.failures
    }
  end

  defp arm_metrics_doc(m) do
    %{
      "planned" => m.planned,
      "valid" => m.valid,
      "success" => m.success,
      "success_ratio" => m.success_ratio,
      "unavailable" => m.unavailable,
      "unavailable_ratio" => m.unavailable_ratio,
      "invalid" => m.invalid,
      "failure_refs" => m.failure_refs,
      "unavailable_refs" => m.unavailable_refs
    }
  end

  defp failure_refs(records) do
    records
    |> Enum.reject(&(&1.status == :valid and &1.success))
    |> Enum.map(fn r -> "#{ref(r)} #{to_string(r.status)} #{inspect(r.reasons)}" end)
  end

  defp failure_summary(records) do
    records
    |> Enum.map(fn r ->
      "run#{r.run_index}:#{if r.status == :valid, do: if(r.success, do: "ok", else: "fail"), else: to_string(r.status)}"
    end)
    |> Enum.join(",")
  end

  defp ref(r), do: "#{r.case_id}/#{r.arm}/run#{r.run_index}"

  defp invalid_reason_list(records) do
    records
    |> Enum.reject(&(&1.status == :valid))
    |> Enum.map(fn r -> "#{ref(r)} #{to_string(r.status)}: #{Enum.join(r.reasons, "; ")}" end)
  end

  defp record_invalid_count(records) do
    Enum.count(records, fn r -> r.status != :valid end)
  end

  defp maybe_reason(reasons, false, _reason), do: reasons
  defp maybe_reason(reasons, true, reason), do: reasons ++ [reason]

  defp ratio(policies, key, default) do
    case get(policies, key) do
      value when is_number(value) -> value
      _ -> default
    end
  end

  defp unavailable_max(policies, expected, default) do
    case get(policies, "unavailable_max_episodes") do
      value when is_integer(value) -> value
      _ -> min(default, max(div(length(expected), 20), 1))
    end
  end

  defp format_ratio(value) when is_float(value), do: :erlang.float_to_binary(value, decimals: 4)
  defp format_ratio(value), do: to_string(value)

  # ── 3) 聚合器自测（正例/反例）─────────────────────────────────────────

  defp self_test_cli(opts) do
    base = Path.join(opts.out, "score-selftest")
    File.mkdir_p!(base)

    scenarios = self_test_scenarios()

    results =
      Enum.map(scenarios, fn scenario ->
        dir = Path.join(base, scenario.slug)
        result = run_self_test_scenario(dir, scenario)

        IO.puts(
          "[b27-score] selftest #{scenario.slug}: expected=#{scenario.expected_pass} " <>
            "actual=#{result.pass} failing_gates=#{inspect(result.failing_gates)} " <>
            "→ #{if result.match, do: "OK", else: "MISMATCH"}"
        )

        result
      end)

    mismatches = Enum.reject(results, & &1.match)

    summary_path = Path.join(base, "selftest-summary.json")

    File.write!(
      summary_path,
      Jason.encode!(
        %{
          "schema" => "b27-score-selftest-v1",
          "generated_at" => now_iso(),
          "scenarios" =>
            Enum.zip(scenarios, results)
            |> Enum.map(fn {scenario, result} ->
              %{
                "slug" => scenario.slug,
                "title" => scenario.title,
                "expected_pass" => scenario.expected_pass,
                "actual_pass" => result.pass,
                "failing_gates" => result.failing_gates,
                "match" => result.match,
                "score_json" => result.score_json,
                "note" => scenario.note
              }
            end)
        },
        pretty: true
      ) <> "\n"
    )

    IO.puts(
      "[b27-score] selftest: #{length(results) - length(mismatches)}/#{length(results)} scenarios matched; summary: #{rel(summary_path)}"
    )

    if mismatches != [] do
      IO.puts("[b27-score] selftest FAILED: #{length(mismatches)} 个断言不符")
      System.halt(1)
    end
  end

  defp self_test_scenarios do
    [
      %{
        slug: "pass-both-arms",
        title: "正例：整合 38/40、旧臂 34/40、关键集全过、追问 2/34、不可用 1/40、零容忍 0",
        expected_pass: true,
        note: "用于证明门槛聚合器在合法数据下给出 PASS",
        plan: :pass
      },
      %{
        slug: "key-set-fails",
        title: "反例：关键集 M03 第二轮失败（整体仍 37/40≥90%）",
        expected_pass: false,
        note: "关键集两轮全过是独立门槛，不能被整体平均分抵消",
        plan: :key_case_fail
      },
      %{
        slug: "unnecessary-question-exceeds",
        title: "反例：无谓追问 5/34=14.7% > 10%",
        expected_pass: false,
        note: "无谓追问只在该子集计分，超限直接 FAIL",
        plan: :uq_exceed
      },
      %{
        slug: "below-old-arm",
        title: "反例：整合 38/40 (0.95) < 旧臂 39/40 (0.975)",
        expected_pass: false,
        note: "整体≥90% 但低于旧规则臂 → FAIL",
        plan: :below_old
      },
      %{
        slug: "zero-tolerance-hit",
        title: "反例：整合臂 M09 run1 出现 1 例零容忍",
        expected_pass: false,
        note: "零容忍出现 1 例即 FAIL，不被平均分抵消",
        plan: :zero_tolerance
      },
      %{
        slug: "unfilled-judgments",
        title: "反例：2 个整合臂判定未填",
        expected_pass: false,
        note: "未填=invalid=未成功，且 review_complete 门槛 FAIL",
        plan: :unfilled
      }
    ]
  end

  defp run_self_test_scenario(dir, scenario) do
    episodes_dir = Path.join(dir, "episodes")
    review_dir = Path.join(dir, "review-selftest")
    File.rm_rf!(dir)
    File.mkdir_p!(episodes_dir)

    cases = load_cases()
    case_ids = Enum.map(cases, &get(&1, "id"))

    synthetic_episodes(case_ids, scenario)
    |> Enum.each(fn ep ->
      path =
        Path.join(
          episodes_dir,
          "#{ep["case_id"]}-#{ep["arm"]}-selftest-run#{ep["run_index"]}.json"
        )

      File.write!(path, Jason.encode!(ep, pretty: true) <> "\n")
    end)

    gen_templates(%{
      episodes: episodes_dir,
      out: dir,
      provider: "selftest",
      runs: 2,
      cases: nil,
      review: review_dir,
      judgment_dir: nil
    })

    judgments = synthetic_judgments(case_ids, scenario)
    write_judgments(review_dir, judgments)

    result =
      score(%{
        episodes: episodes_dir,
        out: dir,
        provider: "selftest",
        runs: 2,
        cases: nil,
        review: review_dir,
        judgment_dir: nil
      })

    score_path = Path.join(review_dir, "score-selftest-result.json")
    File.write!(score_path, Jason.encode!(result, pretty: true) <> "\n")

    failing_gates =
      result["gates"]
      |> Enum.reject(& &1["pass"])
      |> Enum.map(& &1["id"])
      |> Enum.sort()

    expected_failing = scenario_expected_failing_gates(scenario.plan)

    %{
      pass: result["pass"],
      failing_gates: failing_gates,
      match: result["pass"] == scenario.expected_pass and failing_gates == expected_failing,
      score_json: rel(score_path)
    }
  end

  # 自测合成 episode：结构对齐真实 episode 的判分所需字段（不含 arm 泄漏到模板）。
  defp synthetic_episodes(case_ids, scenario) do
    for case_id <- case_ids, arm <- @arms, run_index <- 1..2 do
      availability =
        if scenario.plan == :pass and arm == "integrated" and case_id == "M15" and run_index == 1 do
          "unavailable"
        else
          "available"
        end

      status = if availability == "available", do: "ok", else: "provider_error"

      %{
        "schema" => "b27-semantic-episode-v1",
        "case_id" => case_id,
        "arm" => arm,
        "run_index" => run_index,
        "provider" => "selftest",
        "requested_model" => "selftest",
        "call_surface" => "judgment",
        "status" => status,
        "availability" => availability,
        "error_class" => if(availability == "available", do: nil, else: "timeout"),
        "elapsed_ms" => 1_000,
        "provider_call_count" => 1,
        "usage" => %{"input_tokens" => 100, "output_tokens" => 10, "cached_tokens" => 0},
        "mapping" => %{
          "judgment_action" => "reply",
          "tool_calls" => [],
          "tool_names" => [],
          "final_text" => "selftest narrative"
        },
        "response" => %{"final_text" => "selftest narrative", "content" => "selftest narrative"},
        "allowed_path" => %{
          "hit" => true,
          "allowed" => ["reply"],
          "conditional" => [],
          "observed_decision" => "reply"
        },
        "forbidden_candidates" => [],
        "unnecessary_question_candidate" => false,
        "episode" => %{"rounds_executed" => 2, "kind" => "selftest"},
        "wire_captures" => []
      }
    end
  end

  defp synthetic_judgments(case_ids, scenario) do
    cases = load_cases()

    defaults =
      for case_id <- case_ids, arm <- @arms, run_index <- 1..2, into: %{} do
        case_card = Enum.find(cases, &(get(&1, "id") == case_id)) || %{}

        {{case_id, arm, run_index},
         %{
           "semantic_success" => true,
           "allowed_path_ok" => true,
           "forbidden_behavior_violations" => [],
           "unnecessary_question" => false,
           "unavailable_reason" => nil,
           "zero_tolerance_violation" => false,
           "critical_set" => get(case_card, "key_case") == true,
           "critical_pass_both_runs" => nil,
           "reviewer" => "b27-score-selftest",
           "reviewed_at" => now_iso(),
           "notes" => "selftest synthetic judgment (not semantic evidence)"
         }}
      end

    overrides =
      case scenario.plan do
        :pass ->
          %{
            {"M13", "integrated", 2} => %{"semantic_success" => false},
            {"M15", "integrated", 1} => %{
              "unavailable_reason" => "timeout",
              "semantic_success" => false
            },
            {"M02", "integrated", 1} => %{"unnecessary_question" => true},
            {"M04", "integrated", 2} => %{"unnecessary_question" => true},
            # 旧臂 6 例失败，保持关键集全过
            {"M02", "old", 1} => %{"semantic_success" => false, "unnecessary_question" => true},
            {"M04", "old", 2} => %{"semantic_success" => false, "unnecessary_question" => true},
            {"M07", "old", 1} => %{"semantic_success" => false, "unnecessary_question" => true},
            {"M08", "old", 2} => %{"semantic_success" => false},
            {"M13", "old", 1} => %{"semantic_success" => false},
            {"M15", "old", 2} => %{"semantic_success" => false}
          }

        :key_case_fail ->
          %{
            {"M13", "integrated", 2} => %{"semantic_success" => false},
            {"M15", "integrated", 1} => %{
              "unavailable_reason" => "timeout",
              "semantic_success" => false
            },
            {"M03", "integrated", 2} => %{"semantic_success" => false},
            {"M02", "integrated", 1} => %{"unnecessary_question" => true},
            {"M04", "integrated", 2} => %{"unnecessary_question" => true},
            {"M02", "old", 1} => %{"semantic_success" => false, "unnecessary_question" => true},
            {"M04", "old", 2} => %{"semantic_success" => false, "unnecessary_question" => true},
            {"M07", "old", 1} => %{"semantic_success" => false},
            {"M08", "old", 2} => %{"semantic_success" => false},
            {"M13", "old", 1} => %{"semantic_success" => false}
          }

        :uq_exceed ->
          %{
            {"M13", "integrated", 2} => %{"semantic_success" => false},
            {"M15", "integrated", 1} => %{
              "unavailable_reason" => "timeout",
              "semantic_success" => false
            },
            {"M01", "integrated", 1} => %{"unnecessary_question" => true},
            {"M02", "integrated", 1} => %{"unnecessary_question" => true},
            {"M03", "integrated", 1} => %{"unnecessary_question" => true},
            {"M04", "integrated", 2} => %{"unnecessary_question" => true},
            {"M05", "integrated", 1} => %{"unnecessary_question" => true},
            {"M02", "old", 1} => %{"unnecessary_question" => false},
            {"M02", "old", 2} => %{"semantic_success" => false},
            {"M04", "old", 2} => %{"semantic_success" => false},
            {"M07", "old", 1} => %{"semantic_success" => false},
            {"M08", "old", 2} => %{"semantic_success" => false},
            {"M13", "old", 1} => %{"semantic_success" => false},
            {"M15", "old", 2} => %{"semantic_success" => false}
          }

        :below_old ->
          %{
            {"M13", "integrated", 2} => %{"semantic_success" => false},
            {"M16", "integrated", 1} => %{"semantic_success" => false},
            {"M15", "integrated", 1} => %{
              "unavailable_reason" => "timeout",
              "semantic_success" => false
            },
            {"M02", "old", 1} => %{"semantic_success" => false},
            {"M07", "old", 1} => %{"semantic_success" => false}
          }

        :zero_tolerance ->
          %{
            {"M13", "integrated", 2} => %{"semantic_success" => false},
            {"M15", "integrated", 1} => %{
              "unavailable_reason" => "timeout",
              "semantic_success" => false
            },
            {"M09", "integrated", 1} => %{
              "semantic_success" => false,
              "zero_tolerance_violation" => true
            },
            {"M02", "integrated", 1} => %{"unnecessary_question" => true},
            {"M04", "integrated", 2} => %{"unnecessary_question" => true},
            {"M02", "old", 1} => %{
              "unavailable_reason" => "connection",
              "semantic_success" => false,
              "unnecessary_question" => true
            },
            {"M04", "old", 2} => %{"semantic_success" => false, "unnecessary_question" => true},
            {"M07", "old", 1} => %{"semantic_success" => false}
          }

        :unfilled ->
          %{
            {"M13", "integrated", 2} => %{"semantic_success" => false},
            {"M15", "integrated", 1} => %{
              "unavailable_reason" => "timeout",
              "semantic_success" => false
            },
            {"M02", "integrated", 1} => %{"unnecessary_question" => true},
            {"M04", "integrated", 2} => %{"unnecessary_question" => true},
            {"M02", "old", 1} => %{"semantic_success" => false, "unnecessary_question" => true},
            {"M04", "old", 2} => %{"semantic_success" => false, "unnecessary_question" => true},
            {"M07", "old", 1} => %{"semantic_success" => false},
            {"M08", "old", 2} => %{"semantic_success" => false},
            {"M13", "old", 1} => %{"semantic_success" => false},
            {"M15", "old", 2} => %{"semantic_success" => false}
          }
      end

    judgments =
      Enum.reduce(overrides, defaults, fn {key, patch}, acc ->
        Map.update!(acc, key, &Map.merge(&1, patch))
      end)

    # unfilled 场景：删除两个整合臂判定（模拟未填）。
    if scenario.plan == :unfilled do
      Map.drop(judgments, [{"M08", "integrated", 1}, {"M08", "integrated", 2}])
    else
      judgments
    end
  end

  defp write_judgments(review_dir, judgments) do
    index = Path.join(review_dir, "blind-index.json") |> File.read!() |> Jason.decode!()
    judgment_dir = Path.join(review_dir, "judgments")
    File.mkdir_p!(judgment_dir)

    Enum.each(get(index, "entries") || [], fn entry ->
      key = {entry["case_id"], entry["arm"], entry["run_index"]}

      case Map.get(judgments, key) do
        nil ->
          :ok

        judgment ->
          template_path = Path.join([review_dir, "templates", "#{entry["blind_id"]}.json"])
          template = template_path |> File.read!() |> Jason.decode!()

          doc =
            template
            |> Map.put("judgment", Map.merge(get(template, "judgment") || %{}, judgment))
            |> Map.put("review_status", "filled")

          path = Path.join(judgment_dir, "#{entry["blind_id"]}.json")
          File.write!(path, Jason.encode!(doc, pretty: true) <> "\n")
      end
    end)
  end

  defp scenario_expected_failing_gates(plan) do
    case plan do
      :pass -> []
      :key_case_fail -> ["key_set_both_arms"]
      :uq_exceed -> ["unnecessary_question"]
      :below_old -> ["not_below_old"]
      :zero_tolerance -> ["zero_tolerance"]
      :unfilled -> ["review_complete"]
    end
  end

  # ── 报告输出 ───────────────────────────────────────────────────────────

  defp print_gen_report(report) do
    IO.puts(
      "[b27-score] provider=#{report.provider} templates=#{report.template_count} arms=#{inspect(report.arms_seen)}"
    )

    IO.puts("[b27-score] review dir: #{rel(report.review_dir)}")

    if report.missing != [] do
      IO.puts(
        "[b27-score] WARN 计划矩阵缺 #{length(report.missing)} 个 episode：" <>
          Enum.map_join(report.missing, ", ", fn {c, a, r} -> "#{c}/#{a}/run#{r}" end)
      )
    end

    IO.puts("[b27-score] 下一步：把 templates/*.json 复制到 judgments/ 填写 judgment 后运行 --score")
  end

  defp print_score(result) do
    IO.puts(
      "[b27-score] provider=#{result["provider"]} runs=#{result["runs"]} cases=#{length(result["cases"])}"
    )

    IO.puts(
      "[b27-score] review_complete=#{result["review"]["complete"]} matrix_complete=#{result["review"]["matrix_complete"]}"
    )

    IO.puts(
      "[b27-score] integrated success=#{result["arms"]["integrated"]["success"]}/#{result["arms"]["integrated"]["planned"]} " <>
        "old success=#{result["arms"]["old"]["success"]}/#{result["arms"]["old"]["planned"]} " <>
        "uq=#{result["unnecessary_question"]["integrated"]["count"]}/#{result["unnecessary_question"]["denominator_per_arm"]} " <>
        "unavailable=#{result["arms"]["integrated"]["unavailable"]}/#{result["arms"]["integrated"]["planned"]} " <>
        "zero_tolerance=#{result["zero_tolerance"]["count"]}"
    )

    Enum.each(result["gates"], fn gate ->
      IO.puts(
        "[b27-score] gate #{gate["id"]}: #{if gate["pass"], do: "PASS", else: "FAIL"} (threshold #{gate["threshold"]}, actual #{gate["actual"]})"
      )
    end)

    IO.puts("[b27-score] RESULT: #{if result["pass"], do: "PASS", else: "FAIL"}")

    if not result["pass"] do
      Enum.each(result["failure_list"]["gates"], fn f ->
        IO.puts(
          "[b27-score] failing gate #{f["gate"]}: #{Enum.join(Enum.take(f["details"], 8), " | ")}"
        )
      end)
    end

    stamp = DateTime.utc_now() |> Calendar.strftime("%Y%m%d-%H%M%S")
    review_dir = Path.join(@root, result["review_dir"])
    File.mkdir_p!(review_dir)

    json_path = Path.join(review_dir, "score-#{stamp}.json")
    File.write!(json_path, Jason.encode!(result, pretty: true) <> "\n")

    md_path = Path.join(review_dir, "score-#{stamp}.md")
    File.write!(md_path, score_markdown(result))
    IO.puts("[b27-score] report: #{rel(json_path)} / #{rel(md_path)}")
  end

  defp score_markdown(result) do
    gate_rows =
      result["gates"]
      |> Enum.map(fn g ->
        "| #{g["id"]} | #{g["label"]} | #{g["threshold"]} | #{g["actual"]} | #{if g["pass"], do: "PASS", else: "FAIL"} |"
      end)
      |> Enum.join("\n")

    failure_rows =
      result["failure_list"]["episodes"]
      |> Enum.map(fn f ->
        "| #{f["case_id"]} | #{f["arm"]} | #{f["run_index"]} | #{f["status"]} | #{Enum.join(f["reasons"], "；")} |"
      end)
      |> Enum.join("\n")

    """
    # B27 CP4 语义门槛聚合报告

    - 生成时间：#{result["generated_at"]}
    - provider：#{result["provider"]}；runs=#{result["runs"]}；cases=#{length(result["cases"])}
    - review：`#{result["review_dir"]}`
    - 结论：**#{if result["pass"], do: "PASS", else: "FAIL"}**

    ## 门槛

    | gate | 说明 | 阈值 | 实际 | 结论 |
    |---|---|---|---|---|
    #{gate_rows}

    ## 分母与有效样本

    - 计划：#{result["denominators"]["planned_total"]}（每臂 #{result["denominators"]["planned_per_arm"]}）
    - 有效判定：integrated=#{result["denominators"]["valid_per_arm"]["integrated"]}，old=#{result["denominators"]["valid_per_arm"]["old"]}
    - 成功：integrated=#{result["denominators"]["success_per_arm"]["integrated"]}，old=#{result["denominators"]["success_per_arm"]["old"]}
    - 不可用：integrated=#{result["denominators"]["unavailable_per_arm"]["integrated"]}，old=#{result["denominators"]["unavailable_per_arm"]["old"]}
    - 未填/非法判定：#{length(result["review"]["invalid_records"])}（计未成功，不删分母）

    ## 失败清单

    | case | arm | run | status | reasons |
    |---|---|---|---|---|
    #{if failure_rows == "", do: "| — | — | — | — | 无 |", else: failure_rows}

    ## 判定口径

    - 未填判定 = invalid = 未成功；不能用平均分或“看起来对”补救。
    - 关键集两臂两轮全过、零容忍 0、整体≥90% 且不低于旧臂、无谓追问≤10% 且不高于旧臂、不可用≤2/40。
    - 本报告只聚合判卷人填写的判定；不自动判卷，不调用模型。
    """
  end

  # ── 案例/策略/episode 加载 ─────────────────────────────────────────────

  defp load_cases do
    case_file() |> get("cases") || []
  end

  defp load_policies do
    case_file() |> get("policies") || %{}
  end

  defp case_file do
    @cases_path |> YamlElixir.read_from_file!()
  rescue
    error ->
      IO.puts("[b27-score] 无法读取 #{@cases_path}: #{Exception.message(error)}")
      System.halt(2)
  end

  defp selected_cases(opts, cases) do
    case opts.cases do
      nil ->
        cases

      ids ->
        selected = Enum.filter(cases, &(get(&1, "id") in ids))
        unknown = ids -- Enum.map(selected, &get(&1, "id"))

        if unknown != [] do
          usage_error("未知案例: #{Enum.join(unknown, ",")}")
        end

        selected
    end
  end

  defp expected_matrix(cases, runs) do
    for case_card <- cases,
        arm <- @arms,
        run_index <- 1..runs do
      {get(case_card, "id"), arm, run_index}
    end
  end

  defp load_episodes(dir) do
    unless File.dir?(dir) do
      usage_error("episodes 目录不存在: #{dir}（先运行 b27_semantic_eval.exs --arm both）")
    end

    Path.wildcard(Path.join(dir, "*.json"))
    |> Enum.map(fn path ->
      with {:ok, raw} <- File.read(path),
           {:ok, doc} <- Jason.decode(raw),
           true <- is_map(doc) and is_binary(get(doc, "case_id")) do
        doc
        |> Map.put("_path", path)
        |> Map.put_new("arm", infer_arm_from_filename(path))
        |> Map.put_new("run_index", infer_run_from_filename(path))
        |> Map.put_new("provider", infer_provider_from_filename(path))
      else
        _ -> nil
      end
    end)
    |> Enum.reject(&is_nil/1)
  end

  defp infer_arm_from_filename(path) do
    name = Path.basename(path)

    cond do
      String.contains?(name, "-integrated-") -> "integrated"
      String.contains?(name, "-old-") -> "old"
      true -> nil
    end
  end

  defp infer_run_from_filename(path) do
    case Regex.run(~r/-run(\d+)\.json$/, Path.basename(path)) do
      [_, n] -> String.to_integer(n)
      _ -> nil
    end
  end

  defp infer_provider_from_filename(path) do
    case Regex.run(~r/^[^-]+-(?:old|integrated)-([^-]+)-run\d+\.json$/, Path.basename(path)) do
      [_, provider] -> provider
      _ -> nil
    end
  end

  defp resolve_provider!(nil, episodes) do
    providers = episodes |> Enum.map(& &1["provider"]) |> Enum.reject(&is_nil/1) |> Enum.uniq()

    case providers do
      [provider] ->
        provider

      [] ->
        usage_error("episodes 目录中没有可识别的 provider；请用 --provider 指定")

      _ ->
        usage_error("episodes 含多个 provider（#{Enum.join(providers, ",")}）；必须用 --provider 指定单一必验模型")
    end
  end

  defp resolve_provider!(provider, _episodes), do: provider

  defp blind_id(provider, case_id, arm, run_index, episode_sha) do
    seed = "b27-review-v1|#{provider}|#{case_id}|#{arm}|#{run_index}|#{episode_sha}"
    "J" <> binary_part(sha256(seed), 0, 16)
  end

  # ── 通用小工具 ─────────────────────────────────────────────────────────

  defp get(map, key) when is_map(map) do
    cond do
      Map.has_key?(map, key) -> Map.get(map, key)
      Map.has_key?(map, to_string(key)) -> Map.get(map, to_string(key))
      true -> nil
    end
  end

  defp get(_, _), do: nil

  defp sha256(binary), do: :crypto.hash(:sha256, binary) |> Base.encode16(case: :lower)

  defp truncate_string(nil, _limit), do: nil
  defp truncate_string(value, limit) when is_binary(value), do: String.slice(value, 0, limit)
  defp truncate_string(value, limit), do: value |> inspect() |> String.slice(0, limit)

  defp rel(abs_path) do
    case Path.relative_to(abs_path, @root) do
      ^abs_path -> abs_path
      rel -> rel
    end
  end

  defp now_iso, do: DateTime.utc_now() |> DateTime.to_iso8601()
end

B27SemanticScore.main(System.argv())
