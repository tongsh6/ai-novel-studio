# MBC 模型行为契约探针：tool-call-compliance
#
# 验证「计划起草的强制 tool_choice 双通道协议」在指定 provider 上真实可用：
# 穿过生产 AgenticPlanDraftPlanner（真实 prompt + schema + 解析）与真实 adapter
# 请求整形（含 DeepSeek thinking×tool_choice 能力约束降级），不走 UI、秒级。
#
# 事故来源：2026-07-05 DeepSeek thinking 模式 HTTP 400
# "Thinking mode does not support this tool_choice"（真实创作现场首次 live 调用即失败，
# 因 CP4 证据全部来自 stub）。本探针让该类 provider×模式组合问题在 nightly 暴露。
#
# 用法：
#   mix run scripts/model_contracts/tool_call_compliance.exs [stub|lmstudio|deepseek]
# 环境变量：
#   MODEL_CONTRACT_RUNS           每变体试验次数（默认 3）
#   MODEL_CONTRACT_MIN_PASS_RATE  通过率阈值（默认 1.0）
#   NOVEL_DEEPSEEK_API_KEY / DEEPSEEK_API_KEY  deepseek 凭据（缺失 → exit 65 凭据阻塞）
# 退出码：0 通过；1 低于阈值；65 凭据/环境阻塞（全部试验均为连接/凭据类失败）。

alias NovelAgent.Provider.{DeepSeek, Execution}
alias NovelApplication.AgenticPlanDraftPlanner
alias NovelDomain.AgentRun

