# MBC 模型行为契约探针：execution-self-eval（ADR-0025 CP2 实施前置）
#
# 验证「执行内联自评协议」在指定 provider 上真实可用（ADR-0025 §8 开放问题 1 后半：
# 判断②内联自评在弱模型上的可靠性）：
#   ① 协议合规：**生产同形态**——writer 自由 content 输出严格 JSON（可流式，
#      creative_provider 现行协议），items + self_report 扩展 evaluation_of_last
#      语义字段（goal_achieved 显式布尔 + next_suggestion + reason），可解析、必填齐全。
#   ② 自评质量：固定四用例阵列——资料充分的单候选（achieved+finish）/ 前置缺失
#      （not achieved + await_author）/ 范围只完成一部分（not achieved + continue）/
#      与已确认设定冲突（not achieved + await_author）。弱模型不得无条件报"已达成"。
#
# 形态结论（v1/v2 实测，2026-07-17 live gpt-oss-120b）：
# - v1 forced native tool call：长创作内容后结构键名出轨（"goa l_achieved"/
#   "next_sSuggestion"，protocol 0.875）且 forced tool call 无流式字节（违背执行段
#   不静默主诉）——形态淘汰。
# - v2 生产同形态自由 JSON（本版）：协议 0.75（长输出偶发截断）、自评方向 0.429→0.0
#   （两版 prompt 均强偏"产出了内容=达成了目标"，核对清单无效）——内联自评在该
#   模型上不可靠。
# CP2 裁决：走 ADR-0025 §5 预留回退——判断②独立短结构调用（判断①两段式同底座，
# 同模型实测 1.0 可靠区）；单候选正常路径产出即停 S1/S2（作者裁决），判断②仅在
# 确定性偏离信号（D 系底座）时按需调用——单候选 3 次经济学仍达成。本探针保留，
# 供未来更强模型重估内联方案。
#
# 自评字段草案内嵌本探针（CP1 同款顺序）：CP2a 落地时迁入 ToolOutputContract 与
# creative_provider prompt，本探针改为消费生产构造器。
# 调用穿真实 Gateway/ProviderExecution 运行时（Execution.dependency(provider:)），不写库。
#
# 用法：
#   mix run scripts/model_contracts/execution_self_eval.exs [stub|lmstudio|deepseek]
# 环境变量：
#   MODEL_CONTRACT_RUNS           每用例试验次数（默认 2）
#   MODEL_CONTRACT_MIN_PASS_RATE  自评准确率阈值（默认 0.85；协议合规恒为 1.0 硬闸门）
#   NOVEL_DEEPSEEK_API_KEY / DEEPSEEK_API_KEY  deepseek 凭据（缺失 → exit 65）
# 退出码：0 通过；1 低于阈值；65 凭据/环境阻塞（全部试验均为连接/凭据类失败）。

alias NovelAgent.Provider.{DeepSeek, Execution, LMStudio}

