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

  # 其余账的状态机随对应 CP 冻结（VS-00F §7）；未冻结前不接受构造。
  defp validate_status(%{ledger: ledger}), do: {:error, {:ledger_not_implemented, ledger}}

  defp validate_source_refs(%{source_refs: refs}) do
    if is_list(refs) and refs != [] and Enum.all?(refs, &(is_binary(&1) and &1 != "")),
      do: :ok,
      else: {:error, :source_refs_required}
  end
end
