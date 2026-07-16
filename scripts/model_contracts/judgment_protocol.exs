# MBC 模型行为契约探针：judgment-protocol（ADR-0025 CP1 实施前置）
#
# 验证「判断①方案 B 回复内联协议」与「是否开计划的判断质量」在指定 provider 上
# 真实可用（ADR-0025 §8 开放问题 1）：
#   ① 协议合规：call1 自由输出判断叙事（判"直接回复"时同一调用空行后内联回复正文），
#      call2 强制 native tool call 产出轻量判断结构（action 五选一可解析）。
#   ② 判断质量：固定六用例阵列（闲聊/上下文事实/单动作创作/多步复杂/需检索/意图不明），
#      弱模型不得对简单请求乱开计划、不得对复杂任务漏计划。
#
# 判断①提示词为 CP1 协议草案：探针先行验证协议可行性，CP1 落地时迁入生产模块，
# 本探针改为消费生产构造器（与 tool_call_compliance 消费 AgenticPlanDraftPlanner 同理）。
# 调用穿真实 Gateway/ProviderExecution 运行时（Execution.dependency(provider:)），秒级、不写库。
#
# 用法：
#   mix run scripts/model_contracts/judgment_protocol.exs [stub|lmstudio|deepseek]
# 环境变量：
#   MODEL_CONTRACT_RUNS           每用例试验次数（默认 2）
#   MODEL_CONTRACT_MIN_PASS_RATE  通过率阈值（默认 1.0；live 弱模型测量可调低）
#   NOVEL_DEEPSEEK_API_KEY / DEEPSEEK_API_KEY  deepseek 凭据（缺失 → exit 65）
# 退出码：0 通过；1 低于阈值；65 凭据/环境阻塞（全部试验均为连接/凭据类失败）。