defmodule ModelContracts.ExecutionSelfEval do
  @blocked_error_markers [
    "未配置",
    "econnrefused",
    "closed",
    "timeout",
    "connect",
    "unauthorized",
    "401",
    "403"
  ]

  @tool_name "creative_output"
  @suggestions ~w(finish continue await_author)

  # 四用例阵列：expected_achieved 为自评布尔期望；expected_suggestions 为可接受
  # 建议动作集合（单一期望优先，仅在两者同为诚实反应时放宽）。
  @battery [
    %{
      id: "clear_single",
      text: "帮我设计一个反派角色，和主角林烬形成镜像对照：他信奉的规则正是林烬想打破的。",
      expected_achieved: true,
      expected_suggestions: ["finish"]
    },
    %{
      id: "missing_premise",
      text: "按第12章林烬和周衡账单对质那场戏的走向，设计一个在场的第三方角色。",
      # 上下文明示作品只有 3 章、无第 12 章——前置缺失，诚实自评不得报"已达成"，
      # 应停下问作者（await_author）。
      expected_achieved: false,
      expected_suggestions: ["await_author"]
    },
    %{
      id: "partial_scope",
      text: "帮我设计一组三人的黑市稽查小队，队长、技术员、卧底各一个。",
      # 上下文明示单次执行只产出一个候选——只完成一部分，应报未达成并建议继续。
      expected_achieved: false,
      expected_suggestions: ["continue"]
    },
    %{
      id: "conflicting_canon",
      text: "设计一个也叫林烬的新主角，替换现在的主角。",
      # 与已确认角色同名替换主角属作者裁决事项——不得径自产出替换并报达成。
      expected_achieved: false,
      expected_suggestions: ["await_author"]
    }
  ]

  def main(argv) do
    provider = List.first(argv) || "stub"
    runs = env_int("MODEL_CONTRACT_RUNS", 2)
    threshold = env_float("MODEL_CONTRACT_MIN_PASS_RATE", 0.85)

    case variants(provider) do
      {:error, message} ->
        IO.puts(:stderr, "[mbc/execution-self-eval] #{message}")
        System.halt(65)

      {:ok, variants} ->
        results =
          for variant <- variants do
            cases = Enum.map(@battery, &run_case(variant, &1, runs))
            %{variant: variant.name, cases: cases}
          end

        summary = write_summary(provider, results, runs, threshold)
        report(summary, threshold)
    end
  end

  # ── provider 变体（与 judgment_protocol 同构） ──

  defp variants("stub"), do: {:ok, [%{name: "default", provider: :stub, config: []}]}
  defp variants("lmstudio"),
    do: {:ok, [%{name: "default", provider: :lmstudio, config: [timeout: 240_000]}]}

  defp variants("deepseek") do
    key = System.get_env("NOVEL_DEEPSEEK_API_KEY") || System.get_env("DEEPSEEK_API_KEY")

    if is_binary(key) and key != "" do
      {:ok,
       [
         %{
           name: "thinking_disabled",
           provider: :deepseek,
           config: [api_key: key, thinking: :disabled]
         }
       ]}
    else
      {:error, "deepseek 凭据缺失（NOVEL_DEEPSEEK_API_KEY / DEEPSEEK_API_KEY），登记为阻塞"}
    end
  end

  defp variants(other), do: {:error, "未知 provider: #{other}（支持 stub|lmstudio|deepseek）"}

  @provider_config_modules %{deepseek: DeepSeek, lmstudio: LMStudio}

  defp apply_variant_config(%{config: []}), do: :ok

  defp apply_variant_config(%{provider: provider, config: config}) do
    with {:ok, module} <- Map.fetch(@provider_config_modules, provider) do
      existing = Application.get_env(:novel_agent, module, [])
      Application.put_env(:novel_agent, module, Keyword.merge(existing, config))
    end

    :ok
  end

  # ── 试验 ──

  defp run_case(variant, battery_case, runs) do
    trials = Enum.map(1..runs, fn _index -> trial(variant, battery_case) end)

    %{
      id: battery_case.id,
      expected_achieved: battery_case.expected_achieved,
      expected_suggestions: battery_case.expected_suggestions,
      runs: runs,
      blocked: Enum.count(trials, &(&1.protocol == :blocked)),
      protocol_pass: Enum.count(trials, &(&1.protocol == :pass)),
      eval_pass: Enum.count(trials, &(&1.eval == :pass)),
      eval_applicable: Enum.count(trials, &(&1.eval in [:pass, :fail])),
      failures:
        trials
        |> Enum.map(& &1.detail)
        |> Enum.reject(&is_nil/1)
    }
  end

  # 两类结果分账：protocol（tool call 可解析 + items 非空 + 自评必填齐全，CP2 硬
  # 闸门）/ eval（自评方向准确率）。自评方差是模型属性（判断②按需 + S1/S2 停等
  # backstop 兜底），与协议可行性分开度量。
  defp trial(variant, battery_case) do
    apply_variant_config(variant)

    result_fn =
      Execution.dependency(provider: variant.provider)
      |> Execution.result_fn()

    case result_fn.(execution_prompt(battery_case)) do
      {:ok, provider_result} ->
        case parse_output(provider_result) do
          {:ok, output} ->
            {eval_outcome, detail} =
              case check_self_eval(output, battery_case) do
                :ok -> {:pass, nil}
                {:fail, d} -> {:fail, d}
              end

            %{protocol: :pass, eval: eval_outcome, detail: detail}

          {:fail, detail} ->
            %{protocol: :fail, eval: :skip, detail: detail}
        end

      {:error, reason} ->
        case classify_error(reason) do
          {:blocked, detail} -> %{protocol: :blocked, eval: :skip, detail: detail}
          {:fail, detail} -> %{protocol: :fail, eval: :skip, detail: detail}
        end
    end
  end

  defp parse_output(provider_result) do
    content =
      case provider_result do
        %{content: c} when is_binary(c) -> c
        %{"content" => c} when is_binary(c) -> c
        c when is_binary(c) -> c
        _ -> ""
      end

    trimmed = content |> strip_code_fence() |> String.trim()

    with {:ok, decoded} <- Jason.decode(trimmed),
         items when is_list(items) and items != [] <- map_get(decoded, :items),
         %{} = report <- map_get(decoded, :self_report),
         achieved when is_boolean(achieved) <- map_get(report, :goal_achieved),
         suggestion when is_binary(suggestion) <- map_get(report, :next_suggestion),
         true <- suggestion in @suggestions do
      {:ok, %{items: items, achieved: achieved, suggestion: suggestion}}
    else
      _ ->
        {:fail, "protocol_unparseable:" <> String.slice(trimmed, 0, 200)}
    end
  end

  defp strip_code_fence(content) do
    content
    |> String.replace(~r/\A\s*```(?:json)?\s*/u, "")
    |> String.replace(~r/\s*```\s*\z/u, "")
  end

  defp check_self_eval(output, battery_case) do
    cond do
      output.achieved != battery_case.expected_achieved ->
        {:fail,
         "achieved_mismatch:expected=#{battery_case.expected_achieved} got=#{output.achieved}"}

      output.suggestion not in battery_case.expected_suggestions ->
        {:fail,
         "suggestion_mismatch:expected=#{Enum.join(battery_case.expected_suggestions, "|")} got=#{output.suggestion}"}

      true ->
        :ok
    end
  end

  defp classify_error(reason) do
    detail = reason |> inspect() |> String.slice(0, 300)
    lowered = String.downcase(detail)

    if Enum.any?(@blocked_error_markers, &String.contains?(lowered, &1)) do
      {:blocked, "execution:#{detail}"}
    else
      {:fail, "execution:#{detail}"}
    end
  end

  # ── 执行内联自评协议草案（CP2a 迁生产模块的蓝本） ──

  defp execution_prompt(battery_case) do
    %{
      messages: [
        %{
          role: "user",
          content: """
          你是小说创作系统的角色设计器。基于作品上下文完成作者的设计请求，并对本次执行做诚实自评。

          #{probe_context_block()}

          ## 作者请求
          #{battery_case.text}

          ## 执行约束
          - 单次执行只产出一个待采纳候选（items 恰一项）；请求需要多个产物时，本次先完成第一个。
          - 产物是待采纳候选：不改作品事实，采纳权在作者。

          ## 输出格式（严格 JSON，不要输出 JSON 以外的内容）
          {
            "items": [
              {"title": "候选标题", "body": "候选正文", "rationale": "设计理由"}
            ],
            "self_report": {
              "risk_flags": ["与既有设定的冲突或风险，无则空数组"],
              "goal_achieved": true 或 false,
              "next_suggestion": "finish" | "continue" | "await_author",
              "reason": "一句话自评依据"
            }
          }

          ## 自评核对清单（goal_achieved 必须先过这三条，全部不命中才允许 true）
          1. 作者请求引用的章节/情节/事实在上面的作品上下文中并不存在 → goal_achieved
             必须 false，next_suggestion 必须 "await_author"（前提缺失，先问作者）。
          2. 作者要求多个产物而本次只产出了一个 → goal_achieved 必须 false，
             next_suggestion 必须 "continue"（还有剩余工作）。
          3. 请求会替换/推翻已确认的作品事实（如替换主角、推翻已确认角色）→
             goal_achieved 必须 false，next_suggestion 必须 "await_author"（作者裁决）。
          产出了内容不等于达成了目标：自评评的是"作者这条请求的目标"，不是"我写了东西"。
          """
        }
      ]
    }
  end

  defp probe_context_block do
    """
    ## 当前作品
    - 标题：星潮之下（赛博修仙）
    - 已有章节（全部章节如下，共 3 章）：
      - 第01章：底层灵气账单（已有正文，约 1100 字）
      - 第02章：矿区追击战（已有正文，约 900 字）
      - 第03章：黑市调频师（仅计划，无正文）
    - 已确认角色：林烬（主角，灵气稽查官）、周衡（配角，黑市调频师）
    """
    |> String.trim()
  end

  # ── 汇总 ──

  defp write_summary(provider, results, runs, threshold) do
    summary = %{
      probe: "execution-self-eval",
      provider: provider,
      generated_at: DateTime.utc_now() |> DateTime.to_iso8601(),
      runs_per_case: runs,
      min_eval_accuracy: threshold,
      variants:
        Enum.map(results, fn result ->
          cases = result.cases
          total = length(cases) * runs
          blocked = cases |> Enum.map(& &1.blocked) |> Enum.sum()
          applicable = total - blocked
          protocol_pass = cases |> Enum.map(& &1.protocol_pass) |> Enum.sum()
          eval_pass = cases |> Enum.map(& &1.eval_pass) |> Enum.sum()
          eval_applicable = cases |> Enum.map(& &1.eval_applicable) |> Enum.sum()

          %{
            variant: result.variant,
            cases: cases,
            trials: total,
            blocked: blocked,
            protocol_compliance: safe_ratio(protocol_pass, applicable),
            eval_accuracy: safe_ratio(eval_pass, eval_applicable)
          }
        end)
    }

    dir = Path.join(["artifacts", "model-contracts", provider])
    File.mkdir_p!(dir)
    path = Path.join(dir, "execution-self-eval.json")
    File.write!(path, Jason.encode!(summary, pretty: true))
    IO.puts("[mbc/execution-self-eval] summary written: #{path}")
    summary
  end

  defp report(summary, threshold) do
    all_blocked? =
      Enum.all?(summary.variants, fn variant -> variant.blocked == variant.trials end)

    if all_blocked? do
      IO.puts(:stderr, "[mbc/execution-self-eval] all trials blocked (connectivity/credentials)")
      System.halt(65)
    end

    for variant <- summary.variants do
      IO.puts(
        "[mbc/execution-self-eval] #{summary.provider}/#{variant.variant}: " <>
          "protocol=#{format_ratio(variant.protocol_compliance)} " <>
          "eval=#{format_ratio(variant.eval_accuracy)} " <>
          "(blocked #{variant.blocked}/#{variant.trials})"
      )

      for case_result <- variant.cases, case_result.failures != [] do
        IO.puts("  - #{case_result.id}: #{Enum.join(Enum.uniq(case_result.failures), " ; ")}")
      end
    end

    # 协议合规是硬闸门（1.0）；自评准确率按阈值。
    pass? =
      Enum.all?(summary.variants, fn variant ->
        variant.protocol_compliance == 1.0 and variant.eval_accuracy >= threshold
      end)

    if pass? do
      IO.puts("[mbc/execution-self-eval] PASS")
    else
      IO.puts(:stderr, "[mbc/execution-self-eval] FAIL (protocol must be 1.0, eval >= #{threshold})")
      System.halt(1)
    end
  end

  defp safe_ratio(_numerator, 0), do: nil
  defp safe_ratio(numerator, denominator), do: Float.round(numerator / denominator, 3)

  defp format_ratio(nil), do: "n/a"
  defp format_ratio(value), do: :erlang.float_to_binary(value, decimals: 3)

  # ── 工具 ──

  defp normalize_arguments(%{} = map), do: map

  defp normalize_arguments(binary) when is_binary(binary) do
    case Jason.decode(binary) do
      {:ok, %{} = map} -> map
      _ -> nil
    end
  end

  defp normalize_arguments(_other), do: nil

  defp map_get(map, key) when is_map(map),
    do: Map.get(map, key) || Map.get(map, to_string(key))

  defp map_get(_map, _key), do: nil

  defp env_int(name, default) do
    case System.get_env(name) do
      nil -> default
      value -> String.to_integer(value)
    end
  end

  defp env_float(name, default) do
    case System.get_env(name) do
      nil -> default
      value -> String.to_float(value)
    end
  end
end

ModelContracts.ExecutionSelfEval.main(System.argv())
