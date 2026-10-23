defmodule NovelDomain.GateResult do
  @moduledoc """
  Execution Gate Result — ADR-0005「Gate outcome 语义」的结构化载体。

  每个 gate 必须产出可被 trace / replay / 验收引用的结果：gate identity、
  稳定顺序、outcome、机器可读 reason code、作者可见资格与输入引用。
  GateResult 只服务审计与解释，不参与业务裁决——裁决由 `GateOrder` 聚合后交给
  `ExecutionOrchestrator` 形成 `OrchestratorDecision`。

  outcome 集合冻结（ADR-0005 §Gate outcome 语义）：

  - `:pass` 通过；
  - `:pass_with_note` 通过但留下风险/降级/trace note；
  - `:soft_block` 不能执行，但可经 clarification / confirmation / dialogue 继续；
  - `:hard_block` 权限、策略、schema 或不可恢复约束阻断；
  - `:replay_existing` 幂等命中，复用已有 decision / TurnResult；
  - `:recoverable_failure` 系统、工具、预算、trace 或状态冲突可恢复。
  """

  @type outcome ::
          :pass
          | :pass_with_note
          | :soft_block
          | :hard_block
          | :replay_existing
          | :recoverable_failure

  @type t :: %__MODULE__{
          gate: atom(),
          order: non_neg_integer(),
          outcome: outcome(),
          reason_code: String.t() | nil,
          reason: String.t() | nil,
          input_refs: map(),
          author_visible: boolean(),
          notes: [String.t()]
        }

  @outcomes [
    :pass,
    :pass_with_note,
    :soft_block,
    :hard_block,
    :replay_existing,
    :recoverable_failure
  ]

  @enforce_keys [:gate, :order, :outcome]
  defstruct gate: nil,
            order: 0,
            outcome: :pass,
            reason_code: nil,
            reason: nil,
            input_refs: %{},
            author_visible: false,
            notes: []

  @doc "Build a passing gate result."
  @spec pass(atom(), non_neg_integer(), keyword()) :: t()
  def pass(gate, order, opts \\ []) do
    build(gate, order, :pass, opts)
  end

  @doc "Build a passing gate result carrying a trace note."
  @spec pass_with_note(atom(), non_neg_integer(), String.t(), keyword()) :: t()
  def pass_with_note(gate, order, note, opts \\ []) when is_binary(note) do
    opts
    |> Keyword.update(:notes, [note], &[note | List.wrap(&1)])
    |> then(&build(gate, order, :pass_with_note, &1))
  end

  @doc "Build a blocking gate result."
  @spec block(atom(), non_neg_integer(), outcome(), String.t(), String.t(), keyword()) :: t()
  def block(gate, order, outcome, reason_code, reason, opts \\ [])
      when outcome in [:soft_block, :hard_block, :recoverable_failure] and is_binary(reason_code) do
    build(gate, order, outcome, Keyword.merge(opts, reason_code: reason_code, reason: reason))
  end

  @doc "Build a replay-existing gate result (idempotent lineage hit)."
  @spec replay_existing(atom(), non_neg_integer(), String.t(), keyword()) :: t()
  def replay_existing(gate, order, decision_ref, opts \\ []) when is_binary(decision_ref) do
    build(
      gate,
      order,
      :replay_existing,
      Keyword.merge(opts, reason_code: "replay_existing_decision", reason: decision_ref)
    )
  end

  @doc "Whether this gate result stops the gate chain."
  @spec blocking?(t()) :: boolean()
  def blocking?(%__MODULE__{outcome: outcome}),
    do: outcome in [:soft_block, :hard_block, :recoverable_failure]

  @doc "Whether this gate result is a terminal (non-continuing) outcome."
  @spec terminal?(t()) :: boolean()
  def terminal?(%__MODULE__{} = result), do: blocking?(result) or replay?(result)

  @doc "Whether this gate result is an idempotent replay hit."
  @spec replay?(t()) :: boolean()
  def replay?(%__MODULE__{outcome: :replay_existing}), do: true
  def replay?(%__MODULE__{}), do: false

  @doc """
  JSON-safe projection for DecisionTrace / TurnResult trace summaries / logs.

  只保留 author-safe 的裁决事实；raw reasoning、provider response、输入原文都
  不进入 GateResult（ADR-0005「禁止语义」）。
  """
  @spec to_map(t()) :: map()
  def to_map(%__MODULE__{} = result) do
    %{
      gate: Atom.to_string(result.gate),
      order: result.order,
      outcome: Atom.to_string(result.outcome),
      reason_code: result.reason_code,
      reason: result.reason,
      input_refs: jsonable_refs(result.input_refs),
      author_visible: result.author_visible,
      notes: result.notes
    }
    |> Enum.reject(fn {_key, value} -> is_nil(value) end)
    |> Map.new()
  end

  @doc """
  Compact lineage for developer logs / step events / real-page acceptance。

  保留 gate identity/order/outcome/reason_code 与 pass_with_note 的 notes（逐门
  「为什么加注」可解释，例如 budget 的真实剩余量、trace 通道是否接线）；raw
  reasoning / provider response 仍不进入。
  """
  @spec lineage([t()]) :: [map()]
  def lineage(results) when is_list(results) do
    Enum.map(results, fn %__MODULE__{} = result ->
      %{
        gate: Atom.to_string(result.gate),
        order: result.order,
        outcome: Atom.to_string(result.outcome),
        reason_code: result.reason_code,
        notes: if(result.notes == [], do: nil, else: result.notes),
        author_visible: if(result.author_visible, do: true, else: nil)
      }
      |> Enum.reject(fn {_key, value} -> is_nil(value) end)
      |> Map.new()
    end)
  end

  @doc "Gate list outcome map `%{gate => outcome}` (audit friendly)."
  @spec outcome_map([t()]) :: %{atom() => outcome()}
  def outcome_map(results) when is_list(results) do
    Map.new(results, fn %__MODULE__{} = result -> {result.gate, result.outcome} end)
  end

  @doc "All outcomes returned by this module (frozen enum)."
  @spec outcomes() :: [outcome()]
  def outcomes, do: @outcomes

  defp build(gate, order, outcome, opts) when outcome in @outcomes do
    %__MODULE__{
      gate: gate,
      order: order,
      outcome: outcome,
      reason_code: Keyword.get(opts, :reason_code),
      reason: Keyword.get(opts, :reason),
      input_refs: Map.new(Keyword.get(opts, :input_refs, %{})),
      author_visible: Keyword.get(opts, :author_visible, false),
      notes: List.wrap(Keyword.get(opts, :notes, []))
    }
  end

  # input_refs 只承载可回放的引用（字符串/数字/atom/bool），嵌套 map/list 递归收敛；
  # nil 值在 to_map/1 剔除，避免 trace 里出现空洞引用。
  defp jsonable_refs(refs) when is_map(refs) do
    Map.new(refs, fn {key, value} -> {ref_key(key), jsonable_refs(value)} end)
  end

  defp jsonable_refs(refs) when is_list(refs), do: Enum.map(refs, &jsonable_refs/1)
  defp jsonable_refs(ref) when is_binary(ref) or is_number(ref) or is_boolean(ref), do: ref
  defp jsonable_refs(ref) when is_atom(ref) and not is_nil(ref), do: Atom.to_string(ref)
  defp jsonable_refs(nil), do: nil

  defp ref_key(key) when is_atom(key), do: Atom.to_string(key)
  defp ref_key(key), do: to_string(key)
end
