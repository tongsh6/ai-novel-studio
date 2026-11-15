# B26/B27 生产单调用判断 MBC：同次 auto 响应携公开文本与明确业务工具。
# 普通回复整段 content，不要求空行或额外分类；协议、实际纠错、判断质量分账。
# 用法：bash scripts/probe_run.sh scripts/model_contracts/judgment_protocol.exs <provider> <runs>
# MODEL_CONTRACT_CONTEXT_SHAPES=production 使用生产上下文构造器。
# MODEL_CONTRACT_ARTIFACT_DIR 可把本次证据写入独立批次，保留旧基线。
# 本探针是固定用例判断回归，不替代 B27 的 20 例完整 episode / 盲评或真实页面。

alias NovelAgent.Provider.{DeepSeek, Execution}
alias NovelApplication.{DialoguePlanningService, ExplorationService, JudgmentProtocol}
alias NovelDomain.DialogueContext

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

  @actions ~w(reply execute plan explore await_author creative_directions author_content_registration capability_gap)

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
        # T1（call2 病灶收口）：每个 provider 变体 × 多种上下文形态——bare（探针
        # 裸上下文）与 in_run（生产 prompt 同形：会话摘要 + 全章列表 + 采纳事实）。
        # 症状率差 = 上下文负载对 call2 退化的贡献基线。
        # production 形态由生产 `judgment_scope/2` 构造，原生事实经三 wire 同源投影。
        results =
          for variant <- variants, context_shape <- env_context_shapes() do
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

  defp variants("strata"),
    do: {:ok, [%{name: "default", provider: :strata, config: [timeout: 240_000]}]}

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

  defp variants(other), do: {:error, "未知 provider: #{other}（支持 stub|lmstudio|strata|deepseek）"}

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
      first_attempt_pass: Enum.count(trials, &(&1.first_attempt_pass == true)),
      first_attempt_applicable: Enum.count(trials, &is_boolean(&1.first_attempt_pass)),
      correction_calls: trials |> Enum.map(& &1.correction_calls) |> Enum.sum(),
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

    scope = probe_scope(Map.get(variant, :context_shape, :bare), battery_case.text)
    source_input_ref = "author-protocol:#{battery_case.id}"

    capabilities =
      ~w(character_design character_evolution prose_writing plot_outline world_building work_archive_read)

    {:ok, run} =
      NovelDomain.AgentRun.new(%{
        run_id: "run-protocol:#{variant.name}:#{variant.context_shape}:#{battery_case.id}",
        workspace_id: "workspace_protocol_probe",
        work_id: scope.work_id,
        session_id: "session_protocol_probe",
        parent_turn_ref: source_input_ref,
        origin_frame_ref: "frame-protocol:#{battery_case.id}",
        profile_ref: "judgment_plan_v1",
        goal: %{text: battery_case.text, version: 1},
        authority_scope: %{production_write: false, allowed_tools: capabilities}
      })

    input = %{
      author_text: battery_case.text,
      source_input_ref: source_input_ref,
      scope: scope,
      supplied_context_refs: scope_refs(scope),
      options: [
        plan_run: run,
        explore: true,
        capabilities: capabilities,
        # T4 镜像修正：生产恒传 explore_tools（dialogue_planning_service），探针此前
        # 缺失导致 call2 prompt 形态与生产不同形。
        explore_tools: ExplorationService.tool_names()
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

        # 首次响应可用性：provider_call_count=1；有界纠错另外计数。
        # T1/T2c 只看最终结果，内部重试把首调自造能力名完全遮住（假绿教训）。
        %{
          protocol: :pass,
          form: form,
          judgment: judgment_outcome,
          detail: detail,
          first_attempt_pass: Map.get(judgment, :provider_call_count) == 1,
          correction_calls: max((Map.get(judgment, :provider_call_count) || 1) - 1, 0)
        }

      {:error, reason} ->
        case classify_error(reason, "judgment") do
          {:blocked, detail} ->
            %{
              protocol: :blocked,
              form: :skip,
              judgment: :skip,
              detail: detail,
              first_attempt_pass: nil,
              correction_calls: 0
            }

          {:fail, detail} ->
            %{
              protocol: :fail,
              form: :skip,
              judgment: :skip,
              detail: detail,
              first_attempt_pass: false,
              correction_calls: 1
            }
        end
    end
  end

  # 普通回复仅要求非空原文，不从自然文本抽取协议字段。
  defp check_inline_reply(narrative, _battery_case) do
    if is_binary(narrative) and String.trim(narrative) != "",
      do: :ok,
      else: {:fail, "empty_reply"}
  end

  defp check_decision(decision, battery_case) do
    action = map_get(decision, :action)

    cond do
      action not in @actions ->
        {:fail, "invalid_action:#{inspect(action) |> String.slice(0, 60)}"}

      action not in battery_case.expected ->
        {:fail,
         "judgment_mismatch:expected=#{Enum.join(battery_case.expected, "|")} got=#{action}"}

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

  # ── 固定事实夹具经唯一生产 Scope 投影，不保留自然语言 Scope 镜像 ──

  defp probe_scope(shape, author_text) do
    {work_id, title, chapters} = probe_facts(shape)

    context = %DialogueContext{
      work_id: work_id,
      current_work_snapshot: %{
        title: title,
        revision: 1,
        genre: "赛博修仙",
        tone_preference: "克制、紧张、具象"
      },
      current_chapters: Enum.map(chapters, & &1.title),
      structured_chapters: chapters,
      interaction_state: %{},
      source_status: %{work: :ok, chapters: :ok, interaction: :empty, behavior: :empty},
      assembled_at: DateTime.utc_now() |> DateTime.to_iso8601()
    }

    scope = DialoguePlanningService.judgment_scope(context, author_text)

    if shape == :bare do
      characters = [
        %{ref: "character:probe_lin_jin", work_id: work_id, name: "林烬", role: "主角，灵气稽查官"},
        %{ref: "character:probe_zhou_heng", work_id: work_id, name: "周衡", role: "配角，黑市调频师"}
      ]

      scope
      |> put_in([:facts, :characters], characters)
      |> put_in([:coverage, :characters], %{status: "complete"})
    else
      scope
    end
  end

  defp probe_facts(:bare) do
    titles = ["第01章：底层灵气账单", "第02章：矿区追击战", "第03章：黑市调频师"]

    chapters =
      titles
      |> chapter_fixtures()
      |> Enum.map(fn chapter ->
        chapter
        |> Map.put(:has_prose, chapter.seq < 3)
        |> Map.put(:prose_word_count, Enum.at([1100, 900, 0], chapter.seq - 1))
      end)

    {"ws_probe_bare", "星潮之下", chapters}
  end

  defp probe_facts(:long_run) do
    known_titles = %{
      1 => "底层灵气账单",
      25 => "残响回廊",
      26 => "灰色频段",
      27 => "矿脉深处的低语",
      28 => "断链之夜",
      29 => "回流前夜",
      30 => "临界点"
    }

    titles =
      Enum.map(1..30, fn seq ->
        "第#{String.pad_leading(to_string(seq), 2, "0")}章：" <>
          Map.get(known_titles, seq, "已采纳章节#{seq}")
      end)

    {"ws_probe_long_run", "长跑形态探针作品", chapter_fixtures(titles)}
  end

  defp probe_facts(shape) when shape in [:production, :in_run],
    do: {"ws_probe_production", "P1 单章正文草稿验证作品", chapter_fixtures(production_chapter_titles())}

  defp chapter_fixtures(titles) do
    titles
    |> Enum.with_index(1)
    |> Enum.map(fn {title, seq} ->
      %{id: "probe_chapter_#{seq}", seq: seq, title: title, has_prose: true}
    end)
  end

  defp scope_refs(scope) do
    [
      Map.fetch!(scope.facts, :work)
      | scope.facts.chapters ++ Map.get(scope.facts, :characters, [])
    ]
    |> Enum.map(& &1.ref)
  end

  defp production_chapter_titles do
    [
      "第01章：底层灵气账单",
      "第02章：旧服务器里的残诀",
      "第03章：黑市调频师",
      "第04章：巡检队的诱捕",
      "第05章：霓虹地牢试炼",
      "第06章：中层执行者的裂缝",
      "第07章：断网之城",
      "第08章：核心模块的代价",
      "第09章：伪仙直播夜",
      "第10章：反向筑基协议",
      "第11章：天台上的背叛",
      "第12章：第一卷终局：灵气回流"
    ]
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
          first_attempt_pass = cases |> Enum.map(& &1.first_attempt_pass) |> Enum.sum()

          first_attempt_applicable =
            cases |> Enum.map(& &1.first_attempt_applicable) |> Enum.sum()

          %{
            variant: result.variant,
            cases: cases,
            total_runs: total,
            blocked: blocked,
            protocol_compliance_rate: rate(protocol_pass, total - blocked),
            form_adherence_rate: rate(form_pass, form_applicable),
            judgment_accuracy: rate(judgment_pass, judgment_applicable),
            # T4 体温计：首调即合法结构的比率与重试总数（阈值暂不入闸门，先测量）。
            first_attempt_rate: rate(first_attempt_pass, first_attempt_applicable),
            correction_calls: cases |> Enum.map(& &1.correction_calls) |> Enum.sum()
          }
        end)
    }

    dir =
      System.get_env("MODEL_CONTRACT_ARTIFACT_DIR") ||
        Path.join(["artifacts", "model-contracts", provider])

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
          "judgment=#{variant.judgment_accuracy} first_attempt=#{variant.first_attempt_rate} " <>
          "correction_calls=#{variant.correction_calls} blocked=#{variant.blocked}/#{variant.total_runs}"
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

  defp env_context_shapes do
    case System.get_env("MODEL_CONTRACT_CONTEXT_SHAPES") do
      nil ->
        [:bare, :in_run, :long_run]

      value ->
        value
        |> String.split(",", trim: true)
        |> Enum.map(&String.trim/1)
        |> Enum.map(fn
          "bare" -> :bare
          "in_run" -> :in_run
          "long_run" -> :long_run
          "production" -> :production
          other -> raise "未知 MODEL_CONTRACT_CONTEXT_SHAPES: #{inspect(other)}"
        end)
    end
  end
end

ModelContracts.JudgmentProtocol.main(System.argv())
