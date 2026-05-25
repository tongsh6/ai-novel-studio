# I3 种子贯通（Nonce Propagation）验证 driver
#
# 不变量定义：docs/engineering/scenario-invariants.md §2.3
# slice 任务：tasks/slices/SI-001-scenario-invariants-i3-nonce.md
#            tasks/slices/SI-002-scenario-invariants-ci-enforcement.md
#
# 运行：
#   MIX_ENV=test mix run scripts/scenario_invariants/run_i3_nonce.exs
#
# 设计：
# - driver 通过 `&NovelAgent.Provider.Gateway.complete/1` 注入 complete_fn。
#   MIX_ENV=test 时默认 provider 是 NovelAgent.Provider.Stub（合法 fixture），
#   它根据 prompt 自动返回最小合法 JSON 并把 user 文本（含 nonce）字节透传。
# - 通过真实入口 NovelApplication.DialogueGateway.handle_input/3 注入 N 个独立输入
# - 每个输入嵌入一次性随机 nonce
# - 双层检查：
#     Layer-A（主链，参考性）：handle_input → Planner → 可能 Toolbox → TurnResult，
#       检查 assistant_message / candidate_directions / tool_result.output / artifact items
#     Layer-B（直接 Toolbox.execute，决定性）：定向打工具层，检查 ToolResult.output.items
# - 退出码只取决于 Layer-B。Layer-A fail 不影响 exit code（informational）
#
# 报告输出：
#   artifacts/scenario-invariants/i3.md
#   artifacts/scenario-invariants/i3.json

