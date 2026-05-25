# I2 输入差异（Input Variation）验证 driver
#
# 不变量定义：docs/engineering/scenario-invariants.md §2.2
# slice 任务：tasks/slices/SI-004-scenario-invariants-i2-variation.md
#
# 运行：
#   MIX_ENV=test mix run scripts/scenario_invariants/run_i2_variation.exs
#
# 设计：
# - 跑 N=3 个语义独立的输入，通过 `DialogueGateway.handle_input` 真实主链产出
#   artifact items，提取每个 case 的 item_id 集合
# - 0/1 判定：N 个集合两两不相交 (pairwise_disjoint)
# - 任一对相交 → I2 violation
#
# 抓的伪造手段：
# - 产品代码 hardcoded items（所有输入返回相同 item_id）
# - 产品代码按输入关键词分支预制（多输入维度后某些 case 共享 item_id）
# - Provider/stub 返回与输入无关的固定 id
#
# 报告输出：
#   artifacts/scenario-invariants/i2.md
#   artifacts/scenario-invariants/i2.json

defmodule I2VariationDriver do
  @moduledoc false

  alias NovelApplication.DialogueGateway

  @cases [
    %{name: "case-A", topic: "赛博修仙的章节计划，强调灵气垄断主线"},
    %{name: "case-B", topic: "末日科幻的人物草案，三位幸存者视角"},
    %{name: "case-C", topic: "古风武侠的开篇正文，江湖恩怨切入"}
  ]

  def run do
    File.mkdir_p!("artifacts/scenario-invariants")

    cases = Enum.map(@cases, &run_case/1)
    pairwise = check_pairwise_disjoint(cases)
    case_failures = case_level_failures(cases)

    overall_ok = pairwise.ok and case_failures == []

    write_markdown("artifacts/scenario-invariants/i2.md", cases, pairwise, case_failures)
    write_json("artifacts/scenario-invariants/i2.json", cases, pairwise, case_failures)

    summary_line = summary_line(cases, pairwise, case_failures)
    IO.puts("\n" <> summary_line)

    if not overall_ok do
      System.halt(1)
    end
  end

  # 任一 case 出错或未产出 items，driver 都应当 fail —
  # 空 item_ids 集合与任何集 disjoint，会让 pairwise 误判 ok，
  # 但实际上 I2 判定无意义（没有 items 可比较）。
  defp case_level_failures(cases) do
    Enum.filter(cases, fn c ->
      c.outcome == :error or c.item_count == 0
    end)
  end

  # ── one case ──

  defp run_case(c) do
    text =
      "请基于以下主题生成创作产物。主题：#{c.topic}。请按 direction 要求返回 items。"

    input = %{
      text: text,
      workspace_id: "i2-driver-#{c.name}",
      generate_micro_plan: true
    }

    try do
      case DialogueGateway.handle_input(input) do
        {:ok, turn_result, _trace, _candidates, _context} ->
          items = collect_items(turn_result)
          ids = items |> Enum.map(&Map.get(&1, :item_id)) |> Enum.reject(&is_nil/1)

          %{
            case: c.name,
            topic: c.topic,
            outcome: :collected,
            item_ids: ids,
            item_count: length(ids)
          }

        {:error, reason} ->
          %{
            case: c.name,
            topic: c.topic,
            outcome: :error,
            detail: "DialogueGateway error: #{inspect(reason)}",
            item_ids: [],
            item_count: 0
          }
      end
    rescue
      e ->
        %{
          case: c.name,
          topic: c.topic,
          outcome: :error,
          detail: "exception: #{Exception.message(e)}",
          item_ids: [],
          item_count: 0
        }
    end
  end

  # ── pairwise disjoint check ──

  defp check_pairwise_disjoint(cases) do
    indexed = Enum.with_index(cases)

    pairs =
      for {a, i} <- indexed, {b, j} <- indexed, i < j do
        sa = MapSet.new(a.item_ids)
        sb = MapSet.new(b.item_ids)
        intersection = MapSet.intersection(sa, sb)
        disjoint = MapSet.size(intersection) == 0

        %{
          left: a.case,
          right: b.case,
          left_ids: a.item_ids,
          right_ids: b.item_ids,
          intersection: MapSet.to_list(intersection),
          disjoint: disjoint
        }
      end

    violations = Enum.reject(pairs, & &1.disjoint)

    %{
      ok: violations == [],
      pair_count: length(pairs),
      pairs: pairs,
      violations: violations
    }
  end

  # ── collect items ──

  defp collect_items(turn_result) do
    pending = get_in(turn_result, [:adoption_state, :pending]) || []

    Enum.flat_map(pending, fn p ->
      payload = Map.get(p, :payload, %{})
      Map.get(payload, :items, [])
    end)
  end

  # ── report ──

  defp summary_line(cases, pairwise, case_failures) do
    case_count = length(cases)
    "[I2] cases=#{case_count} pairs=#{pairwise.pair_count} disjoint=#{pairwise.pair_count - length(pairwise.violations)} violations=#{length(pairwise.violations)} case_failures=#{length(case_failures)}"
  end

  defp write_json(path, cases, pairwise, case_failures) do
    json =
      Jason.encode!(
        %{
          generated_at: DateTime.utc_now() |> DateTime.to_iso8601(),
          invariant: "I2-input-variation",
          cases: cases,
          pairwise_disjoint: pairwise.ok,
          pair_count: pairwise.pair_count,
          violations: pairwise.violations,
          case_failures: Enum.map(case_failures, & &1.case)
        },
        pretty: true
      )

    File.write!(path, json)
  end

  defp write_markdown(path, cases, pairwise, case_failures) do
    summary_line = summary_line(cases, pairwise, case_failures)

    header = """
    # I2 输入差异验证报告

    > 不变量：[`docs/engineering/scenario-invariants.md`](../../docs/engineering/scenario-invariants.md) §2.2
    > slice：[`tasks/slices/SI-004-scenario-invariants-i2-variation.md`](../../tasks/slices/SI-004-scenario-invariants-i2-variation.md)
    > 生成时间：#{DateTime.utc_now() |> DateTime.to_iso8601()}

    ## 概览

    #{summary_line}

    判定：N 个语义独立的输入通过真实主链产出 artifact items，每个 case 的 item_id 集合两两必须不相交。任一对相交 → I2 violation。退出码：任何相交 → exit 1。

    """

    cases_md = cases |> Enum.map(&render_case/1) |> Enum.join("\n\n")
    pairs_md = render_pairs(pairwise.pairs)

    body =
      header <>
        "## 各 case 的 item_id 集合\n\n" <>
        cases_md <>
        "\n\n## 两两不相交判定\n\n" <>
        pairs_md <>
        fix_path_hint(pairwise, case_failures)

    File.write!(path, body)
  end

  defp render_case(c) do
    """
    ### #{c.case} — #{c.topic}

    - **outcome**：#{c.outcome}
    - **item_count**：#{c.item_count}
    - **item_ids**：#{format_id_list(c.item_ids)}#{render_case_error(c)}
    """
  end

  defp render_case_error(%{outcome: :error, detail: detail}), do: "\n- **error**：#{detail}"
  defp render_case_error(_), do: ""

  defp format_id_list([]), do: "(empty)"

  defp format_id_list(ids) do
    ids |> Enum.map(&"`#{&1}`") |> Enum.join(", ")
  end

  defp render_pairs([]), do: "_（只有 0-1 个 case，无法判定 pairwise）_\n"

  defp render_pairs(pairs) do
    pairs
    |> Enum.map(fn p ->
      icon = if p.disjoint, do: "✅", else: "❌"

      base =
        "- #{icon} #{p.left} × #{p.right}: " <>
          if p.disjoint, do: "disjoint", else: "**INTERSECTION**"

      if p.disjoint do
        base
      else
        base <>
          "\n  - left=#{format_id_list(p.left_ids)}\n  - right=#{format_id_list(p.right_ids)}\n  - shared=#{format_id_list(p.intersection)}"
      end
    end)
    |> Enum.join("\n")
  end

  defp fix_path_hint(pairwise, case_failures) do
    parts =
      [
        if(pairwise.ok, do: nil, else: pairwise_fix(pairwise.violations)),
        if(case_failures == [], do: nil, else: case_failure_fix(case_failures))
      ]
      |> Enum.reject(&is_nil/1)

    case parts do
      [] -> "\n"
      _ -> "\n\n" <> Enum.join(parts, "\n\n") <> "\n"
    end
  end

  defp pairwise_fix(violations) do
    """
    ## 修复方向（I2 pairwise violation）

    检测到 #{length(violations)} 对 case 的 item_id 集合相交，意味着：

    1. **Provider/stub 在不同输入上返回相同 item_id** —
       检查 `NovelAgent.Provider.Stub.creative_items_json/1` 是否让 item_id 与 user input 关联（如 phash2(user_excerpt)）
    2. **产品代码可能 hardcoded items** — I3 driver 通常也会同时 fail，先看 I3 报告
    3. **产品代码 hardcoded 后重写 item_id** — 检查 Toolbox/Builder 是否对 item_id 做了任何 transform
    4. 参考 `docs/engineering/scenario-invariants.md` §2.2\
    """
  end

  defp case_failure_fix(case_failures) do
    names = case_failures |> Enum.map(& &1.case) |> Enum.join(", ")

    """
    ## 修复方向（I2 case-level failure）

    case 失败（error 或 item_count=0）：#{names}

    1. 检查主链是否走到 tool dispatch（generate_micro_plan 是否 true？plan 是否触发 allow_tool？）
    2. 检查 stub provider 是否在该 prompt 上返回合法 JSON（用 I3 driver 报告交叉验证）
    3. case 无 items 时 pairwise 判定无意义，driver 主动 fail 以避免误判 ok\
    """
  end
end

I2VariationDriver.run()
