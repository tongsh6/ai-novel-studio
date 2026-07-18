# MBC 模型行为契约探针：continuation-judgment（ADR-0025 判断②，回顾 D-1 补课）
#
# 判断②（观察 + 续行）上线时缺 live 探针——判断①有六用例探针（live 1.0 才放行），
# 判断②的续行方向（continue|await_author）只有桩预言与 prompt 粗指引对齐。本探针
# 补齐：消费生产构造器 `JudgmentProtocol.request_continuation`（生产同路径），验证：
#   ① 协议合规：call1 观察叙事 + call2 forced continuation_decision 可解析。
#   ② 方向质量：四用例阵列——质量意见可修正（continue）/ 计划走完缺产出步
#      （continue）/ 工具连续故障（await_author）/ 前提缺失需作者裁决（await_author）。
#
# 用法：
#   mix run scripts/model_contracts/continuation_judgment.exs [stub|lmstudio|deepseek]
# 环境变量：
#   MODEL_CONTRACT_RUNS           每用例试验次数（默认 2）
#   MODEL_CONTRACT_MIN_PASS_RATE  方向准确率阈值（默认 0.85；协议合规恒为 1.0 硬闸门）
# 退出码：0 通过；1 低于阈值；65 凭据/环境阻塞。

alias NovelAgent.Provider.{DeepSeek, Execution, LMStudio}
alias NovelApplication.JudgmentProtocol

