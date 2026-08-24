defmodule NovelDomain.ChapterMissionInputs do
  @moduledoc """
  写前推理的携带选取（WR01；四层体系 ②携带层的首个按坐标选取器）。

  输入：目标章的设计态（`ChapterPlanDirection` + 场次）、进度态（五本账条目 +
  已写进度 + 全书骨架）、在场角色阵容。输出：一组带稳定 `ref` 的材料条目——
  推理步的模型只能引用这些 ref 作为依据，不在集合内的依据由
  `NovelDomain.ChapterMission.bind/2` 机械丢弃（I-M1）。

  选取口径不新设阈值（I-M5，用户 2026-08-11 两次否决全局阈值）：
  - 伏笔：有预期（chapter/volume 型）的按预期临近排序、已超期标注；无预期型只计数；
  - 计划信息：HIDDEN 的后续章 plan_info 列为「不得提前揭示」；
  - 弧光：STALLED 优先，其余按最近出场倒序；
  - 主线 / 题材承诺：取当前状态一行；
  - 情绪曲线：最近三章；
  - 全书进度：骨架在场时给百分比与收官守则信号。

  纯函数，不做 I/O（domain 纪律）。
  """

  alias NovelDomain.ChapterPlanDirection
  alias NovelDomain.WorkSkeleton

  @type item :: %{ref: String.t(), group: atom(), text: String.t()}

  @type mode :: :prose | :planning

  @type t :: %__MODULE__{
          mode: mode(),
          chapter: map() | nil,
          items: [item()],
          undated_foreshadow_count: non_neg_integer(),
          written_progress: map() | nil
        }

  # mode（WR02）：:prose = 写某一章前（目标章设计态在场）；:planning = 规划下一批章前
  # （无目标章，材料含「已规划待写的章」，保密清单不豁免任何章）。
  defstruct mode: :prose,
            chapter: nil,
            items: [],
            undated_foreshadow_count: 0,
            written_progress: nil

  @max_foreshadows 5
  @max_secrecy 3
  @max_arcs 6
  @max_emotion 3
  @max_roster 6

  @doc """
  构建携带材料。

  - `chapter`：`%{seq, title, summary, plan_direction}`（`plan_direction` 为存储 map 或
    `ChapterPlanDirection`），可为 nil（目标章未定时只带进度态）
  - `entries`：五本账条目（`LedgerEntry` 或同形 map）
  - `written_progress`：`%{chapter_seq, volume_seq}` 或 nil
  - `work_snapshot`：含 `target_length/planned_volumes/serial_form` 的作品快照
  - `written_chapters`：已写章数（骨架进度口径）
  - `roster`：`[%{name, narrative_role, role}]`
  - `previous_summary`：上一章实现态摘要文本（可 nil）
  """
  @spec build(map()) :: t()
  def build(attrs) when is_map(attrs) do
    mode = if Map.get(attrs, :mode) == :planning, do: :planning, else: :prose
    chapter = normalize_chapter(Map.get(attrs, :chapter))
    entries = List.wrap(Map.get(attrs, :entries, []))
    progress = normalize_progress(Map.get(attrs, :written_progress))

    {foreshadow_items, undated} = foreshadow_items(entries, progress)

    items =
      plan_items(chapter) ++
        planned_chapter_items(Map.get(attrs, :planned_chapters)) ++
        previous_summary_items(chapter, Map.get(attrs, :previous_summary)) ++
        foreshadow_items ++
        secrecy_items(entries, chapter) ++
        arc_items(entries) ++
        conflict_items(entries) ++
        promise_items(entries) ++
        emotion_items(entries) ++
        skeleton_items(Map.get(attrs, :work_snapshot), Map.get(attrs, :written_chapters)) ++
        roster_items(Map.get(attrs, :roster))

    %__MODULE__{
      mode: mode,
      chapter: chapter,
      items: items,
      undated_foreshadow_count: undated,
      written_progress: progress
    }
  end

  @doc "全部可引用的依据 ref。"
  @spec refs(t()) :: MapSet.t()
  def refs(%__MODULE__{items: items}), do: items |> Enum.map(& &1.ref) |> MapSet.new()

  @spec known_ref?(t(), String.t()) :: boolean()
  def known_ref?(%__MODULE__{} = inputs, ref) when is_binary(ref),
    do: MapSet.member?(refs(inputs), ref)

  def known_ref?(_inputs, _ref), do: false

  @doc "按 ref 取材料文本（使命条目回填 basis_label 用）。"
  @spec label(t(), String.t()) :: String.t() | nil
  def label(%__MODULE__{items: items}, ref) do
    case Enum.find(items, &(&1.ref == ref)) do
      nil -> nil
      item -> item.text
    end
  end

  @spec empty?(t()) :: boolean()
  def empty?(%__MODULE__{items: []}), do: true
  def empty?(_inputs), do: false

  @doc """
  渲染为推理 prompt 的材料段（中文，逐条 `[ref] 文本`）。ref 原样列出，让模型
  只能引用已列名的依据。
  """
  @spec to_prompt_section(t()) :: String.t()
  def to_prompt_section(%__MODULE__{} = inputs) do
    groups = [
      {:plan, "本章计划（设计态）"},
      {:planned, "已规划待写的章（设计态）"},
      {:previous_summary, "上一章实际写到哪（实现态摘要）"},
      {:foreshadow, "未回收伏笔（进度态，按预期临近）"},
      {:secrecy, "后续章计划信息（不得提前揭示）"},
      {:arc, "角色弧光（进度态）"},
      {:conflict, "主线冲突（进度态）"},
      {:promise, "题材承诺（进度态）"},
      {:emotion, "最近情绪曲线（进度态）"},
      {:skeleton, "全书进度"},
      {:roster, "在场角色"}
    ]

    sections =
      groups
      |> Enum.map(fn {group, title} ->
        lines =
          inputs.items
          |> Enum.filter(&(&1.group == group))
          |> Enum.map(&"- [#{&1.ref}] #{&1.text}")

        lines = lines ++ extra_lines(group, inputs)

        if lines == [], do: nil, else: "### #{title}\n" <> Enum.join(lines, "\n")
      end)
      |> Enum.reject(&is_nil/1)

    header =
      if inputs.mode == :planning,
        do: planning_header(),
        else: chapter_header(inputs.chapter)

    [header | sections]
    |> Enum.reject(&blank?/1)
    |> Enum.join("\n\n")
  end

  # ── 选取 ────────────────────────────────────────────

  defp plan_items(nil), do: []

  defp plan_items(%{seq: seq, direction: %ChapterPlanDirection{} = direction}) do
    fields =
      [
        {"chapter_role", "章功能定位", direction.chapter_role},
        {"plot_progress", "情节推进", direction.plot_progress},
        {"character_change", "人物变化", direction.character_change},
        {"information_release", "信息释放", direction.information_release},
        {"foreshadowing_action", "伏笔动作", direction.foreshadowing_action},
        {"emotion", "情绪定位", direction.emotion},
        {"opening_hook", "章首拉力", direction.opening_hook},
        {"ending_hook", "章尾断章", direction.ending_hook}
      ]
      |> Enum.reject(fn {_key, _label, value} -> blank?(value) end)
      |> Enum.map(fn {key, label, value} ->
        item("plan:#{seq}:#{key}", :plan, "#{label}：#{value}")
      end)

    scenes =
      direction.scene_plans
      |> Enum.with_index(1)
      |> Enum.map(fn {plan, index} ->
        text =
          [
            plan["title"],
            plan["goal"] && "目标：#{plan["goal"]}",
            plan["agendas"] && "议程：#{plan["agendas"]}",
            plan["emotion"] && "情绪：#{plan["emotion"]}"
          ]
          |> Enum.reject(&(&1 in [nil, false]))
          |> Enum.join("｜")

        item("plan:#{seq}:scene:#{index}", :plan, "场次#{index}：#{text}")
      end)

    fields ++ scenes
  end

  defp plan_items(%{seq: seq, summary: summary}) when is_binary(summary) and summary != "",
    do: [item("plan:#{seq}:summary", :plan, "计划摘要：#{summary}")]

  defp plan_items(_chapter), do: []

  # WR02 规划模式：已规划但未写的章作为材料（新批大纲要接着它们排）。
  defp planned_chapter_items(chapters) when is_list(chapters) do
    chapters
    |> Enum.map(&normalize_planned_chapter/1)
    |> Enum.reject(&is_nil/1)
    |> Enum.take(8)
    |> Enum.map(fn %{seq: seq, title: title, summary: summary} ->
      text =
        [title, summary && "计划：#{summary}"]
        |> Enum.reject(&(&1 in [nil, false, ""]))
        |> Enum.join("；")

      item("plan:#{seq}:summary", :planned, text)
    end)
  end

  defp planned_chapter_items(_chapters), do: []

  defp normalize_planned_chapter(%{} = chapter) do
    seq = map_value(chapter, :seq)
    title = map_value(chapter, :title)

    if is_integer(seq) and is_binary(title) and title != "" do
      %{seq: seq, title: title, summary: map_value(chapter, :summary)}
    end
  end

  defp normalize_planned_chapter(_), do: nil

  defp previous_summary_items(%{seq: seq}, summary)
       when is_integer(seq) and seq > 1 and is_binary(summary) do
    case String.trim(summary) do
      "" -> []
      text -> [item("chapter_summary:#{seq - 1}", :previous_summary, text)]
    end
  end

  defp previous_summary_items(_chapter, _summary), do: []

  defp foreshadow_items(entries, progress) do
    hidden =
      Enum.filter(entries, fn entry ->
        field(entry, :ledger) == "information" and field(entry, :status) == "HIDDEN" and
          String.starts_with?(to_string(field(entry, :subject_ref)), "foreshadow_")
      end)

    {dated, undated} = Enum.split_with(hidden, &expectation/1)

    items =
      dated
      |> Enum.sort_by(fn entry -> elem(expectation(entry), 1) end)
      |> Enum.take(@max_foreshadows)
      |> Enum.map(fn entry ->
        {kind, seq} = expectation(entry)
        label = field(entry, :subject_label) || "伏笔"

        expect =
          case kind do
            "chapter" -> "预期第#{seq}章回收"
            "volume" -> "预期第#{seq}卷内回收"
          end

        status = overdue_note(kind, seq, progress)
        fact = payload_value(entry, "fact")

        text =
          ["#{label}（#{expect}#{status}）", fact && "内容：#{fact}"]
          |> Enum.reject(&(&1 in [nil, false]))
          |> Enum.join("；")

        item(ledger_ref(entry), :foreshadow, text)
      end)

    {items, length(undated)}
  end

  defp expectation(entry) do
    case payload_value(entry, "planned_reveal") do
      %{"kind" => kind, "seq" => seq} when kind in ["chapter", "volume"] and is_integer(seq) ->
        {kind, seq}

      _ ->
        nil
    end
  end

  defp overdue_note("chapter", seq, %{chapter_seq: written}) when is_integer(written) do
    cond do
      written > seq -> "，已超期"
      written == seq - 1 -> "，本章到期"
      true -> ""
    end
  end

  defp overdue_note("volume", seq, %{volume_seq: written}) when is_integer(written) do
    if written > seq, do: "，已超期", else: ""
  end

  defp overdue_note(_kind, _seq, _progress), do: ""

  defp secrecy_items(entries, chapter) do
    current_seq = chapter && Map.get(chapter, :seq)

    entries
    |> Enum.filter(fn entry ->
      field(entry, :ledger) == "information" and field(entry, :status) == "HIDDEN" and
        String.starts_with?(to_string(field(entry, :subject_ref)), "plan_info_")
    end)
    |> Enum.reject(fn entry ->
      # 目标章自己的计划信息不是「不得揭示」——那正是本章要写的
      is_integer(current_seq) and payload_value(entry, "planned_reveal_seq") == current_seq
    end)
    |> Enum.sort_by(&(payload_value(&1, "planned_reveal_seq") || 0))
    |> Enum.take(@max_secrecy)
    |> Enum.map(fn entry ->
      seq = payload_value(entry, "planned_reveal_seq")
      item(ledger_ref(entry), :secrecy, "第#{seq}章前保密：#{payload_value(entry, "fact")}")
    end)
  end

  defp arc_items(entries) do
    entries
    |> Enum.filter(&(field(&1, :ledger) == "arc"))
    |> Enum.sort_by(fn entry ->
      stalled = if field(entry, :status) == "STALLED", do: 0, else: 1
      {stalled, -(payload_value(entry, "last_seen_seq") || 0)}
    end)
    |> Enum.take(@max_arcs)
    |> Enum.map(fn entry ->
      last_seen = payload_value(entry, "last_seen_seq")
      note = payload_value(entry, "presence_note")

      text =
        [
          "#{field(entry, :subject_label)}：#{field(entry, :status)}",
          last_seen && "最近出场第#{last_seen}章",
          note
        ]
        |> Enum.reject(&(&1 in [nil, false, ""]))
        |> Enum.join("，")

      item(ledger_ref(entry), :arc, text)
    end)
  end

  defp conflict_items(entries) do
    case Enum.find(
           entries,
           &(field(&1, :ledger) == "conflict" and field(&1, :subject_ref) == "main")
         ) do
      nil ->
        []

      main ->
        seq = payload_value(main, "last_advanced_seq")
        text = "主线：#{field(main, :status)}" <> if(seq, do: "，最近推进第#{seq}章", else: "")
        [item(ledger_ref(main), :conflict, text)]
    end
  end

  defp promise_items(entries) do
    case Enum.find(
           entries,
           &(field(&1, :ledger) == "promise" and field(&1, :subject_ref) == "genre")
         ) do
      nil ->
        []

      promise ->
        content = payload_value(promise, "content")

        text =
          "#{field(promise, :subject_label)}：#{field(promise, :status)}" <>
            if(content, do: "（#{content}）", else: "")

        [item(ledger_ref(promise), :promise, text)]
    end
  end

  defp emotion_items(entries) do
    entries
    |> Enum.filter(&(field(&1, :ledger) == "emotion_curve"))
    |> Enum.sort_by(&(-(payload_value(&1, "seq") || 0)))
    |> Enum.take(@max_emotion)
    |> Enum.reverse()
    |> Enum.map(fn entry ->
      seq = payload_value(entry, "seq")
      intended = payload_value(entry, "intended")
      realized = payload_value(entry, "realized")

      text =
        "第#{seq}章：设计「#{intended || "未设计"}」→ 实写「#{realized || "未提炼"}」（#{field(entry, :status)}）"

      item(ledger_ref(entry), :emotion, text)
    end)
  end

  defp skeleton_items(snapshot, written) when is_map(snapshot) and is_integer(written) do
    case WorkSkeleton.progress(snapshot, written) do
      nil ->
        []

      %{target_length: target, est_chapters: est, percent: percent} ->
        closing =
          if percent >= round(WorkSkeleton.closure_threshold() * 100),
            do: "，已接近目标体量，可进入收束",
            else: "，距目标尚远，不得提前收官"

        [
          item(
            "skeleton:progress",
            :skeleton,
            "目标约 #{target} 字（预计 #{est} 章），已写 #{written} 章（约 #{percent}%）#{closing}"
          )
        ]
    end
  end

  defp skeleton_items(_snapshot, _written), do: []

  defp roster_items(roster) when is_list(roster) do
    roster
    |> Enum.map(&normalize_character/1)
    |> Enum.reject(&is_nil/1)
    |> Enum.sort_by(fn c -> if c.narrative_role == "PROTAGONIST", do: 0, else: 1 end)
    |> Enum.take(@max_roster)
    |> Enum.map(fn c ->
      tags =
        [c.narrative_role && role_label(c.narrative_role), c.role]
        |> Enum.reject(&(&1 in [nil, false, ""]))
        |> Enum.join("，")

      text = if tags == "", do: c.name, else: "#{c.name}（#{tags}）"
      item("roster:#{c.ref}", :roster, text)
    end)
  end

  defp roster_items(_roster), do: []

  defp normalize_character(%{} = c) do
    name = map_value(c, :name)

    if is_binary(name) and name != "" do
      %{
        ref: to_string(map_value(c, :id) || name),
        name: name,
        narrative_role: map_value(c, :narrative_role) |> to_optional_string(),
        role: map_value(c, :role) |> to_optional_string()
      }
    end
  end

  defp normalize_character(_), do: nil

  defp role_label("PROTAGONIST"), do: "主角"
  defp role_label("ANTAGONIST"), do: "反派"
  defp role_label("SUPPORTING"), do: "配角"
  defp role_label(other), do: other

  # ── 渲染 helpers ─────────────────────────────────────

  defp extra_lines(:foreshadow, %{undated_foreshadow_count: n}) when n > 0,
    do: ["- 另有 #{n} 条长线伏笔未回收（贯穿全书/未定预期，不逐条列，本章不强求推进）"]

  defp extra_lines(_group, _inputs), do: []

  defp chapter_header(nil), do: "目标章：未定（按进度态推导）"

  defp chapter_header(%{seq: seq, title: title}) do
    seq_text = if is_integer(seq), do: "第#{seq}章 ", else: ""
    "目标章：#{seq_text}#{title || ""}" |> String.trim()
  end

  defp planning_header, do: "本轮规划（按当前进度态推导接下来该规划什么）"

  # ── 归一化 ──────────────────────────────────────────

  defp normalize_chapter(nil), do: nil

  defp normalize_chapter(%{} = chapter) do
    direction =
      case map_value(chapter, :plan_direction) do
        %ChapterPlanDirection{} = d -> d
        other -> ChapterPlanDirection.from_storage(other)
      end

    %{
      seq: map_value(chapter, :seq),
      title: map_value(chapter, :title),
      summary: map_value(chapter, :summary),
      direction: direction
    }
  end

  defp normalize_chapter(_), do: nil

  defp normalize_progress(%{} = progress) do
    %{
      chapter_seq: map_value(progress, :chapter_seq),
      volume_seq: map_value(progress, :volume_seq)
    }
  end

  defp normalize_progress(_), do: nil

  defp ledger_ref(entry), do: "ledger:#{field(entry, :ledger)}:#{field(entry, :subject_ref)}"

  defp item(ref, group, text), do: %{ref: ref, group: group, text: text}

  # 账本 payload 落库为 string key（LedgerRepository / adoption_repository 同源），只按字符串取。
  defp payload_value(entry, key) do
    case field(entry, :payload) do
      %{} = payload -> Map.get(payload, key)
      _ -> nil
    end
  end

  defp field(entry, key), do: map_value(entry, key)

  defp map_value(map, key) when is_map(map),
    do: Map.get(map, key) || Map.get(map, Atom.to_string(key))

  defp map_value(_map, _key), do: nil

  defp to_optional_string(nil), do: nil
  defp to_optional_string(value), do: to_string(value)

  defp blank?(nil), do: true
  defp blank?(""), do: true
  defp blank?(value) when is_binary(value), do: String.trim(value) == ""
  defp blank?(_), do: false
end