defmodule I3NonceDriver do
  @moduledoc false

  alias NovelAgent.Provider.Gateway
  alias NovelAgent.Toolbox
  alias NovelApplication.DialogueGateway
  alias NovelCommon.Contracts.ToolRequest

  @cases [
    %{
      name: "chapter-plan",
      topic: "10 万字章节计划",
      instruction:
        "请基于以下主题生成一份章节计划。请把这串标识符原样嵌入到每个章节的标题或正文中至少一处："
    },
    %{
      name: "character-seed",
      topic: "末日科幻人物草案",
      instruction: "请基于以下主题生成三个主角候选。请把这串标识符原样嵌入到至少一个候选的描述中："
    },
    %{
      name: "prose-fragment",
      topic: "古风武侠开篇正文",
      instruction: "请基于以下主题生成一段开篇正文。请把这串标识符原样嵌入到正文里至少一处："
    }
  ]

  def run do
    File.mkdir_p!("artifacts/scenario-invariants")

    results = Enum.map(@cases, &run_case/1)

    write_markdown("artifacts/scenario-invariants/i3.md", results)
    write_json("artifacts/scenario-invariants/i3.json", results)

    summary = summarize(results)
    IO.puts("\n" <> summary.line)

    if summary.failed > 0 or summary.errored > 0 do
      System.halt(1)
    end
  end

  # ── one case ──

  defp run_case(c) do
    nonce = gen_nonce()
    text = compose_input(c, nonce)

    input = %{
      text: text,
      workspace_id: "i3-driver-#{c.name}",
      generate_micro_plan: true
    }

    complete_fn = build_stub_complete_fn(nonce)

    layer_a =
      try do
        case DialogueGateway.handle_input(input, nil, complete_fn) do
          {:ok, turn_result, _trace, _candidates, _context} ->
            {:ok, turn_result}

          {:error, reason} ->
            {:error, "DialogueGateway error: #{inspect(reason)}"}
        end
      rescue
        e -> {:error, "exception: #{Exception.message(e)}"}
      end

    layer_b =
      try do
        run_layer_b_direct(c, nonce)
      rescue
        e -> {:error, "exception: #{Exception.message(e)}"}
      end

    evaluate(c, nonce, layer_a, layer_b)
  end

  # ── Layer-B: 直接调 Toolbox.execute，旁路 Planner ──
  # 目的：定向打工具运行时层，验证 Toolbox 是否真的把用户输入透传到 ToolResult。
  # 如果 Toolbox 是 hardcoded 假实现，nonce 永远不会出现在 output.items。

  defp run_layer_b_direct(c, nonce) do
    complete_fn = build_stub_complete_fn(nonce)

    req = %ToolRequest{
      tool_request_id: "tr_i3_#{c.name}_#{:rand.uniform(999_999)}",
      turn_id: "i3_turn_#{c.name}",
      frame_ref: "i3_frame_#{c.name}",
      decision_ref: "i3_decision_#{c.name}",
      tool_name: tool_name_for(c.name),
      tool_version: "1.0.0",
      plan_ref: "i3_plan_#{c.name}",
      input: %{
        "text" => "请基于以下内容生成创作产物，必须将标识符 #{nonce} 原样嵌入输出至少一处。主题：#{c.topic}",
        "creative_brief" =>
          "标识符：#{nonce}。这是来自用户输入的一次性串，工具必须在 items 的 title/body/rationale 任一字段保留 #{nonce}。"
      },
      read_scope_grants: ["author_text"],
      write_scope_grants: [],
      idempotency_key: "i3_idem_#{c.name}_#{:rand.uniform(999_999)}",
      trace_policy: %{},
      created_at: DateTime.utc_now()
    }

    {:ok, Toolbox.execute(req, complete_fn)}
  end

  defp tool_name_for("character-seed"), do: "character_design"
  defp tool_name_for("prose-fragment"), do: "prose_writing"
  defp tool_name_for(_), do: "plot_outline"

  defp compose_input(c, nonce) do
    "#{c.instruction}#{nonce}。主题：#{c.topic}。要求标识符 #{nonce} 必须原样保留至少一处。"
  end

  # ── evaluation ──

  defp evaluate(c, nonce, layer_a_in, layer_b_in) do
    layer_a_eval =
      case layer_a_in do
        {:ok, turn_result} ->
          strings = collect_planner_strings(turn_result) ++ collect_artifact_strings(turn_result)

          layer_outcome(
            strings,
            nonce,
            "Layer-A 主链路径（handle_input → Planner → 可能 Toolbox → TurnResult）"
          )

        {:error, msg} ->
          %{outcome: :error, detail: msg}
      end

    layer_b_eval =
      case layer_b_in do
        {:ok, tool_result} ->
          strings = collect_tool_result_strings(tool_result)

          layer_outcome(
            strings,
            nonce,
            "Layer-B 直接 Toolbox.execute（定向打工具层 → ToolResult.output.items）"
          )

        {:error, msg} ->
          %{outcome: :error, detail: msg}
      end

    turn_result =
      case layer_a_in do
        {:ok, tr} -> tr
        _ -> %{}
      end

    %{
      case: c.name,
      nonce: nonce,
      layer_a: layer_a_eval,
      layer_b: layer_b_eval,
      turn_id: Map.get(turn_result, :turn_id),
      frame_type: get_in(turn_result, [:frame_summary, :frame_type]),
      layer_a_has_artifact: collect_artifact_strings(turn_result) != []
    }
  end

  defp collect_tool_result_strings(%{output: output}) when is_map(output) do
    items = Map.get(output, :items, []) ++ Map.get(output, "items", [])

    Enum.flat_map(items, fn item ->
      [
        maybe_get(item, :title),
        maybe_get(item, :body),
        maybe_get(item, :rationale),
        maybe_get(item, "title"),
        maybe_get(item, "body"),
        maybe_get(item, "rationale")
      ]
    end)
    |> Enum.reject(&is_nil/1)
  end

  defp collect_tool_result_strings(_), do: []

  defp layer_outcome([], _nonce, layer_label) do
    %{
      outcome: :indeterminate,
      detail: "no text observed on this layer — #{layer_label} 未在本次 turn 产出可观察字符串"
    }
  end

  defp layer_outcome(strings, nonce, layer_label) do
    if Enum.any?(strings, fn s -> is_binary(s) and String.contains?(s, nonce) end) do
      %{outcome: :pass, detail: "nonce found on #{layer_label}"}
    else
      sample =
        strings
        |> Enum.filter(&is_binary/1)
        |> Enum.map(&String.slice(&1, 0, 80))
        |> Enum.take(3)

      %{
        outcome: :fail,
        detail:
          "I3 violation on #{layer_label}: 该层产出文本未包含本次 nonce，意味着内容未来自包含 nonce 的用户输入透传链路",
        excerpts: sample
      }
    end
  end

  # ── collect strings from turn_result ──

  defp collect_planner_strings(turn_result) do
    [
      get_in(turn_result, [:assistant_message, :text]),
      get_in(turn_result, [:tool_result, :output]) |> stringify_value()
    ]
    ++ collect_candidate_strings(turn_result)
    |> List.flatten()
    |> Enum.reject(&is_nil/1)
  end

  defp collect_candidate_strings(turn_result) do
    case Map.get(turn_result, :candidate_directions) do
      list when is_list(list) ->
        Enum.flat_map(list, fn cd ->
          [
            Map.get(cd, :summary),
            Map.get(cd, :rationale),
            Map.get(cd, :title)
          ]
        end)

      _ ->
        []
    end
  end

  # 只检查 items[*] 的 title/body/rationale。payload.title 是 UI 卡片标题，
  # 属于不变量明确不约束的 UI 文案（scenario-invariants.md §4）。
  defp collect_artifact_strings(turn_result) do
    pending = get_in(turn_result, [:adoption_state, :pending]) || []

    Enum.flat_map(pending, fn p ->
      payload = Map.get(p, :payload, %{})
      items = Map.get(payload, :items, [])

      Enum.flat_map(items, fn item ->
        [
          maybe_get(item, :title),
          maybe_get(item, :body),
          maybe_get(item, :rationale)
        ]
      end)
    end)
    |> Enum.reject(&is_nil/1)
  end

  defp maybe_get(item, k) when is_map(item) do
    case Map.get(item, k) do
      v when is_binary(v) -> v
      _ -> nil
    end
  end

  defp maybe_get(_, _), do: nil

  defp stringify_value(nil), do: nil
  defp stringify_value(s) when is_binary(s), do: s

  defp stringify_value(m) when is_map(m) do
    m
    |> Map.values()
    |> Enum.filter(&is_binary/1)
    |> Enum.join("\n")
  end

  defp stringify_value(_), do: nil

  # ── complete_fn 注入 ──
  #
  # SI-002 起：driver 不再自行 mock LLM 响应，而是直接走 `Gateway.complete/1`。
  # 在 MIX_ENV=test 下默认 provider 是 `NovelAgent.Provider.Stub`，它已被升级为合法
  # fixture provider（识别 frame/plan/creative items prompt，分别返回最小合法
  # JSON，并把 user 输入字节透传到 creative items 的 body）。
  #
  # 这样 driver 只负责"像用户一样输入 + 检查输出"，stub 的 fixture 角色集中在
  # 单一位置，符合 scenario-acceptance.md §3 允许项。
  #
  # 注：参数 nonce 保留是为了未来扩展（SI-003/004 可能需要在 closure 里持有 nonce）。

  defp build_stub_complete_fn(_nonce), do: &Gateway.complete/1

  # ── nonce ──

  defp gen_nonce do
    alphabet = ~c"ABCDEFGHJKLMNPQRSTUVWXYZ23456789"

    for _ <- 1..8, into: "", do: <<Enum.random(alphabet)>>
  end

  # ── report ──

  # SI-001 判定边界：本 slice 闭环 Toolbox 路径（Layer-B）。
  # Layer-A（主链 handle_input → Planner）的 nonce 透传由 SI-002 升级 stub 后闭环。
  # 因此 driver 的 exit code 只依赖 Layer-B；Layer-A 输出为 informational。
  defp summarize(results) do
    passed = Enum.count(results, &layer_b_pass?/1)
    failed = Enum.count(results, &layer_b_fail?/1)
    errored = Enum.count(results, &layer_b_error?/1)
    indeterminate = length(results) - passed - failed - errored

    layer_a_pass = Enum.count(results, &(&1.layer_a.outcome == :pass))
    layer_a_fail = Enum.count(results, &(&1.layer_a.outcome == :fail))

    %{
      passed: passed,
      failed: failed,
      errored: errored,
      indeterminate: indeterminate,
      layer_a_pass: layer_a_pass,
      layer_a_fail: layer_a_fail,
      line:
        "[I3] Layer-B(决定性) cases=#{length(results)} pass=#{passed} fail=#{failed} indeterminate=#{indeterminate} error=#{errored} | Layer-A(参考) pass=#{layer_a_pass} fail=#{layer_a_fail}"
    }
  end

  defp layer_b_pass?(r), do: r.layer_b.outcome == :pass
  defp layer_b_fail?(r), do: r.layer_b.outcome == :fail
  defp layer_b_error?(r), do: r.layer_b.outcome == :error

  defp write_json(path, results) do
    json =
      Jason.encode!(
        %{
          generated_at: DateTime.utc_now() |> DateTime.to_iso8601(),
          invariant: "I3-nonce-propagation",
          cases: results,
          summary: summarize(results) |> Map.delete(:line)
        },
        pretty: true
      )

    File.write!(path, json)
  end

  defp write_markdown(path, results) do
    summary = summarize(results)

    header = """
    # I3 种子贯通验证报告

    > 不变量：[`docs/engineering/scenario-invariants.md`](../../docs/engineering/scenario-invariants.md) §2.3
    > slice：[`tasks/slices/SI-001-scenario-invariants-i3-nonce.md`](../../tasks/slices/SI-001-scenario-invariants-i3-nonce.md)
    > 生成时间：#{DateTime.utc_now() |> DateTime.to_iso8601()}

    ## 概览

    #{summary.line}

    每个 case 分两层评估：
    - **Layer-A（主链 handle_input → Planner，informational）**：反映完整主链 nonce 透传情况，检查 `assistant_message` / `candidate_directions` / `tool_result.output` / `artifact items`。SI-002 后已闭环（stub 升级为合法 fixture）
    - **Layer-B（直接 Toolbox.execute，决定性）**：定向打工具层，检查 `ToolResult.output.items` 的 title/body/rationale 是否包含本次 nonce

    **退出码只取决于 Layer-B**：Layer-B 全 pass → exit 0；任何 fail → exit 1。Layer-A 状态用于诊断主链路径，不影响 exit code。

    """

    cases_md = results |> Enum.map(&render_case/1) |> Enum.join("\n\n---\n\n")

    File.write!(path, header <> "## 用例\n\n" <> cases_md <> "\n")
  end

  defp render_case(r) do
    base = """
    ### case：#{r.case}

    - **nonce**：`#{r.nonce}`
    - **turn_id**（Layer-A）：`#{Map.get(r, :turn_id) || "—"}`
    - **frame_type**（Layer-A）：`#{Map.get(r, :frame_type) || "—"}`
    - **layer_a_has_artifact**：#{Map.get(r, :layer_a_has_artifact, false)}
    - **Layer-A（主链 handle_input）**：#{layer_md(r.layer_a)}
    - **Layer-B（直接 Toolbox.execute）**：#{layer_md(r.layer_b)}
    """

    base <> fix_path_hint(r)
  end

  defp layer_md(layer) do
    icon =
      case layer.outcome do
        :pass -> "✅"
        :fail -> "❌"
        :indeterminate -> "⚪"
        :error -> "⚠️"
      end

    excerpts =
      case Map.get(layer, :excerpts) do
        nil ->
          ""

        list when is_list(list) ->
          "\n  - excerpts: #{Enum.map(list, &("`" <> &1 <> "`")) |> Enum.join("; ")}"
      end

    "#{icon} **#{layer.outcome}** — #{layer.detail}#{excerpts}"
  end

  defp fix_path_hint(r) do
    cond do
      r.layer_a.outcome == :fail and r.layer_b.outcome == :fail ->
        """

        - **修复方向**（两层都 fail）：
          1. **Layer-B 是根本违规**：`NovelApplication.Toolbox.execute/1` 必须接收 `complete_fn` 参数，creative_generation 路径必须调用 `Gateway.complete`，并把 Provider 响应字节透传到 `ToolResult.output.items`
          2. 删除 `NovelApplication.Toolbox.generate_creative_items/2` 中的所有 hardcoded items 分支
          3. **Layer-A 是连锁问题**：修好 Layer-B 后，主链才能产出含 nonce 的 artifact
          4. 同时检查 `DialogueGateway.creative_direction/2` 的中文关键词路由 — 应删除，direction 由 frame.tool_need 或 plan 决定
          5. 参考 `docs/engineering/scenario-invariants.md` §2.3 + §5.2
        """

      r.layer_b.outcome == :fail ->
        """

        - **修复方向**（Layer-B fail）：Toolbox 工具运行时未透传用户输入到输出 —
          1. `NovelApplication.Toolbox.execute/1` 接收 `complete_fn`，creative_generation 调用 `Gateway.complete`
          2. 解析 Provider 响应，字节透传到 `ToolResult.output.items`
          3. 删除 `generate_creative_items/2` 的 hardcoded 分支
          4. 参考 `docs/engineering/scenario-invariants.md` §2.3
        """

      r.layer_a.outcome == :fail ->
        """

        - **修复方向**（Layer-A fail）：主链 handle_input 路径未透传 nonce 到 turn_result —
          1. 确认 Planner 的 prompt template 包含用户原文（应已包含，检查 form_frame/form_micro_plan）
          2. 确认 Provider 响应解析路径不丢字段
        """

      true ->
        ""
    end
  end
end

I3NonceDriver.run()
