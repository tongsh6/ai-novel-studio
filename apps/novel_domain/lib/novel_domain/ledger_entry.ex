defmodule NovelDomain.LedgerEntry do
  @moduledoc """
  五本账统一信封（VS-00F §2 / ADR-0026 / schemas foundation/ledger_entry.json）。

  账面是**进度视图**非事实本体：只记进度与状态并经 `source_refs` 引用事实本体
  （正文/章摘要/memory/档案），不双写事实。分账 `status` 是领域状态机（UPPER_SNAKE），
  与采纳七态（承载行的 adoption_status）正交分层。

  CP1 落地弧光账（ledger=arc）。机械规则（I-L4 确定性，模型不参与判定）：
  - `ON_TRACK ⇄ STALLED` 由停滞规则双向机械推导（出场即回 ON_TRACK 属记账事实，
    非漂移裁决——契约 §2.2 的 DRIFTED/RESUMED 仍只能经作者裁决进入，CP2）；
  - `DRIFTED / RESUMED / COMPLETED / RETIRED` 本模块只承认不产生（裁决态，CP2 接入）。
  """

  alias NovelFoundation.ID

  @ledgers ~w(arc conflict information emotion_curve promise)
  @arc_statuses ~w(ON_TRACK STALLED DRIFTED RESUMED COMPLETED RETIRED)
  @arc_mechanical ~w(ON_TRACK STALLED)
  # CP2a（契约 §2.4/§2.6）：信息账/承诺账状态机。LEAKED/BROKEN 为对账判定产出的
  # 异常候选（报告项），权威转移仍走裁决（CP2c）；维护机械可写的只有各自初始态
  # 与 LEAKED 条目的登记（前指是既成事实的记账，非裁决）。
  @information_statuses ~w(HIDDEN PARTIALLY_REVEALED REVEALED LEAKED)
  @promise_statuses ~w(OPEN PROGRESSING FULFILLED BROKEN RELEASED)
  # CP3（契约 §2.3/§2.5）：冲突账 ACTIVE⇄DORMANT 机械双向（同弧光停滞语义）、
  # 其余为裁决/终态；情绪曲线账每章一条全机械（记录性账目，无裁决态）。
  @conflict_statuses ~w(ACTIVE DORMANT REVIVED ABSORBED ABANDONED RESOLVED)
  @conflict_mechanical ~w(ACTIVE DORMANT)
  @emotion_statuses ~w(MATCHED DEVIATED UNPLANNED)
  @subject_kinds ~w(character plotline fact chapter promise)
  @max_source_refs 20

  @type t :: %__MODULE__{
          id: String.t(),
          work_id: String.t(),
          ledger: String.t(),
          subject_kind: String.t(),
          subject_ref: String.t(),
          subject_label: String.t(),
          design_ref: String.t() | nil,
          status: String.t(),
          payload: map(),
          source_refs: [String.t()],
          last_event_chapter: String.t() | nil,
          revision: pos_integer()
        }

  @enforce_keys [:id, :work_id, :ledger, :subject_kind, :subject_ref, :subject_label, :status]
  defstruct [
    :id,
    :work_id,
    :ledger,
    :subject_kind,
    :subject_ref,
    :subject_label,
    :design_ref,
    :status,
    :last_event_chapter,
    payload: %{},
    source_refs: [],
    revision: 1
  ]

  @doc "分账目录（enums/ledger.json SSOT 同值）。"
  @spec ledgers() :: [String.t()]
  def ledgers, do: @ledgers

  @doc "弧光账状态全集（enums/arc_ledger_status.json SSOT 同值）。"
  @spec arc_statuses() :: [String.t()]
  def arc_statuses, do: @arc_statuses

  @doc """
  构造账面条目。I-L1：`source_refs` 必须非空——不凭空记账。
  """
  @spec new(map()) :: {:ok, t()} | {:error, term()}
  def new(attrs) when is_map(attrs) do
    entry = %__MODULE__{
      id: Map.get(attrs, :id) || ID.unique("ledger"),
      work_id: Map.get(attrs, :work_id),
      ledger: Map.get(attrs, :ledger),
      subject_kind: Map.get(attrs, :subject_kind),
      subject_ref: Map.get(attrs, :subject_ref),
      subject_label: Map.get(attrs, :subject_label),
      design_ref: Map.get(attrs, :design_ref),
      status: Map.get(attrs, :status),
      payload: Map.get(attrs, :payload) || %{},
      source_refs: Map.get(attrs, :source_refs) || [],
      last_event_chapter: Map.get(attrs, :last_event_chapter),
      revision: Map.get(attrs, :revision) || 1
    }

    with :ok <- validate_present(entry),
         :ok <- validate_ledger(entry),
         :ok <- validate_status(entry),
         :ok <- validate_source_refs(entry) do
      {:ok, entry}
    end
  end

  @doc """
  弧光账·出场记账（机械）：更新最近出场章与出处，STALLED 时回 ON_TRACK
  （停滞条件因出场解除属记账事实）；裁决态/终态不被机械改写。
  """
  @spec arc_sighted(t(), %{
          chapter_ref: String.t(),
          chapter_seq: non_neg_integer(),
          source_ref: String.t(),
          presence_note: String.t() | nil
        }) :: t()
  def arc_sighted(%__MODULE__{ledger: "arc"} = entry, %{
        chapter_ref: chapter_ref,
        chapter_seq: chapter_seq,
        source_ref: source_ref,
        presence_note: note
      }) do
    payload =
      entry.payload
      |> Map.put("last_seen_chapter", chapter_ref)
      |> Map.put("last_seen_seq", chapter_seq)
      |> then(fn p -> if note in [nil, ""], do: p, else: Map.put(p, "presence_note", note) end)

    status = if entry.status in @arc_mechanical, do: "ON_TRACK", else: entry.status

    %{
      entry
      | payload: payload,
        status: status,
        source_refs: prepend_ref(entry.source_refs, source_ref),
        last_event_chapter: chapter_ref,
        revision: entry.revision + 1
    }
  end

  @doc """
  弧光账·停滞规则（机械、确定性，I-L4）：当前章序号落后最近出场超过阈值 →
  STALLED；条件解除 → ON_TRACK。只在机械态之间翻转；返回 `:unchanged` 或
  `{:changed, entry}`。
  """
  @spec arc_recompute_stall(t(), non_neg_integer(), pos_integer()) :: :unchanged | {:changed, t()}
  def arc_recompute_stall(%__MODULE__{ledger: "arc"} = entry, current_seq, threshold)
      when is_integer(current_seq) and is_integer(threshold) and threshold > 0 do
    last_seen_seq = Map.get(entry.payload, "last_seen_seq")

    if entry.status in @arc_mechanical and is_integer(last_seen_seq) do
      apply_stall_target(entry, stall_target(current_seq - last_seen_seq, threshold))
    else
      :unchanged
    end
  end

  defp stall_target(gap, threshold) when gap > threshold, do: "STALLED"
  defp stall_target(_gap, _threshold), do: "ON_TRACK"

  defp apply_stall_target(%{status: status}, status), do: :unchanged

  defp apply_stall_target(entry, target),
    do: {:changed, %{entry | status: target, revision: entry.revision + 1}}

  # 裁决态转移合法集（CP2c，契约 §2.2/§2.6/§3.3）：只有作者裁决可进入的目标态。
  @adjudication_targets %{
    "arc" => %{"STALLED" => ~w(DRIFTED RESUMED), "DRIFTED" => ~w(RESUMED RETIRED)},
    "promise" => %{"OPEN" => ~w(BROKEN RELEASED), "PROGRESSING" => ~w(BROKEN RELEASED FULFILLED)},
    # HIDDEN→REVEALED：作者裁决「已回收/不再追踪」（VS00F 刀④——回收是语义判断，
    # 机械层不判，模型只提议（盘点回收提案），落账只经作者）。
    "information" => %{"LEAKED" => ~w(REVEALED), "HIDDEN" => ~w(REVEALED)},
    "conflict" => %{
      "ACTIVE" => ~w(RESOLVED ABSORBED ABANDONED),
      "DORMANT" => ~w(REVIVED ABSORBED ABANDONED)
    }
  }

  @doc """
  冲突账·推进记账（机械，CP3）：设计角色为推进/高潮/转折章的采纳即主线推进；
  DORMANT 机械回 ACTIVE（推进解除休眠条件属记账事实）；裁决/终态不被机械改写。
  """
  @spec conflict_advanced(t(), %{
          chapter_ref: String.t(),
          chapter_seq: non_neg_integer(),
          source_ref: String.t()
        }) :: t()
  def conflict_advanced(%__MODULE__{ledger: "conflict"} = entry, %{
        chapter_ref: chapter_ref,
        chapter_seq: chapter_seq,
        source_ref: source_ref
      }) do
    payload =
      entry.payload
      |> Map.put("last_advanced_chapter", chapter_ref)
      |> Map.put("last_advanced_seq", chapter_seq)

    status = if entry.status in @conflict_mechanical, do: "ACTIVE", else: entry.status

    %{
      entry
      | payload: payload,
        status: status,
        source_refs: prepend_ref(entry.source_refs, source_ref),
        last_event_chapter: chapter_ref,
        revision: entry.revision + 1
    }
  end

  @doc "冲突账·休眠规则（机械，同弧光停滞语义）：推进落后当前章超阈值 ⇄。"
  @spec conflict_recompute_dormant(t(), non_neg_integer(), pos_integer()) ::
          :unchanged | {:changed, t()}
  def conflict_recompute_dormant(%__MODULE__{ledger: "conflict"} = entry, current_seq, threshold)
      when is_integer(current_seq) and is_integer(threshold) and threshold > 0 do
    last_seq = Map.get(entry.payload, "last_advanced_seq")

    if entry.status in @conflict_mechanical and is_integer(last_seq) do
      target = if current_seq - last_seq > threshold, do: "DORMANT", else: "ACTIVE"
      apply_stall_target(entry, target)
    else
      :unchanged
    end
  end

  @doc """
  情绪曲线判定（机械，CP3）：设计情绪与实现情绪存在二元词重叠 → MATCHED，
  无重叠 → DEVIATED，设计缺席/实现缺席 → UNPLANNED（M2 实测 54/15/6）。
  """
  @spec emotion_status(String.t() | nil, String.t() | nil) :: String.t()
  def emotion_status(intended, realized) do
    cond do
      intended in [nil, ""] or realized in [nil, ""] -> "UNPLANNED"
      emotion_bigrams(intended) |> MapSet.intersection(emotion_bigrams(realized)) |> MapSet.size() > 0 -> "MATCHED"
      true -> "DEVIATED"
    end
  end

  defp emotion_bigrams(text) do
    chars =
      text |> String.replace(~r/[^一-鿿]/u, "") |> String.graphemes()

    chars
    |> Enum.zip(Enum.drop(chars, 1))
    |> Enum.map(fn {a, b} -> a <> b end)
    |> MapSet.new()
  end

  @doc """
  作者裁决转移（CP2c）：只允许 @adjudication_targets 声明的转移；机械路径不可达
  （I-L2：裁决态只能经作者裁决进入）。附 note 记入 payload["adjudication_note"]。
  """
  @spec adjudicate(t(), String.t(), String.t() | nil) :: {:ok, t()} | {:error, term()}
  def adjudicate(%__MODULE__{} = entry, target, note \\ nil) do
    allowed = @adjudication_targets |> Map.get(entry.ledger, %{}) |> Map.get(entry.status, [])

    if target in allowed do
      payload =
        if note in [nil, ""],
          do: entry.payload,
          else: Map.put(entry.payload, "adjudication_note", note)

      {:ok, %{entry | status: target, payload: payload, revision: entry.revision + 1}}
    else
      {:error, {:invalid_adjudication, entry.ledger, entry.status, target}}
    end
  end

  defp prepend_ref(refs, ref) when is_binary(ref) and ref != "" do
    [ref | Enum.reject(refs, &(&1 == ref))] |> Enum.take(@max_source_refs)
  end

  defp prepend_ref(refs, _ref), do: refs

  defp validate_present(entry) do
    missing =
      [:work_id, :subject_ref, :subject_label]
      |> Enum.filter(fn key ->
        value = Map.get(entry, key)
        not is_binary(value) or value == ""
      end)

    if missing == [], do: :ok, else: {:error, {:missing_fields, missing}}
  end

  defp validate_ledger(%{ledger: ledger, subject_kind: kind}) do
    cond do
      ledger not in @ledgers -> {:error, {:unknown_ledger, ledger}}
      kind not in @subject_kinds -> {:error, {:unknown_subject_kind, kind}}
      true -> :ok
    end
  end

  defp validate_status(%{ledger: "arc", status: status}) do
    if status in @arc_statuses, do: :ok, else: {:error, {:invalid_status, "arc", status}}
  end

  defp validate_status(%{ledger: "information", status: status}) do
    if status in @information_statuses,
      do: :ok,
      else: {:error, {:invalid_status, "information", status}}
  end

  defp validate_status(%{ledger: "promise", status: status}) do
    if status in @promise_statuses,
      do: :ok,
      else: {:error, {:invalid_status, "promise", status}}
  end

  defp validate_status(%{ledger: "conflict", status: status}) do
    if status in @conflict_statuses,
      do: :ok,
      else: {:error, {:invalid_status, "conflict", status}}
  end

  defp validate_status(%{ledger: "emotion_curve", status: status}) do
    if status in @emotion_statuses,
      do: :ok,
      else: {:error, {:invalid_status, "emotion_curve", status}}
  end

  defp validate_source_refs(%{source_refs: refs}) do
    if is_list(refs) and refs != [] and Enum.all?(refs, &(is_binary(&1) and &1 != "")),
      do: :ok,
      else: {:error, :source_refs_required}
  end
end
