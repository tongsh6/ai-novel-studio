# AUTO-GENERATED FROM docs/design-v2/schemas/foundation/enums/agent_type.json — DO NOT EDIT.
# Run `mix codegen.enums` to regenerate; CI runs `mix codegen.enums --check`.
defmodule NovelFoundation.Enums.AgentType do
  @moduledoc """
  AgentType — generated from `docs/design-v2/schemas/foundation/enums/agent_type.json`.

  tech-stack/08 §3.1 agent_ref struct

  Agent 类型分类，atom 派系（snake_case）。来源 tech-stack/08-multi-agent §3.1。
  """

  @values [:orchestrator, :writer, :reviewer, :planner, :long_runner, :maintainer]

  @type t :: atom()

  @doc "All canonical values, in declaration order."
  @spec values() :: [t()]
  def values, do: @values

  @doc "Returns true if `v` is a canonical value."
  @spec valid?(any()) :: boolean()
  def valid?(v) when is_atom(v), do: v in @values
  def valid?(_), do: false

  def orchestrator, do: :orchestrator
  def writer, do: :writer
  def reviewer, do: :reviewer
  def planner, do: :planner
  def long_runner, do: :long_runner
  def maintainer, do: :maintainer
end