alias NovelAgent.Provider.{DeepSeek, Execution}

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
    }
  ]

  def main(argv) do
    provider = List.first(argv) || "stub"
    runs = env_int("MODEL_CONTRACT_RUNS", 2)
    threshold = env_float("MODEL_CONTRACT_MIN_PASS_RATE", 1.0)

    case variants(provider) do
      {:error, message} ->
        IO.puts(:stderr, "[mbc/judgment-protocol] #{message}")
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
      pass: Enum.count(trials, &(&1.outcome == :pass)),
      fail: Enum.count(trials, &(&1.outcome == :fail)),
      blocked: Enum.count(trials, &(&1.outcome == :blocked)),
      failures:
        trials
        |> Enum.reject(&(&1.outcome == :pass))
        |> Enum.map(& &1.detail)
    }
  end

  defp trial(variant, battery_case) do
    apply_variant_config(variant)

    with {:ok, narrative} <- judgment_narrative_call(variant, battery_case),
         :ok <- check_inline_reply(narrative, battery_case),
         {:ok, decision} <- judgment_decision_call(variant, battery_case, narrative),
         :ok <- check_decision(decision, battery_case) do
      %{outcome: :pass, detail: nil}
    else
      {:fail, detail} -> %{outcome: :fail, detail: detail}
      {:blocked, detail} -> %{outcome: :blocked, detail: detail}
    end
  end

  # call1：自由输出（流式语义；purpose 与生产判断叙事一致）
  defp judgment_narrative_call(variant, battery_case) do
    result_fn =
      Execution.dependency(provider: variant.provider, purpose: :author_reasoning)
      |> Execution.result_fn()

    case result_fn.(%{messages: [%{role: "user", content: narrative_prompt(battery_case)}]}) do
      {:ok, %{content: content}} when is_binary(content) ->
        if String.trim(content) == "" do
          {:fail, "call1_content_empty"}
        else
          {:ok, content}
        end

      {:ok, other} ->
        {:fail, "call1_unexpected_result:#{inspect(other) |> String.slice(0, 120)}"}

      {:error, reason} ->
        classify_error(reason, "call1")
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

  # call2：强制 native tool call 产出轻量判断结构
  defp judgment_decision_call(variant, battery_case, narrative) do
    result_fn =
      Execution.dependency(provider: variant.provider, purpose: :planner)
      |> Execution.result_fn()

    case result_fn.(decision_prompt(battery_case, narrative)) do
      {:ok, result} ->
        parse_decision(result)

      {:error, reason} ->
        classify_error(reason, "call2")
    end
  end

  defp parse_decision(result) do
    tool_calls = Map.get(result, :tool_calls) || []

    decision =
      Enum.find_value(tool_calls, fn call ->
        name = map_get(call, :name)
        if name == "judgment_decision", do: normalize_arguments(map_get(call, :arguments))
      end)

    case decision do
      %{} = arguments ->
        {:ok, arguments}

      _ ->
        {:fail, "call2_tool_call_missing"}
    end
  end

  defp normalize_arguments(arguments) when is_map(arguments), do: arguments

  defp normalize_arguments(arguments) when is_binary(arguments) do
    case Jason.decode(arguments) do
      {:ok, decoded} when is_map(decoded) -> decoded
      _ -> nil
    end
  end

  defp normalize_arguments(_arguments), do: nil

  defp check_decision(decision, battery_case) do
    action = map_get(decision, :action)

    cond do
      action not in @actions ->
        {:fail, "invalid_action:#{inspect(action) |> String.slice(0, 60)}"}

      action not in battery_case.expected ->
        {:fail, "judgment_mismatch:expected=#{Enum.join(battery_case.expected, "|")} got=#{action}"}

      battery_case.reply_case and map_get(decision, :reply_included) != true ->
        {:fail, "reply_flag_wrong"}

      true ->
        :ok
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

  # ── 判断①协议草案 prompt（CP1 输入；落地时迁入生产模块并由探针改为消费生产构造器） ──

  defp work_context_block do
    """
    ## 当前作品
    - 标题：星潮之下（赛博修仙）
    - 已有章节：
      - 第01章：底层灵气账单（已有正文，约 1100 字）
      - 第02章：矿区追击战（已有正文，约 900 字）
      - 第03章：黑市调频师（仅计划，无正文）
    - 已确认角色：林烬（主角，灵气稽查官）、周衡（配角，黑市调频师）
    - 注意：以上只是结构摘要；各章正文细节、伏笔明细不在本段内，需要时必须先检索。

    ## 可用能力（判断"单动作执行"或"制定计划"时的目标集）
    - character_design：设计新角色（产出待采纳候选）
    - prose_writing：写/续写章节正文（产出待采纳草稿）
    - plot_outline：规划章节大纲
    - world_building：设计世界观设定
    - search_work_facts：检索作品事实（正文细节、伏笔、时间线；只读）
    """
    |> String.trim()
  end

  defp narrative_prompt(battery_case) do
    """
    你是小说创作系统的创作判断器。作者刚发来一条输入，你要判断本轮的形态并向作者说明。

    #{work_context_block()}

    ## 作者输入
    #{battery_case.text}

    ## 本轮形态（五选一）
    - 直接回复：闲聊、观点、上面作品摘要里已含答案的问题——不需要动用创作能力
    - 单动作执行：一个明确的创作动作就能满足（如设计一个角色、续写一章）
    - 制定计划：需要多个相互依赖的步骤才能完成
    - 先探索：回答或动手之前缺少作品事实，需要先检索
    - 等作者说清：意图不明确或缺少关键决定，先停下来问作者

    ## 判别规则（容易混的边界）
    - 作者要你"做出一个创作产物"（设计一个角色、写一章、给一份大纲）→ 这是单动作执行，
      不是直接回复：不要用文字描述替代产出候选。
    - 单动作执行 vs 制定计划：作者点名的是**一个**产物，即使做它需要参考现有内容，也算
      单动作执行；只有作者的请求本身包含**多个相互依赖的产物或阶段**时才制定计划。

    ## 输出要求（会逐字实时显示给作者）
    - 用自然中文输出一段连贯的判断说明：先复述你理解的作者意图，再说明你选择的形态与理由。
    - 如果你的判断是"直接回复"：判断说明之后空一行，接着输出给作者的回复正文（在这同一次输出里完成）。
    - 其它形态：只输出判断说明，不要开始执行。
    - 不要标题、JSON、代码块或内部机器名。
    """
    |> String.trim()
  end

  defp decision_prompt(battery_case, narrative) do
    %{
      messages: [
        %{
          role: "user",
          content: """
          你是小说创作系统的创作判断器。你刚才已向作者输出了判断说明（如下）。现在把这个判断结构化。

          ## 作者输入
          #{battery_case.text}

          ## 你已输出的判断说明
          #{narrative}

          ## 输出格式
          - native tool call：必须调用 judgment_decision，把判断放入 tool arguments。
          - action 五选一：reply（直接回复，说明里已含回复正文）｜ execute（单动作执行）｜ plan（制定计划）｜ explore（先检索作品事实）｜ await_author（等作者说清）。
          - execute 时 capability 填能力名（character_design / prose_writing / plot_outline / world_building）；先检索属于 explore，不算 execute。
          - reply_included：action=reply 且判断说明已包含给作者的回复正文时为 true。
          """
        }
      ],
      tools: [
        %{
          name: "judgment_decision",
          description: "Structure this turn's judgment for the creative loop.",
          input_schema: %{
            type: "object",
            properties: %{
              action: %{type: "string", enum: @actions},
              capability: %{anyOf: [%{type: "string"}, %{type: "null"}]},
              reply_included: %{type: "boolean"},
              reason: %{type: "string"}
            },
            required: ["action", "reason"]
          }
        }
      ],
      tool_choice: "judgment_decision"
    }
  end

  # ── 汇总 ──

  defp write_summary(provider, results, runs, threshold) do
    summary = %{
      probe: "judgment-protocol",
      provider: provider,
      generated_at: DateTime.utc_now() |> DateTime.to_iso8601(),
      runs_per_case: runs,
      min_pass_rate: threshold,
      variants:
        Enum.map(results, fn result ->
          cases =
            Enum.map(result.cases, fn c ->
              effective = c.runs - c.blocked

              Map.put(
                c,
                :pass_rate,
                if(effective > 0, do: Float.round(c.pass / effective, 3), else: 0.0)
              )
            end)

          total_pass = cases |> Enum.map(& &1.pass) |> Enum.sum()
          total_blocked = cases |> Enum.map(& &1.blocked) |> Enum.sum()
          total = length(cases) * runs
          effective_total = total - total_blocked

          %{
            variant: result.variant,
            cases: cases,
            total_pass: total_pass,
            total_blocked: total_blocked,
            total_runs: total,
            overall_pass_rate:
              if(effective_total > 0,
                do: Float.round(total_pass / effective_total, 3),
                else: 0.0
              )
          }
        end)
    }

    dir = Path.join(["artifacts", "model-contracts", provider])
    File.mkdir_p!(dir)
    File.write!(Path.join(dir, "judgment-protocol.json"), Jason.encode!(summary, pretty: true))
    summary
  end

  defp report(summary, threshold) do
    Enum.each(summary.variants, fn variant ->
      Enum.each(variant.cases, fn c ->
        IO.puts(
          "[mbc/judgment-protocol] #{summary.provider}/#{variant.variant} case=#{c.id} " <>
            "pass=#{c.pass} fail=#{c.fail} blocked=#{c.blocked} pass_rate=#{c.pass_rate}" <>
            if(c.failures == [], do: "", else: " failures=#{inspect(Enum.take(c.failures, 2))}")
        )
      end)

      IO.puts(
        "[mbc/judgment-protocol] #{summary.provider}/#{variant.variant} " <>
          "overall_pass_rate=#{variant.overall_pass_rate} blocked=#{variant.total_blocked}/#{variant.total_runs}"
      )
    end)

    all_blocked? = Enum.all?(summary.variants, fn v -> v.total_blocked == v.total_runs end)

    below? =
      Enum.any?(summary.variants, fn v ->
        v.total_blocked < v.total_runs and v.overall_pass_rate < threshold
      end)

    cond do
      all_blocked? ->
        IO.puts(:stderr, "[mbc/judgment-protocol] 全部试验为连接/凭据类失败，登记为阻塞")
        System.halt(65)

      below? ->
        IO.puts(:stderr, "[mbc/judgment-protocol] 通过率低于阈值 #{threshold}")
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
