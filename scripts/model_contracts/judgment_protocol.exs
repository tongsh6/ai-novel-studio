# MBC 模型行为契约探针：judgment-protocol（ADR-0025 CP1 实施前置）
#
# 验证「判断①方案 B 回复内联协议」与「是否开计划的判断质量」在指定 provider 上
# 真实可用（ADR-0025 §8 开放问题 1）：
#   ① 协议合规：call1 自由输出判断叙事（判"直接回复"时同一调用空行后内联回复正文），
#      call2 强制 native tool call 产出轻量判断结构（action 五选一可解析）。
#   ② 判断质量：固定六用例阵列（闲聊/上下文事实/单动作创作/多步复杂/需检索/意图不明），
#      弱模型不得对简单请求乱开计划、不得对复杂任务漏计划。
#
# 判断①提示词/请求机已迁入生产模块 `NovelApplication.JudgmentProtocol`（CP1a），
# 本探针消费生产构造器（与 tool_call_compliance 消费 AgenticPlanDraftPlanner 同理）。
# 调用穿真实 Gateway/ProviderExecution 运行时（Execution.dependency(provider:)），秒级、不写库。
#
# 用法：
#   PHX_SERVER=false mix run scripts/model_contracts/judgment_protocol.exs [stub|lmstudio|deepseek]
# 环境变量：
#   MODEL_CONTRACT_RUNS           每用例试验次数（默认 2）
#   MODEL_CONTRACT_MIN_PASS_RATE  判断准确率阈值（默认 0.85；协议合规恒为 1.0 硬闸门）
#   NOVEL_DEEPSEEK_API_KEY / DEEPSEEK_API_KEY  deepseek 凭据（缺失 → exit 65）
# 退出码：0 通过；1 低于阈值；65 凭据/环境阻塞（全部试验均为连接/凭据类失败）。

alias NovelAgent.Provider.{DeepSeek, Execution}
alias NovelApplication.JudgmentProtocol

