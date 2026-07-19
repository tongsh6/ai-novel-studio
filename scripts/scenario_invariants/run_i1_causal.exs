# I1 因果绑定（Causal Binding）验证 driver
#
# 不变量定义：docs/engineering/scenario-invariants.md §2.1
# slice 任务：tasks/slices/SI-003-scenario-invariants-i1-causal.md
#
# 运行：
#   MIX_ENV=test mix run scripts/scenario_invariants/run_i1_causal.exs
#
# 设计：
# - driver 注入 traced provider execution dependency，包裹 `NovelAgent.Provider.Gateway.complete/1`。
#   每次调用记录 (provider_call_id, prompt, raw_response) 到 Agent。返回 map 附
#   :provider_call_id —— Toolbox.handle_provider_content 从中取出，写入每个
#   item 的 :provider_call_ref。
# - 跑 N 个 case，对每个 artifact item 做 forall-exists 精确字节判定：
#     item.provider_call_ref ∈ traced calls
#     且 raw_response 解析得到的同 item_id 的 raw_item 在 title/body/rationale
#     三字段上与 item 精确字节相等。
# - 任一不满足 → I1 violation，driver exit 1。
#
# 报告输出：
#   artifacts/scenario-invariants/i1.md
#   artifacts/scenario-invariants/i1.json

