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

  @doc """
  R5：主角未物化（VS-00G 设计负债规则族）——对照"应有设计态 vs 设计态缺位"。

  已写章数达阈值但 roster 无任何 accepted `narrative_role=PROTAGONIST` → 偏离项。
  确定性（I-L4）；主体是缺位对象无 entry_ref，source_refs 指向缺位查询证据侧
  （已扫章范围，I-L1 修订）。处置=引导物化（revise_design 变体，携盘点入口）。

  `roster`：accepted 角色 map 列表（含 `:narrative_role`）；`chapter_count`：已写章数；
  `threshold`：催办前的最小章数（策略化，默认调用方传，VS-00G OQ3=10）。
  """
  @spec protagonist_undermaterialized_finding([map()], non_neg_integer(), non_neg_integer()) ::
          finding() | nil
  def protagonist_undermaterialized_finding(roster, chapter_count, threshold)
      when is_list(roster) and is_integer(chapter_count) and is_integer(threshold) do
    has_protagonist? = Enum.any?(roster, &(protagonist_role(&1) == "PROTAGONIST"))

    cond do
      has_protagonist? ->
        nil

      chapter_count < threshold ->
        nil

      true ->
        %{
          rule: "protagonist_undermaterialized",
          ledger: "design_debt",
          severity: "warn",
          entry_ref: nil,
          signal:
            "已写 #{chapter_count} 章但作品未登记任何主角（无 PROTAGONIST 角色档案）——" <>
              "建议盘点正文中的主角团并物化，否则弧光账无记账主体、无法追踪要角连续性。",
          source_refs: ["chapters:1-#{chapter_count}"],
          proposed_disposition: "revise_design"
        }
    end
  end

  def protagonist_undermaterialized_finding(_roster, _count, _threshold), do: nil

  @doc """
  R6：全书骨架缺位（VS-00G 设计负债）——已写章数达阈值但 works 无 target_length
  （骨架未立→规划无收官守则约束，收官循环的结构缺口）。处置=引导补立项。

  `target_length`：nil/0 表示未立骨架；`chapter_count`：已写章数；`threshold`：默认 20（OQ3）。
  """
  @spec skeleton_missing_finding(integer() | nil, non_neg_integer(), non_neg_integer()) ::
          finding() | nil
  def skeleton_missing_finding(target_length, chapter_count, threshold)
      when is_integer(chapter_count) and is_integer(threshold) do
    skeleton_present? = is_integer(target_length) and target_length > 0

    cond do
      skeleton_present? ->
        nil

      chapter_count < threshold ->
        nil

      true ->
        %{
          rule: "skeleton_missing",
          ledger: "design_debt",
          severity: "warn",
          entry_ref: nil,
          signal:
            "已写 #{chapter_count} 章但作品未设定目标体量与连载形态——" <>
              "建议补全全书规划（目标字数/预计卷数/连载形态），否则规划无收官守则约束、易反复自带终局。",
          source_refs: ["chapters:1-#{chapter_count}", "work_profile:target_length"],
          proposed_disposition: "revise_design"
        }
    end
  end

  def skeleton_missing_finding(_target, _count, _threshold), do: nil

  @finale_markers ~w(终局 大结局 完结 收官 落幕)

  @doc """
  R7：提前收官（VS-00G 设计负债）——进度未达阈值%但近窗章计划已带终局/收官
  功能定位或标题（M3 收官循环病灶的检测层：收官味标题 7 次散布全书）。

  `progress_percent`：当前字数/目标体量*100（目标未立时调用方不调本规则，归 R6）；
  `recent_chapters`：近窗章计划 `[%{seq, title, chapter_role}]`；
  `progress_threshold`：低于该进度出现收官信号即偏离（策略化，默认 70）。
  """
  @spec premature_finale_finding(number(), [map()], non_neg_integer()) :: finding() | nil
  def premature_finale_finding(progress_percent, recent_chapters, progress_threshold)
      when is_number(progress_percent) and is_list(recent_chapters) and
             is_integer(progress_threshold) do
    finale_chapters = Enum.filter(recent_chapters, &finale_marker?/1)

    cond do
      progress_percent >= progress_threshold ->
        nil

      finale_chapters == [] ->
        nil

      true ->
        seqs = finale_chapters |> Enum.map(&chapter_field(&1, :seq)) |> Enum.reject(&is_nil/1)

        %{
          rule: "premature_finale",
          ledger: "design_debt",
          severity: "warn",
          entry_ref: nil,
          signal:
            "全书进度约 #{round(progress_percent)}%，但近期章计划已出现终局/收官定位" <>
              "（第 #{Enum.join(seqs, "、")} 章）——距目标体量尚远，建议调整规划；" <>
              "如确要收束请明示确认。",
          source_refs: Enum.map(seqs, &"chapter_plan:#{&1}"),
          proposed_disposition: "revise_design"
        }
    end
  end

  def premature_finale_finding(_progress, _chapters, _threshold), do: nil

  @doc """
  R8：暂定设定超龄未决（VS-00G §2.3 防护③寿命追踪）——激活中的工作假定
  挂满阈值章数仍未确认/否决 → 催办（防事实上的静默转正）。

  `assumption`：`%{id, name, narrative_role}`（调用方已按 active 过滤）；
  `chapters_since_activation`：激活后新增的已采纳章摘要数；`threshold`：OQ3=10。
  """
  @spec assumption_overdue_finding(map(), non_neg_integer(), non_neg_integer()) ::
          finding() | nil
  def assumption_overdue_finding(assumption, chapters_since_activation, threshold)
      when is_map(assumption) and is_integer(chapters_since_activation) and
             is_integer(threshold) do
    if chapters_since_activation < threshold do
      nil
    else
      name = chapter_field(assumption, :name) || "未命名"

      role_label =
        case chapter_field(assumption, :narrative_role) do
          "PROTAGONIST" -> "主角"
          _ -> "角色"
        end

      %{
        rule: "assumption_overdue",
        ledger: "design_debt",
        severity: "warn",
        entry_ref: nil,
        signal:
          "暂定设定「#{role_label}：#{name}」激活后已推进 #{chapters_since_activation} 章仍未裁决——" <>
            "创作一直按【暂定】前提展开，请在档案的暂定设定区确认（转正）或否决（停用）。",
        source_refs: ["assumption:#{chapter_field(assumption, :id)}"],
        proposed_disposition: "revise_design"
      }
    end
  end

  def assumption_overdue_finding(_assumption, _chapters, _threshold), do: nil

  defp finale_marker?(chapter) do
    text =
      [chapter_field(chapter, :title), chapter_field(chapter, :chapter_role)]
      |> Enum.map(&to_string/1)
      |> Enum.join(" ")

    Enum.any?(@finale_markers, &String.contains?(text, &1))
  end

  defp chapter_field(map, key) when is_map(map),
    do: Map.get(map, key) || Map.get(map, Atom.to_string(key))

  defp chapter_field(_map, _key), do: nil

  defp protagonist_role(character) when is_map(character) do
    character
    |> Map.get(:narrative_role, Map.get(character, "narrative_role"))
    |> case do
      role when is_binary(role) -> role
      _ -> nil
    end
  end

  defp protagonist_role(_character), do: nil

  defp bigrams(text) do
    chars =
      text
      |> String.replace(~r/【[^】]*】/u, "")
      |> String.replace(~r/[^一-鿿]/u, "")
      |> String.graphemes()

    chars |> Enum.zip(Enum.drop(chars, 1)) |> Enum.map(fn {a, b} -> a <> b end)
  end
end
