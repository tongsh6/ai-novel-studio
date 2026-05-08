defmodule NovelDomain.CapabilityRegistryEntry do
  @moduledoc """
  工具注册表中的一条能力记录。Orchestrator 和 ToolTrace 据此审查工具调用。

  规格见 docs/design-v3/contracts/VS-02-tool-provenance-contract-pack.md §2。
  """

  @type tool_layer :: :cognitive | :memory | :policy | :creative | :artifact | :debug
  @type risk_class :: :low | :medium | :high | :critical
  @type tool_status :: :active | :experimental | :disabled | :deprecated
  @type trace_level :: :minimal | :standard
  @type provider_dep :: :none | :llm_provider | :external_system

  @type t :: %__MODULE__{
    tool_name: String.t(),
    tool_version: String.t(),
    tool_layer: tool_layer(),
    input_contract_ref: String.t(),
    output_contract_ref: String.t(),
    read_scopes: [String.t()],
    write_scopes: [String.t()],
    risk_class: risk_class(),
    status: tool_status(),
    trace_level: trace_level(),
    provider_dependency: provider_dep(),
    supports_retry: boolean(),
    supports_cancellation: boolean(),
    budget_profile_ref: String.t() | nil
  }

  @enforce_keys [:tool_name, :tool_version, :tool_layer, :risk_class, :status]
  defstruct [
    :tool_name,
    :tool_version,
    :tool_layer,
    :risk_class,
    :status,
    input_contract_ref: "unknown",
    output_contract_ref: "unknown",
    read_scopes: [],
    write_scopes: [],
    trace_level: :standard,
    provider_dependency: :none,
    supports_retry: false,
    supports_cancellation: false,
    budget_profile_ref: nil
  ]

  @doc "Whether this tool can be dispatched for new calls."
  @spec dispatchable?(t()) :: boolean()
  def dispatchable?(%__MODULE__{status: :active}), do: true
  def dispatchable?(%__MODULE__{status: :experimental}), do: true
  def dispatchable?(%__MODULE__{status: _}), do: false
end
