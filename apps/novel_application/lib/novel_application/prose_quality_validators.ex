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
  # B9（M2 Q2/Q3 修向）：章号叙述自指与工作流程词都是元泄漏——正文只写故事本身。
  # D1/D2（M5 实锤，2026-08-25）：叙事层元词入表——档案真空下模型把「主角」当人称
  # 写进正文（41 处/5 章，M3 旧模型族 0 处）；正文只许具名人物，不许叙事标签。
  @meta_label_patterns [
    ~r/场景\s*[0-9０-９一二三四五六七八九十]+/u,
    ~r/第\s*[0-9０-９一二三四五六七八九十]+\s*场/u,
    ~r/第\s*[0-9０-９一二三四五六七八九十百千]+\s*章/u,
    ~r/正文草稿/u,
    ~r/待采纳/u,
    ~r/审校/u,
    ~r/(^|\n)\s*标题[:：]/u,
    ~r/主角/u,
    ~r/反派/u,
    ~r/配角/u
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
      meta_label_leak_finding(text, ctx)
    ]
    |> Enum.reject(&is_nil/1)
  end

  def evaluate(_text, _ctx), do: []

  @doc """
  B9：元泄漏命中扫描——导出质量门与生成期 validator 复用同一 pattern 集
  （章号自指/工作流程词/结构标签），单一规则源。
  """
  @spec meta_leak_hits(String.t()) :: [String.t()]
  def meta_leak_hits(text) when is_binary(text), do: pattern_hits(text, @meta_label_patterns)
  def meta_leak_hits(_text), do: []

  # ── 直接情绪标签 → emotion_expression_balance ──────
  defp direct_emotion_finding(text, ctx) do
    hits = pattern_hits(text, @direct_emotion_patterns)

    if length(hits) >= 2 do
      finding(
        ctx,
        "validator.emotion_expression_balance",
        @style_gate,
        "情绪被直接声明而非戏剧化（show-don't-tell 失衡）：命中 #{length(hits)} 处直接情绪断言。",
        text,
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
        text,
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
        text,
        hits
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
        "正文 body 出现结构/状态元标签、工作流程词或叙事层元词（如 场景N / 第N章 / 待采纳 / 主角 / 反派），不属于小说正文。",
        text,
        hits
      )
    end
  end

  # ── helpers ────────────────────────────────────────

  defp pattern_hits(text, patterns) do
    Enum.flat_map(patterns, fn re -> Regex.scan(re, text) |> Enum.map(&hd/1) end)
  end

  defp finding(ctx, validator, gate, summary, source_text, evidence_hits) do
    evidence = evidence_spans(source_text, evidence_hits)

    QualityFinding.new(%{
      quality_gate_ref: gate,
      validator_ref: validator,
      source_ref: Map.get(ctx, :source_ref),
      source_type: Map.get(ctx, :source_type, :prose_fragment),
      source_turn_ref: Map.get(ctx, :source_turn_ref),
      severity: :warn,
      action: :warn,
      summary: summary,
      reasoning: "确定性规则在正文中命中 #{length(evidence)} 处可定位证据。",
      confidence: 0.92,
      evidence_spans: evidence,
      impact_scope: :local,
      revision_scope: :local,
      suggested_revision: %{"instruction" => "优先只修改命中表达，保留其余原文。"},
      can_override: true
    })
  end

  defp evidence_spans(source_text, hits) do
    hits
    |> Enum.uniq()
    |> Enum.take(5)
    |> Enum.map(fn text ->
      {start_offset, byte_length} = :binary.match(source_text, text)
      sentence_index = sentence_index_at(source_text, start_offset)

      %{
        "text" => text,
        "location" => "正文第 #{sentence_index} 句",
        "sentence_start" => sentence_index,
        "sentence_end" => sentence_index,
        "start_offset" => start_offset,
        "end_offset" => start_offset + byte_length
      }
    end)
  end

  defp sentence_index_at(source_text, start_offset) do
    source_text
    |> binary_part(0, start_offset)
    |> then(&(length(Regex.scan(~r/[。！？!?]/u, &1)) + 1))
  end
end