defmodule ModelContracts.JudgmentProtocol do
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

  @actions ~w(reply execute plan explore await_author)

  # 六用例阵列：expected 为可接受 action 集合（单一期望优先，避免稀释信号）。
  @battery [
    %{
      id: "chat_opinion",
      text: "你觉得赛博修仙这个题材最大的看点是什么？",
      expected: ["reply"],
      reply_case: true
    },
    %{
      id: "fact_in_context",
      text: "我这部作品现在写到第几章了？",
      expected: ["reply"],
      reply_case: true
    },
    %{
      id: "single_creative",
      text: "帮我设计一个反派角色，和主角形成镜像对照。",
      expected: ["execute"],
      reply_case: false
    },
    %{
      id: "multi_step_creative",
      text: "把前两章的伏笔逐条梳理一遍，按梳理结果重写第02章结尾，再把相关角色档案更新一遍。",
      # 上下文声明"伏笔明细需检索"——先探索再计划（explore→plan）与直接开计划同为
      # 合理首步；测量口径接受两者，只拒绝 reply/execute/await（乱答/漏计划/误停）。
      expected: ["plan", "explore"],
      reply_case: false
    },
    %{
      id: "needs_retrieval",
      text: "主角在矿区追击那场戏里受的伤，后面章节交代过怎么恢复的吗？",
      expected: ["explore"],
      reply_case: false
    },
    %{
      id: "ambiguous_intent",
      text: "改一下。",
      expected: ["await_author"],
      reply_case: false
    },
    %{
      id: "continuation_phrasing",
      # M0 狗粮实锤（2026-07-19）：续写措辞下 live 模型自造目录外能力名
      # "text_generation" → dispatch 硬失败。capability enum + 越界重试修复后，
      # 本用例钉住：续写请求判 execute 且 capability 必须是目录内 prose_writing。
      text: "接着第01章往下继续写正文，和现有内容自然衔接。",
      expected: ["execute"],
      reply_case: false,
      expected_capability: "prose_writing"
    }
  ]

  def main(argv) do
    provider = List.first(argv) || "stub"
    runs = env_int("MODEL_CONTRACT_RUNS", 2)
    threshold = env_float("MODEL_CONTRACT_MIN_PASS_RATE", 0.85)

    case variants(provider) do
      {:error, message} ->
        IO.puts(:stderr, "[mbc/judgment-protocol] #{message}")
        System.halt(65)

      {:ok, variants} ->
        # T1（call2 病灶收口）：每个 provider 变体 × 两种上下文形态——bare（探针
        # 裸上下文）与 in_run（生产 prompt 同形：会话摘要 + 全章列表 + 采纳事实）。
        # 症状率差 = 上下文负载对 call2 退化的贡献基线。
        results =
          for variant <- variants, context_shape <- [:bare, :in_run, :long_run] do
            shaped = Map.put(variant, :context_shape, context_shape)
            cases = Enum.map(@battery, &run_case(shaped, &1, runs))
            %{variant: "#{variant.name}/#{context_shape}", cases: cases}
          end

        summary = write_summary(provider, results, runs, threshold)
        report(summary, threshold)
    end
  end

  # ── provider 变体（与 tool_call_compliance 同构） ──

  defp variants("stub"), do: {:ok, [%{name: "default", provider: :stub, config: []}]}
  defp variants("lmstudio"), do: {:ok, [%{name: "default", provider: :lmstudio, config: []}]}

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

  defp run_case(variant, battery_case, runs) do
    trials = Enum.map(1..runs, fn _index -> trial(variant, battery_case) end)

    %{
      id: battery_case.id,
      expected: battery_case.expected,
      runs: runs,
      blocked: Enum.count(trials, &(&1.protocol == :blocked)),
      protocol_pass: Enum.count(trials, &(&1.protocol == :pass)),
      form_pass: Enum.count(trials, &(&1.form == :pass)),
      form_applicable: Enum.count(trials, &(&1.form in [:pass, :fail])),
      judgment_pass: Enum.count(trials, &(&1.judgment == :pass)),
      judgment_applicable: Enum.count(trials, &(&1.judgment in [:pass, :fail])),
      failures:
        trials
        |> Enum.map(& &1.detail)
        |> Enum.reject(&is_nil/1)
    }
  end

  # 三类结果分账：protocol（调用可解析+叙事存在，CP1 硬闸门）/ form（内联两段形）/
  # judgment（判断准确率）。判断方差是模型属性（ADR-0025 以预算 backstop 兜底），
  # 与协议可行性分开度量。
  defp trial(variant, battery_case) do
    apply_variant_config(variant)

    execution = Execution.dependency(provider: variant.provider)

    input = %{
      author_text: battery_case.text,
      context_block: probe_context_block(Map.get(variant, :context_shape, :bare)),
      options: [
        explore: true,
        capabilities:
          ~w(character_design character_evolution prose_writing plot_outline world_building work_archive_read)
      ]
    }

    case JudgmentProtocol.request_judgment(execution, %{}, input) do
      {:ok, judgment} ->
        form =
          case check_inline_reply(judgment.narrative, battery_case) do
            :ok -> :pass
            {:fail, _} -> :fail
          end

        {judgment_outcome, detail} =
          case check_decision(judgment, battery_case) do
            :ok -> {:pass, nil}
            {:fail, d} -> {:fail, d}
          end

        %{protocol: :pass, form: form, judgment: judgment_outcome, detail: detail}

      {:error, reason} ->
        case classify_error(reason, "judgment") do
          {:blocked, detail} ->
            %{protocol: :blocked, form: :skip, judgment: :skip, detail: detail}

          {:fail, detail} ->
            %{protocol: :fail, form: :skip, judgment: :skip, detail: detail}
        end
    end
  end

  # 方案 B 内联契约：直接回复用例的 call1 必须是「判断说明 + 空行 + 回复正文」两段以上。
  defp check_inline_reply(narrative, %{reply_case: true}) do
    paragraphs =
      narrative
      |> String.split(~r/\n\s*\n/u, trim: true)
      |> Enum.reject(&(String.trim(&1) == ""))

    if length(paragraphs) >= 2, do: :ok, else: {:fail, "inline_reply_missing"}
  end

  defp check_inline_reply(_narrative, _battery_case), do: :ok

  defp check_decision(decision, battery_case) do
    action = map_get(decision, :action)

    cond do
      action not in @actions ->
        {:fail, "invalid_action:#{inspect(action) |> String.slice(0, 60)}"}

      action not in battery_case.expected ->
        {:fail, "judgment_mismatch:expected=#{Enum.join(battery_case.expected, "|")} got=#{action}"}

      battery_case.reply_case and map_get(decision, :reply_included) != true ->
        {:fail, "reply_flag_wrong"}

      capability_mismatch?(decision, battery_case) ->
        {:fail, "capability_mismatch:got=#{inspect(map_get(decision, :capability))}"}

      true ->
        :ok
    end
  end

  defp capability_mismatch?(decision, battery_case) do
    case Map.get(battery_case, :expected_capability) do
      nil -> false
      expected -> map_get(decision, :capability) != expected
    end
  end

  defp classify_error(reason, call_label) do
    detail = reason |> inspect() |> String.slice(0, 300)
    lowered = String.downcase(detail)

    if Enum.any?(@blocked_error_markers, &String.contains?(lowered, &1)) do
      {:blocked, "#{call_label}:#{detail}"}
    else
      {:fail, "#{call_label}:#{detail}"}
    end
  end

  # ── 探针固定上下文（含检索能力目录，explore: true 开放五选一） ──

  # in_run 形态：镜像 M0 狗粮生产 prompt 的实际负载（judgment_context_block 渲染
  # 形态——作品上下文 + 12 章全列表 + 会话摘要含近轮采纳事实 + 能力目录）。
  defp probe_context_block(:in_run) do
    """
    ## 当前作品上下文
    - title: P1 单章正文草稿验证作品
    - revision: 1
    - core_selling_point: 从已采纳章节计划生成待采纳正文草稿
    - genre: 赛博修仙
    - target_reader: 关注长篇主链闭环的作者
    - tone_preference: 克制、紧张、具象

    ## 已写章节（共 12 章，按顺序）
    - 第01章：底层灵气账单
    - 第02章：旧服务器里的残诀
    - 第03章：黑市调频师
    - 第04章：巡检队的诱捕
    - 第05章：霓虹地牢试炼
    - 第06章：中层执行者的裂缝
    - 第07章：断网之城
    - 第08章：核心模块的代价
    - 第09章：伪仙直播夜
    - 第10章：反向筑基协议
    - 第11章：天台上的背叛
    - 第12章：第一卷终局：灵气回流
    （回答进度类问题时依据这里的章节顺序和数量；各章正文细节不在本段内。）

    ## 会话摘要
    作者按章节计划逐章推进正文：上一轮为第01章生成了正文草稿并已采纳（约 1,288 字），
    再上一轮采纳了章节计划（12 章）。作者的采纳节奏很快，通常草稿生成后立即确认保存。

    #{capability_catalog_section()}
    """
    |> String.trim()
  end

  # long_run 形态：30 章作品经 T2a 预算投影后的真实 prompt 形貌（首章 + 最近 6 章
  # + 折叠说明行）——call2 可靠性随上下文长度递减的回归钉（M2 实证形态）。
  defp probe_context_block(:long_run) do
    """
    ## 当前作品上下文
    - title: 长跑形态探针作品
    - genre: 赛博修仙
    - tone_preference: 克制、紧张、具象

    ## 已写章节（共 30 章，按顺序）
    - 第01章：底层灵气账单
    - 第25章：残响回廊
    - 第26章：灰色频段
    - 第27章：矿脉深处的低语
    - 第28章：断链之夜
    - 第29章：回流前夜
    - 第30章：临界点
    （共 30 章；中段 23 章从略——只列首章、最近 6 章与作者点名章。）
    （回答进度类问题时依据这里的章节顺序和数量；各章正文细节不在本段内。）

    ## 会话摘要
    作者按章节计划连载推进，最近数轮均为"生成下一章正文草稿并采纳"；上一轮采纳了
    第30章草稿（约 1,400 字）。作者节奏稳定，通常草稿生成后立即确认保存。

    #{capability_catalog_section()}
    """
    |> String.trim()
  end

  defp probe_context_block(_bare) do
    """
    ## 当前作品
    - 标题：星潮之下（赛博修仙）
    - 已有章节：
      - 第01章：底层灵气账单（已有正文，约 1100 字）
      - 第02章：矿区追击战（已有正文，约 900 字）
      - 第03章：黑市调频师（仅计划，无正文）
    - 已确认角色：林烬（主角，灵气稽查官）、周衡（配角，黑市调频师）
    - 注意：以上只是结构摘要；各章正文细节、伏笔明细不在本段内，需要时必须先检索。

    #{capability_catalog_section()}
    """
    |> String.trim()
  end

  defp capability_catalog_section do
    """
    ## 可用能力（判断"单动作执行"或"制定计划"时的目标集）
    - character_design：设计新角色（产出待采纳候选）
    - prose_writing：写/续写章节正文（产出待采纳草稿）
    - plot_outline：规划章节大纲
    - world_building：设计世界观设定
    - search_work_facts：检索作品事实（正文细节、伏笔、时间线；只读）
    """
    |> String.trim()
  end

  # ── 汇总 ──

  defp write_summary(provider, results, runs, threshold) do
    summary = %{
      probe: "judgment-protocol",
      provider: provider,
      generated_at: DateTime.utc_now() |> DateTime.to_iso8601(),
      runs_per_case: runs,
      min_judgment_accuracy: threshold,
      variants:
        Enum.map(results, fn result ->
          cases = result.cases
          total = length(cases) * runs
          blocked = cases |> Enum.map(& &1.blocked) |> Enum.sum()
          protocol_pass = cases |> Enum.map(& &1.protocol_pass) |> Enum.sum()
          form_pass = cases |> Enum.map(& &1.form_pass) |> Enum.sum()
          form_applicable = cases |> Enum.map(& &1.form_applicable) |> Enum.sum()
          judgment_pass = cases |> Enum.map(& &1.judgment_pass) |> Enum.sum()
          judgment_applicable = cases |> Enum.map(& &1.judgment_applicable) |> Enum.sum()

          %{
            variant: result.variant,
            cases: cases,
            total_runs: total,
            blocked: blocked,
            protocol_compliance_rate: rate(protocol_pass, total - blocked),
            form_adherence_rate: rate(form_pass, form_applicable),
            judgment_accuracy: rate(judgment_pass, judgment_applicable)
          }
        end)
    }

    dir = Path.join(["artifacts", "model-contracts", provider])
    File.mkdir_p!(dir)
    File.write!(Path.join(dir, "judgment-protocol.json"), Jason.encode!(summary, pretty: true))
    summary
  end

  defp rate(_pass, effective) when effective <= 0, do: 0.0
  defp rate(pass, effective), do: Float.round(pass / effective, 3)

  defp report(summary, threshold) do
    Enum.each(summary.variants, fn variant ->
      Enum.each(variant.cases, fn c ->
        IO.puts(
          "[mbc/judgment-protocol] #{summary.provider}/#{variant.variant} case=#{c.id} " <>
            "judgment=#{c.judgment_pass}/#{c.judgment_applicable} form=#{c.form_pass}/#{c.form_applicable}" <>
            if(c.failures == [], do: "", else: " failures=#{inspect(Enum.take(c.failures, 2))}")
        )
      end)

      IO.puts(
        "[mbc/judgment-protocol] #{summary.provider}/#{variant.variant} " <>
          "protocol=#{variant.protocol_compliance_rate} form=#{variant.form_adherence_rate} " <>
          "judgment=#{variant.judgment_accuracy} blocked=#{variant.blocked}/#{variant.total_runs}"
      )
    end)

    all_blocked? = Enum.all?(summary.variants, fn v -> v.blocked == v.total_runs end)

    # 硬闸门：协议合规必须 1.0；判断准确率按阈值（默认见 main/1，live 弱模型可调）。
    protocol_below? =
      Enum.any?(summary.variants, fn v ->
        v.blocked < v.total_runs and v.protocol_compliance_rate < 1.0
      end)

    judgment_below? =
      Enum.any?(summary.variants, fn v ->
        v.blocked < v.total_runs and v.judgment_accuracy < threshold
      end)

    cond do
      all_blocked? ->
        IO.puts(:stderr, "[mbc/judgment-protocol] 全部试验为连接/凭据类失败，登记为阻塞")
        System.halt(65)

      protocol_below? ->
        IO.puts(:stderr, "[mbc/judgment-protocol] 协议合规低于 1.0（硬闸门）")
        System.halt(1)

      judgment_below? ->
        IO.puts(:stderr, "[mbc/judgment-protocol] 判断准确率低于阈值 #{threshold}")
        System.halt(1)

      true ->
        :ok
    end
  end

  defp map_get(map, key) when is_map(map),
    do: Map.get(map, key) || Map.get(map, Atom.to_string(key))

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

ModelContracts.JudgmentProtocol.main(System.argv())
