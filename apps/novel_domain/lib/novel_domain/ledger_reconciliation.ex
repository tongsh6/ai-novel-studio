defmodule NovelDomain.LedgerReconciliation do
  @moduledoc """
  三态对账规则纯函数（VS-00F §3 / ADR-0026，CP2a 首版：R1/R3/R4）。

  I-L4 规则确定性：同输入同输出，模型不参与判定；阈值调整只经 Experience 回路
  policy proposal。规则只产**偏离项（finding）**，不改任何权威对象（I-L2 对账
  只读）。全部阈值以 M2 达标跑 75 章书重放实测校准（2026-07-21）：

  - R1 弧光停滞：arc 条目处 STALLED（CP1 机械规则已判，报告聚合呈现）。
  - R3 承诺偏移（genre）：身份锚点=早期窗口高频 ∧ 全书文档频率 ≤ 上限的二元词
    （作品自身早期摘要自识别，无外部词典）；末窗口锚点归零比例 ≥ 阈值 → BROKEN
    候选。M2 实测：锚点[调频 公司 灵气 网络 入口 利用 决心 散修]，末10章归零
    4/8=0.5 命中（正因=修仙-赛博身份词消失于星际歌剧段）。
  - R4 前指泄露：正文出现「第N章」且 N > 本章 seq（计划信息泄进实现态）。
    M2 实测：第53章正文前指第60章，恰为人工 Q3 审计靶。

  R2（无设计接管）需 design_ref 数据基础（章计划回填），CP2b 落地。
  """

  @early_window 5
  @early_min_count 3
  @max_doc_freq 0.5
  @anchor_top 8
  # 最小锚点数护栏：幸存锚点过少时单点归零即达比例阈值，证据不足诚实弃权不判
  # （单测实锤的边界：全书同质词被文档频率滤尽只剩 1 个伪锚点的病理形态）。
  @min_anchors 4
  @late_window 10
  @zero_ratio_threshold 0.5

  @type finding :: %{
          rule: String.t(),
          ledger: String.t(),
          severity: String.t(),
          entry_ref: String.t() | nil,
          signal: String.t(),
          source_refs: [String.t()],
          proposed_disposition: String.t()
        }

  @doc "R1：弧光停滞聚合——STALLED 的 arc 条目逐条成偏离项。"
  @spec arc_stalled_findings([map()]) :: [finding()]
  def arc_stalled_findings(arc_entries) when is_list(arc_entries) do
    arc_entries
    |> Enum.filter(&(&1.status == "STALLED"))
    |> Enum.map(fn entry ->
      seen = Map.get(entry.payload || %{}, "last_seen_seq")

      %{
        rule: "arc_stalled",
        ledger: "arc",
        severity: "warn",
        entry_ref: entry.id,
        signal: "#{entry.subject_label} 自第#{inspect(seen)}章后未再出场（停滞阈值超限）",
        source_refs: entry.source_refs || [],
        proposed_disposition: "revise_design"
      }
    end)
  end

  @doc """
  身份锚点自识别：早期窗口（前 #{@early_window} 章）摘要中出现 ≥ #{@early_min_count}
  次、且全书文档频率 ≤ #{@max_doc_freq} 的二元词（过滤摘要模板词），排除给定名单
  （roster 人名），取前 #{@anchor_top}。输入 `[{seq, summary_text}]`。
  """
  @spec identity_anchors([{non_neg_integer(), String.t()}], [String.t()]) :: [String.t()]
  def identity_anchors(summaries_by_seq, exclude \\ []) do
    total = length(summaries_by_seq)

    if total == 0 do
      []
    else
      doc_freq =
        summaries_by_seq
        |> Enum.flat_map(fn {_seq, text} -> text |> bigrams() |> Enum.uniq() end)
        |> Enum.frequencies()

      summaries_by_seq
      |> Enum.filter(fn {seq, _} -> seq <= @early_window end)
      |> Enum.flat_map(fn {_seq, text} -> bigrams(text) end)
      |> Enum.frequencies()
      |> Enum.filter(fn {gram, count} ->
        count >= @early_min_count and gram not in exclude and
          Map.get(doc_freq, gram, 0) / total <= @max_doc_freq
      end)
      |> Enum.sort_by(fn {gram, count} -> {-count, gram} end)
      |> Enum.take(@anchor_top)
      |> Enum.map(&elem(&1, 0))
    end
  end

  @doc """
  R3：genre 承诺偏移。末 #{@late_window} 章窗口中归零的身份锚点比例 ≥
  #{@zero_ratio_threshold} → BROKEN 候选偏离项；否则 nil。
  """
  @spec genre_promise_finding(map() | nil, [{non_neg_integer(), String.t()}], [String.t()]) ::
          finding() | nil
  def genre_promise_finding(promise_entry, summaries_by_seq, exclude \\ [])

  def genre_promise_finding(nil, _summaries, _exclude), do: nil

  def genre_promise_finding(promise_entry, summaries_by_seq, exclude) do
    anchors = identity_anchors(summaries_by_seq, exclude)

    with true <- length(anchors) >= @min_anchors,
         max_seq when is_integer(max_seq) <-
           summaries_by_seq |> Enum.map(&elem(&1, 0)) |> Enum.max(fn -> nil end),
         true <- max_seq > @early_window + @late_window do
      late_text =
        summaries_by_seq
        |> Enum.filter(fn {seq, _} -> seq > max_seq - @late_window end)
        |> Enum.map_join("", &elem(&1, 1))

      zeroed = Enum.filter(anchors, &(not String.contains?(late_text, &1)))

      if length(zeroed) / length(anchors) >= @zero_ratio_threshold do
        %{
          rule: "genre_promise_shift",
          ledger: "promise",
          severity: "critical",
          entry_ref: promise_entry.id,
          signal:
            "作品早期身份锚点 #{Enum.join(zeroed, "/")} 在末#{@late_window}章窗口归零" <>
              "（#{length(zeroed)}/#{length(anchors)}）——类型承诺 BROKEN 候选",
          source_refs: promise_entry.source_refs || [],
          proposed_disposition: "revise_design"
        }
      end
    else
      _ -> nil
    end
  end

  @doc "R4：前指泄露——文本出现「第N章」且 N > 本章 seq，返回未来章号列表。"
  @spec future_chapter_refs(String.t() | nil, non_neg_integer()) :: [pos_integer()]
  def future_chapter_refs(text, current_seq) when is_binary(text) do
    ~r/第(\d{1,3})章/
    |> Regex.scan(text)
    |> Enum.map(fn [_, n] -> String.to_integer(n) end)
    |> Enum.filter(&(&1 > current_seq))
    |> Enum.uniq()
  end

  def future_chapter_refs(_text, _seq), do: []

  defp bigrams(text) do
    chars =
      text
      |> String.replace(~r/【[^】]*】/u, "")
      |> String.replace(~r/[^一-鿿]/u, "")
      |> String.graphemes()

    chars |> Enum.zip(Enum.drop(chars, 1)) |> Enum.map(fn {a, b} -> a <> b end)
  end
end
