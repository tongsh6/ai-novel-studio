defmodule NovelAgent.Orchestrator do
  @moduledoc """
  Turn orchestration entry for the Agent Runtime layer.

  This module owns the generic turn entry semantics: turn id allocation and
  routing. Domain/application code may decide what a routed intent means, but
  it should not call Router directly.
  """

  alias NovelAgent.Router

  @type turn :: %{
          turn_id: String.t(),
          input: String.t(),
          route_result: Router.Result.t()
        }

  @doc """
  Starts a turn and returns the generic runtime routing result.

  The Orchestrator remains domain-agnostic: no persistence, no novel object
  writes, and no domain-specific artifact construction happen here.
  """
  @spec start_turn(String.t(), keyword()) :: turn()
  def start_turn(user_text, opts \\ []) when is_binary(user_text) do
    turn_id = Keyword.get_lazy(opts, :turn_id, &allocate_turn_id/0)

    %{
      turn_id: turn_id,
      input: user_text,
      route_result: Router.route(user_text)
    }
  end

  @doc "Allocates a canonical turn id owned by the runtime entry layer."
  @spec allocate_turn_id() :: String.t()
  def allocate_turn_id do
    "turn_#{System.unique_integer([:positive, :monotonic])}"
  end
end
