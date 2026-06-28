defmodule NovelApplication.ProseQualityValidators do
  @moduledoc """
  确定性正文质量 validator（VS-00E §11.1，非 LLM）。

  对正文文本做纯文本分析，命中模板化/直接情绪/AI 套话/结构元标签误入等问题时产出
  `QualityFinding`。文学类默认 `:warn` / 不硬阻断（ADR-0020 I7）；不依赖任何模型，可对
  CP0 基线坏样本稳定复现。语义类（场景变化/人物能动/因果等）由独立 evaluator 负责，不在此。

  纯函数，无 I/O。
  """

  alias NovelDomain.QualityFinding

  @style_gate "quality_gate.style_fit"
  @pacing_gate "quality_gate.pacing"

  # 对白触发标记（中文小说对白引号；直引号兼容）。出现任意一种即视为该段含对白。
  @dialogue_open_markers ["「", "『", "“", "\"", "”"]
  # 「长段落零对白」判定阈值：句子数 ≥ 此值且全段无对白标记 → 偏叙述、节奏可能拖慢。
  # 保守取值，避免误伤短促动作 beat（少于该句数）与正常含对白段落。
  @dialogue_free_sentence_threshold 8

  # 高频身体反应模板（≥ 阈值视为模板化）
  @body_reaction_patterns [
    ~r/心脏(猛地)?一[跳颤]/u,
    ~r/瞳孔(骤然|猛地)?收缩/u,
    ~r/拳头(不自觉|不由得)?(握紧|攥紧)/u,
    ~r/后背(渗出|沁出|冒出).{0,3}(冷|凉)汗/u,
    ~r/倒吸(一口|了一口)(凉|冷)气/u,
    ~r/喉咙(发紧|一紧)/u
  ]

  # AI 套话指纹（含本地模型真实高频：一阵/微微/缓缓/一丝；见 prose-ai-taste-findings 记忆）
  @ai_cliche_patterns [
    ~r/随着/u,
    ~r/在.{1,12}中/u,
    ~r/阳光洒落/u,
    ~r/不由得/u,
    ~r/仿佛/u,
    ~r/一阵/u,
    ~r/微微/u,
    ~r/缓缓/u,
    ~r/一丝/u
  ]

  # 直接情绪声明（show-don't-tell 失衡）
  @direct_emotion_patterns [
    ~r/感到(很|非常|十分|有些|一阵)?(愤怒|悲伤|害怕|恐惧|高兴|幸福|紧张|开心|难过|绝望|喜悦|兴奋|失落)/u,
    ~r/(他|她|它|我)(很|非常|十分)(愤怒|悲伤|害怕|高兴|幸福|紧张|难过|绝望|兴奋)/u,
    ~r/觉得(很|非常|十分)?(感人|难过|开心|愤怒|害怕|幸福)/u
  ]

  # 结构/状态元标签不应出现在正文 body
  @meta_label_patterns [
    ~r/场景\s*[0-9０-９一二三四五六七八九十]+/u,
    ~r/第\s*[0-9０-９一二三四五六七八九十]+\s*场/u,
    ~r/正文草稿/u,
    ~r/待采纳草稿/u,
    ~r/(^|\n)\s*标题[:：]/u
  ]

  @doc """
  对正文文本运行全部确定性 validator，返回 `[QualityFinding]`（可能为空）。

  `ctx`：`%{source_ref, source_turn_ref, source_type}`，写入 finding 溯源字段。
  """
  @spec evaluate(String.t() | nil, map()) :: [QualityFinding.t()]
  def evaluate(text, ctx \\ %{})

  def evaluate(text, ctx) when is_binary(text) and text != "" do
    [
      direct_emotion_finding(text, ctx),
      body_reaction_finding(text, ctx),
      ai_cliche_finding(text, ctx),
      sentence_start_repetition_finding(text, ctx),
      uniform_line_finding(text, ctx),
      meta_label_leak_finding(text, ctx),
      dialogue_density_finding(text, ctx)
    ]
    |> Enum.reject(&is_nil/1)
  end

  def evaluate(_text, _ctx), do: []

  # ── 直接情绪标签 → emotion_expression_balance ──────
  defp direct_emotion_finding(text, ctx) do
    hits = pattern_hits(text, @direct_emotion_patterns)

    if length(hits) >= 2 do
      finding(
        ctx,
        "validator.emotion_expression_balance",
        @style_gate,
        "情绪被直接声明而非戏剧化（show-don't-tell 失衡）：命中 #{length(hits)} 处直接情绪断言。",
        hits
      )
    end
  end

  # ── 身体反应模板 → prose_pattern_repetition ────────
  defp body_reaction_finding(text, ctx) do
    hits = pattern_hits(text, @body_reaction_patterns)

    if length(hits) >= 3 do
      finding(
        ctx,
        "validator.prose_pattern_repetition",
        @style_gate,
        "身体反应模板高频重复：命中 #{length(hits)} 处套路化生理反应。",
        hits
      )
    end
  end

  # ── AI 套话 → prose_pattern_repetition ─────────────
  defp ai_cliche_finding(text, ctx) do
    hits = pattern_hits(text, @ai_cliche_patterns)

    if length(hits) >= 4 do
      finding(
        ctx,
        "validator.prose_pattern_repetition",
        @style_gate,
        "AI 套话式表达偏多：命中 #{length(hits)} 处（如 随着/仿佛/一阵/微微/缓缓）。",
        hits
      )
    end
  end

  # ── 连续句首重复 → prose_pattern_repetition ─────────
  defp sentence_start_repetition_finding(text, ctx) do
    starts =
      text
      |> split_sentences()
      |> Enum.map(&String.slice(&1, 0, 2))
      |> Enum.reject(&(&1 == ""))

    if max_consecutive_run(starts) >= 3 do
      finding(
        ctx,
        "validator.prose_pattern_repetition",
        @style_gate,
        "连续多句句首雷同，行文模板化。",
        []
      )
    end
  end

  # ── 段落/行结构过度均匀 → prose_pattern_repetition ──
  defp uniform_line_finding(text, ctx) do
    lines =
      text
      |> String.split(~r/\n|。/u)
      |> Enum.map(&String.trim/1)
      |> Enum.reject(&(&1 == ""))

    groups =
      lines
      |> Enum.group_by(fn line ->
        {String.slice(line, 0, 1), line |> String.graphemes() |> Enum.count(&(&1 in ["，", ","]))}
      end)

    if Enum.any?(groups, fn {_k, v} -> length(v) >= 3 end) and length(lines) >= 3 do
      finding(
        ctx,
        "validator.prose_pattern_repetition",
        @style_gate,
        "多行句子结构与长度高度雷同（同句首、同标点骨架），缺乏节奏变化。",
        []
      )
    end
  end

  # ── 结构元标签误入正文 → prose_pattern_repetition ──
  defp meta_label_leak_finding(text, ctx) do
    hits = pattern_hits(text, @meta_label_patterns)

    if hits != [] do
      finding(
        ctx,
        "validator.prose_pattern_repetition",
        @style_gate,
        "正文 body 出现结构/状态元标签（如 场景N / 第N场 / 标题：），不属于小说正文。",
        hits
      )
    end
  end

  # ── 长段落零对白 → pacing（节奏偏叙述） ──────────────
  # §6.6 节奏检查的确定性兜底：一段足够长的正文若完全没有对白，往往叙述/描写密度过高、
  # 推进偏慢（网文场景尤甚）。这是建议性 WARN、作者可越过（ADR-0020 I7）；语义层的节奏判断
  # （是否拖慢主目标、是否连续疲劳）仍由独立 evaluator 负责，这里只抓"整段无对白"这一确定性信号。
  defp dialogue_density_finding(text, ctx) do
    sentence_count = text |> split_sentences() |> length()

    if sentence_count >= @dialogue_free_sentence_threshold and dialogue_marker_count(text) == 0 do
      finding(
        ctx,
        "validator.dialogue_density",
        @pacing_gate,
        "整段正文（#{sentence_count} 句）完全没有对白，叙述/描写密度偏高，节奏可能偏慢——" <>
          "如本就是纯叙述过场可忽略，否则考虑加入对白或人物互动提速。",
        []
      )
    end
  end

  defp dialogue_marker_count(text) do
    Enum.reduce(@dialogue_open_markers, 0, fn marker, acc ->
      acc + (text |> String.split(marker) |> length() |> Kernel.-(1))
    end)
  end

  # ── helpers ────────────────────────────────────────

  defp pattern_hits(text, patterns) do
    Enum.flat_map(patterns, fn re -> Regex.scan(re, text) |> Enum.map(&hd/1) end)
  end

  defp split_sentences(text) do
    text
    |> String.split(~r/[。！？!?\n]/u)
    |> Enum.map(&String.trim/1)
    |> Enum.reject(&(&1 == ""))
  end

  defp max_consecutive_run(list) do
    list
    |> Enum.chunk_by(& &1)
    |> Enum.map(&length/1)
    |> Enum.max(fn -> 0 end)
  end

  defp finding(ctx, validator, gate, summary, evidence_hits) do
    QualityFinding.new(%{
      quality_gate_ref: gate,
      validator_ref: validator,
      source_ref: Map.get(ctx, :source_ref),
      source_type: Map.get(ctx, :source_type, :prose_fragment),
      source_turn_ref: Map.get(ctx, :source_turn_ref),
      severity: :warn,
      action: :warn,
      summary: summary,
      evidence_spans: evidence_spans(evidence_hits),
      can_override: true
    })
  end

  defp evidence_spans(hits) do
    hits
    |> Enum.uniq()
    |> Enum.take(5)
    |> Enum.map(fn text -> %{"text" => text} end)
  end
end