defmodule I1CausalDriver do
  @moduledoc false

  alias NovelAgent.Provider.Execution
  alias NovelAgent.Provider.Gateway
  alias NovelAgent.Provider.Result, as: ProviderResult
  alias NovelApplication.AgentRunService
  alias NovelApplication.DialoguePlanningService

  @cases [
    %{
      name: "chapter-plan",
      topic: "10 万字章节计划",
      instruction: "请基于以下主题生成一份章节计划。请把这串标识符原样嵌入到每个章节的标题或正文中至少一处："
    },
    %{
      name: "character-seed",
      topic: "末日科幻人物草案",
      instruction: "请基于以下主题设计三位主角候选。请把这串标识符原样嵌入到至少一个候选的描述中："
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

    write_markdown("artifacts/scenario-invariants/i1.md", results)
    write_json("artifacts/scenario-invariants/i1.json", results)

    summary = summarize(results)
    IO.puts("\n" <> summary.line)

    if summary.failed > 0 or summary.errored > 0 do
      System.halt(1)
    end
  end

  # ── one case ──

  defp run_case(c) do
    {:ok, trace_agent} = Agent.start_link(fn -> [] end)
    nonce = gen_nonce()
    text = compose_input(c, nonce)

    input = %{
      text: text,
      workspace_id: "i1-driver-#{c.name}"
    }

    result_fn = build_traced_result_fn(trace_agent)

    try do
      case run_main_chain(input, provider_execution(result_fn)) do
        {:ok, turn_result} ->
          calls = Agent.get(trace_agent, & &1) |> Enum.reverse()
          evaluate(c, nonce, turn_result, calls)

        {:error, reason} ->
          %{
            case: c.name,
            nonce: nonce,
            outcome: :error,
            detail: "judgment main chain error: #{inspect(reason)}"
          }
      end
    rescue
      e ->
        %{
          case: c.name,
          nonce: nonce,
          outcome: :error,
          detail: "exception: #{Exception.message(e)}"
        }
    after
      Agent.stop(trace_agent)
    end
  end

  defp provider_execution(result_fn), do: %Execution{result_fn: result_fn}

  # ── 判断纪元主链（2026-07 帧退役批次 2）──
  #
  # DialogueGateway.handle_input（帧链）随帧纪元退役。真实主链与 Channel 同构：
  # DialoguePlanningService.plan_agent_run 产 run spec → AgentRunService.start_bounded
  # 跑判断循环（判断① → 能力 profile 执行 → Toolbox）→ 事件流取最终 turn_result。
  # 判定语义（items 精确字节回溯 Provider 响应）不变。

  @terminal_event_types [:run_completed, :awaiting_author, :run_failed]
  @agent_run_timeout_ms 120_000

  defp run_main_chain(input, provider_execution) do
    with {:ok, spec} <- DialoguePlanningService.plan_agent_run(input, nil, provider_execution),
         me = self(),
         {:ok, _run_id} <-
           AgentRunService.start_bounded(
             spec.run_attrs,
             next_step_planner: spec.next_step_planner,
             event_sink: fn event -> send(me, {:agent_event, event}) end
           ) do
      await_turn_result(nil)
    end
  end

  defp await_turn_result(last_turn_result) do
    receive do
      {:agent_event, event} ->
        turn_result = event_turn_result(event) || last_turn_result
        event_type = Map.get(event, :event_type)

        cond do
          event_type == :run_failed ->
            {:error, {:run_failed, Map.get(event, :summary)}}

          event_type in @terminal_event_types ->
            if is_map(turn_result), do: {:ok, turn_result}, else: {:error, :no_turn_result}

          true ->
            await_turn_result(turn_result)
        end
    after
      @agent_run_timeout_ms -> {:error, :agent_run_timeout}
    end
  end

  defp event_turn_result(event) do
    case Map.get(event, :payload) do
      %{turn_result: turn_result} when is_map(turn_result) -> turn_result
      _ -> nil
    end
  end

  defp compose_input(c, nonce) do
    "#{c.instruction}#{nonce}。主题：#{c.topic}。要求标识符 #{nonce} 必须原样保留至少一处。"
  end

  # ── traced result_fn ──
  #
  # wrap Gateway.complete/1，每次调用：
  # 1. 生成 provider_call_id
  # 2. 调真实 Gateway（test env 是 NovelAgent.Provider.Stub）
  # 3. 记录 (call_id, prompt, raw_response) 到 Agent
  # 4. 返回 map 附 :provider_call_id 让 Toolbox.handle_provider_content 提取写入 items

  # 判断纪元协议是双段 native tool call：包裹必须整形保留 Gateway 结果的全部字段
  # （尤其 tool_calls / provider_output），只附加 provider_call_id 供
  # Toolbox.handle_provider_content 写入 items 的 provider_call_ref。
  defp build_traced_result_fn(trace_agent) do
    fn prompt ->
      call_id = "pc_" <> Integer.to_string(System.unique_integer([:positive, :monotonic]))

      case Gateway.complete(prompt) do
        {:ok, %ProviderResult{content: content} = result} ->
          Agent.update(trace_agent, fn calls ->
            [%{provider_call_id: call_id, prompt: prompt, raw_response: content} | calls]
          end)

          {:ok, result |> Map.from_struct() |> Map.put(:provider_call_id, call_id)}

        {:ok, content} when is_binary(content) ->
          Agent.update(trace_agent, fn calls ->
            [%{provider_call_id: call_id, prompt: prompt, raw_response: content} | calls]
          end)

          {:ok, %{content: content, provider_call_id: call_id}}

        {:error, _} = err ->
          err

        other ->
          {:error, %{message: "unexpected Gateway return: #{inspect(other)}"}}
      end
    end
  end

  # ── evaluate ──

  defp evaluate(c, nonce, turn_result, calls) do
    items = collect_items(turn_result)

    cond do
      items == [] ->
        %{
          case: c.name,
          nonce: nonce,
          outcome: :indeterminate,
          detail: "no artifact items produced on this turn — turn 未走到 tool dispatch 路径",
          item_count: 0,
          call_count: length(calls)
        }

      true ->
        item_results = Enum.map(items, &judge_item(&1, calls))
        failures = Enum.filter(item_results, &(&1.outcome == :fail))

        overall =
          cond do
            failures == [] -> :pass
            true -> :fail
          end

        %{
          case: c.name,
          nonce: nonce,
          outcome: overall,
          detail:
            if(overall == :pass,
              do: "#{length(item_results)} items 全部精确字节回溯到 Provider 响应",
              else: "#{length(failures)}/#{length(item_results)} items I1 violation"
            ),
          item_count: length(item_results),
          call_count: length(calls),
          items: item_results
        }
    end
  end

  defp judge_item(item, calls) do
    call_ref = Map.get(item, :provider_call_ref)

    cond do
      is_nil(call_ref) ->
        %{
          item_id: Map.get(item, :item_id),
          outcome: :fail,
          reason: "item.provider_call_ref is nil — 无法追溯到 Provider 调用",
          item_title: Map.get(item, :title)
        }

      true ->
        case Enum.find(calls, &(&1.provider_call_id == call_ref)) do
          nil ->
            %{
              item_id: Map.get(item, :item_id),
              outcome: :fail,
              reason: "provider_call_ref #{call_ref} 不在本 turn 的 traced calls 集合中",
              item_title: Map.get(item, :title)
            }

          call ->
            compare_against_raw(item, call)
        end
    end
  end

  defp compare_against_raw(item, call) do
    case Jason.decode(call.raw_response |> strip_code_fence() |> String.trim()) do
      {:ok, raw_items} when is_list(raw_items) ->
        item_id = Map.get(item, :item_id)
        raw_item = Enum.find(raw_items, &(Map.get(&1, "item_id") == item_id))

        cond do
          is_nil(raw_item) ->
            %{
              item_id: item_id,
              outcome: :fail,
              reason: "raw_response 中找不到 item_id=#{item_id} 的 raw_item",
              item_title: Map.get(item, :title)
            }

          true ->
            compare_fields(item, raw_item)
        end

      _ ->
        %{
          item_id: Map.get(item, :item_id),
          outcome: :fail,
          reason: "raw_response 不是合法 JSON 数组，无法解析为 items",
          item_title: Map.get(item, :title)
        }
    end
  end

  defp compare_fields(item, raw_item) do
    mismatches =
      [
        compare_field(item, raw_item, :title, "title"),
        compare_field(item, raw_item, :body, "body"),
        compare_field(item, raw_item, :rationale, "rationale")
      ]
      |> Enum.reject(&is_nil/1)

    if mismatches == [] do
      %{
        item_id: Map.get(item, :item_id),
        outcome: :pass,
        reason: "title/body/rationale 全部精确字节相等",
        item_title: Map.get(item, :title)
      }
    else
      %{
        item_id: Map.get(item, :item_id),
        outcome: :fail,
        reason: "字段不等：#{Enum.join(mismatches, "; ")}",
        item_title: Map.get(item, :title)
      }
    end
  end

  # 返回不等描述或 nil（相等）
  defp compare_field(item, raw_item, atom_key, string_key) do
    actual = Map.get(item, atom_key)
    expected = Map.get(raw_item, string_key)

    cond do
      # 两侧都 nil — 相等
      is_nil(actual) and is_nil(expected) ->
        nil

      # 精确字节相等
      actual == expected ->
        nil

      # 不等
      true ->
        "#{string_key}: item=#{inspect(actual_excerpt(actual))} vs raw=#{inspect(actual_excerpt(expected))}"
    end
  end

  defp actual_excerpt(s) when is_binary(s), do: String.slice(s, 0, 60)
  defp actual_excerpt(nil), do: "(nil)"
  defp actual_excerpt(other), do: inspect(other)

  defp strip_code_fence(content) do
    content
    |> String.replace(~r/^```(?:json)?\s*/, "")
    |> String.replace(~r/```\s*$/, "")
  end

  # ── collect items from turn_result ──

  defp collect_items(turn_result) do
    pending = get_in(turn_result, [:adoption_state, :pending]) || []

    Enum.flat_map(pending, fn p ->
      payload = Map.get(p, :payload, %{})
      Map.get(payload, :items, [])
    end)
  end

  # ── nonce ──

  defp gen_nonce do
    alphabet = ~c"ABCDEFGHJKLMNPQRSTUVWXYZ23456789"

    for _ <- 1..8, into: "", do: <<Enum.random(alphabet)>>
  end

  # ── report ──

  defp summarize(results) do
    passed = Enum.count(results, &(&1.outcome == :pass))
    failed = Enum.count(results, &(&1.outcome == :fail))
    errored = Enum.count(results, &(&1.outcome == :error))
    indeterminate = Enum.count(results, &(&1.outcome == :indeterminate))

    %{
      passed: passed,
      failed: failed,
      errored: errored,
      indeterminate: indeterminate,
      line:
        "[I1] cases=#{length(results)} pass=#{passed} fail=#{failed} indeterminate=#{indeterminate} error=#{errored}"
    }
  end

  defp write_json(path, results) do
    json =
      Jason.encode!(
        %{
          generated_at: DateTime.utc_now() |> DateTime.to_iso8601(),
          invariant: "I1-causal-binding",
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
    # I1 因果绑定验证报告

    > 不变量：[`docs/engineering/scenario-invariants.md`](../../docs/engineering/scenario-invariants.md) §2.1
    > slice：[`tasks/slices/SI-003-scenario-invariants-i1-causal.md`](../../tasks/slices/SI-003-scenario-invariants-i1-causal.md)
    > 生成时间：#{DateTime.utc_now() |> DateTime.to_iso8601()}

    ## 概览

    #{summary.line}

    每个 case 跑完整主链（DialogueGateway.handle_input → Planner → Toolbox），driver 注入 traced result_fn 包裹 `Gateway.complete/1`。对每个 artifact item 做 forall-exists 精确字节判定：

    - `item.provider_call_ref` 必须非 nil 且能在 traced calls 中找到对应 raw_response
    - 该 raw_response 解析得到的同 item_id 的 raw_item 在 `title/body/rationale` 三字段上必须 **精确字节相等**

    任一不满足 → I1 violation。退出码：任何 case 任何 item fail → exit 1。

    """

    cases_md = results |> Enum.map(&render_case/1) |> Enum.join("\n\n---\n\n")

    File.write!(path, header <> "## 用例\n\n" <> cases_md <> "\n")
  end

  defp render_case(r) do
    icon =
      case r.outcome do
        :pass -> "✅"
        :fail -> "❌"
        :indeterminate -> "⚪"
        :error -> "⚠️"
      end

    base = """
    ### case：#{r.case}

    - **outcome**：#{icon} #{r.outcome}
    - **nonce**：`#{r.nonce}`
    - **item_count**：#{Map.get(r, :item_count, 0)}
    - **call_count**：#{Map.get(r, :call_count, 0)}
    - **detail**：#{r.detail}
    """

    case Map.get(r, :items) do
      nil ->
        base

      items_list ->
        items_md =
          items_list
          |> Enum.map(&render_item/1)
          |> Enum.join("\n")

        base <> "\n**Items**：\n" <> items_md <> "\n" <> fix_path_hint(r)
    end
  end

  defp render_item(it) do
    icon =
      case it.outcome do
        :pass -> "✅"
        :fail -> "❌"
        _ -> "⚪"
      end

    "- #{icon} `#{it.item_id || "(no id)"}` (#{it.item_title || "—"}) — #{it.reason}"
  end

  defp fix_path_hint(%{outcome: :fail}) do
    """

    - **修复方向**（I1 fail）：产品代码修改了 Provider 响应字节 —
      1. 检查 `NovelApplication.Toolbox.handle_provider_content` 是否对 items 做了任何 transform / 补齐 / 翻译 / 合并
      2. 检查 `NovelApplication.TurnResultBuilder.build_artifact_set` 是否对 items 做了任何字段改写
      3. 字节透传契约：从 `result_fn` 返回的 raw_response 解析出 items 后，每个 item 的 title/body/rationale 必须原样进入 artifact，不允许任何中间处理
      4. 参考 `docs/engineering/scenario-invariants.md` §2.1
    """
  end

  defp fix_path_hint(_), do: ""
end

I1CausalDriver.run()