defmodule ModelContracts.ToolCallCompliance do
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

  def main(argv) do
    provider = List.first(argv) || "stub"
    runs = env_int("MODEL_CONTRACT_RUNS", 3)
    threshold = env_float("MODEL_CONTRACT_MIN_PASS_RATE", 1.0)

    case variants(provider) do
      {:error, message} ->
        IO.puts(:stderr, "[mbc/tool-call-compliance] #{message}")
        System.halt(65)

      {:ok, variants} ->
        results = Enum.map(variants, &run_variant(&1, runs))
        summary = write_summary(provider, results, runs, threshold)
        report(summary, threshold)
    end
  end

  # ── provider 变体 ──
  # 探针经 Gateway.execute(provider: ...) 走完整 ProviderExecution 运行时
  # （请求整形 + ProviderRun/Output 物化 + N-NARR 溯源所需 facts），与生产同路径。

  defp variants("stub"), do: {:ok, [%{name: "default", provider: :stub, config: []}]}

  defp variants("lmstudio"),
    do: {:ok, [%{name: "default", provider: :lmstudio, config: []}]}

  defp variants("deepseek") do
    key = System.get_env("NOVEL_DEEPSEEK_API_KEY") || System.get_env("DEEPSEEK_API_KEY")

    if is_binary(key) and key != "" do
      {:ok,
       [
         %{
           name: "thinking_disabled",
           provider: :deepseek,
           config: [api_key: key, thinking: :disabled]
         },
         # 验证 adapter 能力约束整形：thinking enabled + 强制 tool_choice 不得再打出 400
         %{
           name: "thinking_enabled",
           provider: :deepseek,
           config: [api_key: key, thinking: :enabled]
         }
       ]}
    else
      {:error, "deepseek 凭据缺失（NOVEL_DEEPSEEK_API_KEY / DEEPSEEK_API_KEY），登记为阻塞"}
    end
  end

  defp variants(other), do: {:error, "未知 provider: #{other}（支持 stub|lmstudio|deepseek）"}

  @provider_config_modules %{deepseek: DeepSeek}

  defp apply_variant_config(%{config: []}), do: :ok

  defp apply_variant_config(%{provider: provider, config: config}) do
    with {:ok, module} <- Map.fetch(@provider_config_modules, provider) do
      existing = Application.get_env(:novel_agent, module, [])
      Application.put_env(:novel_agent, module, Keyword.merge(existing, config))
    end

    :ok
  end

  # ── 试验 ──

  defp run_variant(variant, runs) do
    trials = Enum.map(1..runs, fn index -> trial(variant, index) end)

    %{
      variant: variant.name,
      runs: runs,
      pass: Enum.count(trials, &(&1.outcome == :pass)),
      fail: Enum.count(trials, &(&1.outcome == :fail)),
      blocked: Enum.count(trials, &(&1.outcome == :blocked)),
      failures:
        trials
        |> Enum.reject(&(&1.outcome == :pass))
        |> Enum.map(& &1.detail)
    }
  end

  defp trial(variant, index) do
    apply_variant_config(variant)

    # 生产同款依赖构造器：Gateway 路由 + ProviderExecution 物化 + execution refs 附回
    execution = Execution.dependency(provider: variant.provider, purpose: :author_reasoning)

    case AgenticPlanDraftPlanner.draft_plan_with_meta(
           probe_run(variant.name, index),
           execution,
           %{},
           chapter_titles_reader: fn _workspace_id -> ["第01章：底层灵气账单"] end
         ) do
      {:ok, plan, meta} ->
        classify_success(plan, meta)

      {:error, reason} ->
        classify_error(reason)
    end
  end

  defp classify_success(plan, meta) do
    prose_step = Enum.find(plan.steps, &(&1.target_tool_ref == "prose_writing"))

    cond do
      plan.steps == [] ->
        %{outcome: :fail, detail: "plan_steps_empty"}

      not (is_binary(meta[:summary]) and String.trim(meta[:summary]) != "") ->
        %{outcome: :fail, detail: "reasoning_content_empty"}

      is_nil(prose_step) ->
        %{outcome: :fail, detail: "prose_step_missing"}

      # M0 狗粮缺陷回归钉（2026-07-19）：续写措辞的目标下，prose 步坐标必须是
      # continuation + 精确章名——自由文本 intent 曾被归一化吞成 nil → 覆盖已采纳正文。
      prose_step.authoring_intent != :continuation ->
        %{
          outcome: :fail,
          detail: "authoring_intent_not_continuation:#{inspect(prose_step.authoring_intent)}"
        }

      prose_step.target_chapter != "第01章：底层灵气账单" ->
        %{outcome: :fail, detail: "target_chapter_unbound:#{inspect(prose_step.target_chapter)}"}

      true ->
        %{outcome: :pass, detail: nil}
    end
  end

  defp classify_error(reason) do
    detail = reason |> inspect() |> String.slice(0, 300)
    lowered = String.downcase(detail)

    if Enum.any?(@blocked_error_markers, &String.contains?(lowered, &1)) do
      %{outcome: :blocked, detail: detail}
    else
      %{outcome: :fail, detail: detail}
    end
  end

  # 真实生产 prompt 形状由 AgenticPlanDraftPlanner 按 profile 生成；这里只提供
  # 一个合法的 prose profile AgentRun。探针不写库、不建 run 进程。
  defp probe_run(variant_name, index) do
    {:ok, run} =
      AgentRun.new(%{
        run_id: "run_mbc_#{variant_name}_#{index}",
        workspace_id: "ws_mbc_probe",
        work_id: "work_mbc_probe",
        session_id: "session_mbc_probe",
        parent_turn_ref: "turn_mbc_probe",
        origin_frame_ref: "frame_mbc_probe",
        profile_ref: "prose_drafting_with_quality_v1",
        goal: %{text: "接着第01章往下写一段正文，自然衔接前文，推进本章情节。", version: 1},
        authority_scope: %{production_write: false, allowed_tools: ["prose_writing"]}
      })

    run
  end

  # ── 汇总 ──

  defp write_summary(provider, results, runs, threshold) do
    summary = %{
      probe: "tool-call-compliance",
      provider: provider,
      generated_at: DateTime.utc_now() |> DateTime.to_iso8601(),
      runs_per_variant: runs,
      min_pass_rate: threshold,
      variants:
        Enum.map(results, fn result ->
          effective = result.runs - result.blocked

          Map.put(
            result,
            :pass_rate,
            if(effective > 0, do: Float.round(result.pass / effective, 3), else: 0.0)
          )
        end)
    }

    dir = Path.join(["artifacts", "model-contracts", provider])
    File.mkdir_p!(dir)
    File.write!(Path.join(dir, "tool-call-compliance.json"), Jason.encode!(summary, pretty: true))
    summary
  end

  defp report(summary, threshold) do
    Enum.each(summary.variants, fn variant ->
      IO.puts(
        "[mbc/tool-call-compliance] #{summary.provider}/#{variant.variant} " <>
          "pass=#{variant.pass} fail=#{variant.fail} blocked=#{variant.blocked} " <>
          "pass_rate=#{variant.pass_rate}"
      )
    end)

    all_blocked? =
      Enum.all?(summary.variants, fn v -> v.blocked == v.runs end)

    below? =
      Enum.any?(summary.variants, fn v ->
        v.blocked < v.runs and v.pass_rate < threshold
      end)

    cond do
      all_blocked? ->
        IO.puts(:stderr, "[mbc/tool-call-compliance] 全部试验为连接/凭据类失败，登记为阻塞")
        System.halt(65)

      below? ->
        IO.puts(:stderr, "[mbc/tool-call-compliance] 通过率低于阈值 #{threshold}")
        System.halt(1)

      true ->
        :ok
    end
  end

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

ModelContracts.ToolCallCompliance.main(System.argv())