defmodule ModelContracts.ContinuationJudgment do
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

  # 四用例阵列：expected 为可接受续行方向。
  @battery [
    %{
      id: "quality_fixable",
      goal_text: "写第01章正文草稿并通过质量复核。",
      deviation_summary:
        "D2 偏离信号：质量复核要求行动：confirm——正文包含违反既有规则且可以按意见修正的设定描写（无代价复活未交代代价）。",
      observation_block: "已生成初稿约 900 字；质量复核给出一条 confirm 意见：补上复活的代价交代。",
      expected: ["continue"]
    },
    %{
      id: "plan_exhausted_missing_output",
      goal_text: "按伏笔梳理结果重写第02章结尾。",
      deviation_summary: "计划步骤已走完，但作者请求的正文产出尚未完成。",
      observation_block: "已完成上下文读取与伏笔梳理观察；正文产出步未在计划中。",
      expected: ["continue"]
    },
    %{
      id: "tool_failure",
      goal_text: "写下一章正文草稿。",
      deviation_summary: "D1 偏离信号：工具 prose_writing 执行失败——写作模型连续两次调用失败（连接错误）。",
      observation_block: "两次写作调用均失败，未产出任何草稿。",
      expected: ["await_author"]
    },
    %{
      id: "missing_premise",
      goal_text: "按第12章对质情节设计在场的第三方角色。",
      deviation_summary: "D7 偏离信号：写作坐标存在确定性缺口——作品当前只有 3 章，作者点名的第12章不存在。",
      observation_block: "章节列表：第01-03章；未找到第12章。",
      expected: ["await_author"]
    }
  ]

  def main(argv) do
    provider = List.first(argv) || "stub"
    runs = env_int("MODEL_CONTRACT_RUNS", 2)
    threshold = env_float("MODEL_CONTRACT_MIN_PASS_RATE", 0.85)

    case variants(provider) do
      {:error, message} ->
        IO.puts(:stderr, "[mbc/continuation-judgment] #{message}")
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

  defp variants("stub"), do: {:ok, [%{name: "default", provider: :stub, config: []}]}

  defp variants("lmstudio"),
    do: {:ok, [%{name: "default", provider: :lmstudio, config: [timeout: 120_000]}]}

  defp variants("deepseek") do
    key = System.get_env("NOVEL_DEEPSEEK_API_KEY") || System.get_env("DEEPSEEK_API_KEY")

    if is_binary(key) and key != "" do
      {:ok,
       [%{name: "thinking_disabled", provider: :deepseek, config: [api_key: key, thinking: :disabled]}]}
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

  defp run_case(variant, battery_case, runs) do
    trials = Enum.map(1..runs, fn _index -> trial(variant, battery_case) end)

    %{
      id: battery_case.id,
      expected: battery_case.expected,
      runs: runs,
      blocked: Enum.count(trials, &(&1.protocol == :blocked)),
      protocol_pass: Enum.count(trials, &(&1.protocol == :pass)),
      direction_pass: Enum.count(trials, &(&1.direction == :pass)),
      direction_applicable: Enum.count(trials, &(&1.direction in [:pass, :fail])),
      failures: trials |> Enum.map(& &1.detail) |> Enum.reject(&is_nil/1)
    }
  end

  defp trial(variant, battery_case) do
    apply_variant_config(variant)

    execution = Execution.dependency(provider: variant.provider)

    input = %{
      goal_text: battery_case.goal_text,
      deviation_summary: battery_case.deviation_summary,
      observation_block: battery_case.observation_block
    }

    case JudgmentProtocol.request_continuation(execution, %{}, input) do
      {:ok, continuation} ->
        if continuation.action in battery_case.expected do
          %{protocol: :pass, direction: :pass, detail: nil}
        else
          %{
            protocol: :pass,
            direction: :fail,
            detail:
              "direction_mismatch:expected=#{Enum.join(battery_case.expected, "|")} got=#{continuation.action}"
          }
        end

      {:error, reason} ->
        detail = reason |> inspect() |> String.slice(0, 300)
        lowered = String.downcase(detail)

        if Enum.any?(@blocked_error_markers, &String.contains?(lowered, &1)) do
          %{protocol: :blocked, direction: :skip, detail: "continuation:#{detail}"}
        else
          %{protocol: :fail, direction: :skip, detail: "continuation:#{detail}"}
        end
    end
  end

  defp write_summary(provider, results, runs, threshold) do
    summary = %{
      probe: "continuation-judgment",
      provider: provider,
      generated_at: DateTime.utc_now() |> DateTime.to_iso8601(),
      runs_per_case: runs,
      min_direction_accuracy: threshold,
      variants:
        Enum.map(results, fn result ->
          cases = result.cases
          total = length(cases) * runs
          blocked = cases |> Enum.map(& &1.blocked) |> Enum.sum()
          applicable = total - blocked
          protocol_pass = cases |> Enum.map(& &1.protocol_pass) |> Enum.sum()
          direction_pass = cases |> Enum.map(& &1.direction_pass) |> Enum.sum()
          direction_applicable = cases |> Enum.map(& &1.direction_applicable) |> Enum.sum()

          %{
            variant: result.variant,
            cases: cases,
            trials: total,
            blocked: blocked,
            protocol_compliance: safe_ratio(protocol_pass, applicable),
            direction_accuracy: safe_ratio(direction_pass, direction_applicable)
          }
        end)
    }

    dir = Path.join(["artifacts", "model-contracts", provider])
    File.mkdir_p!(dir)
    path = Path.join(dir, "continuation-judgment.json")
    File.write!(path, Jason.encode!(summary, pretty: true))
    IO.puts("[mbc/continuation-judgment] summary written: #{path}")
    summary
  end

  defp report(summary, threshold) do
    all_blocked? = Enum.all?(summary.variants, fn variant -> variant.blocked == variant.trials end)

    if all_blocked? do
      IO.puts(:stderr, "[mbc/continuation-judgment] all trials blocked (connectivity/credentials)")
      System.halt(65)
    end

    for variant <- summary.variants do
      IO.puts(
        "[mbc/continuation-judgment] #{summary.provider}/#{variant.variant}: " <>
          "protocol=#{format_ratio(variant.protocol_compliance)} " <>
          "direction=#{format_ratio(variant.direction_accuracy)} " <>
          "(blocked #{variant.blocked}/#{variant.trials})"
      )

      for case_result <- variant.cases, case_result.failures != [] do
        IO.puts("  - #{case_result.id}: #{Enum.join(Enum.uniq(case_result.failures), " ; ")}")
      end
    end

    pass? =
      Enum.all?(summary.variants, fn variant ->
        variant.protocol_compliance == 1.0 and variant.direction_accuracy >= threshold
      end)

    if pass? do
      IO.puts("[mbc/continuation-judgment] PASS")
    else
      IO.puts(
        :stderr,
        "[mbc/continuation-judgment] FAIL (protocol must be 1.0, direction >= #{threshold})"
      )

      System.halt(1)
    end
  end

  defp safe_ratio(_numerator, 0), do: nil
  defp safe_ratio(numerator, denominator), do: Float.round(numerator / denominator, 3)

  defp format_ratio(nil), do: "n/a"
  defp format_ratio(value), do: :erlang.float_to_binary(value, decimals: 3)

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

ModelContracts.ContinuationJudgment.main(System.argv())
