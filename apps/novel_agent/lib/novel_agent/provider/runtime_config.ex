defmodule NovelAgent.Provider.RuntimeConfig do
  @moduledoc """
  Runtime provider selection and in-memory provider configuration.

  Persistent storage is owned by the desktop shell. The backend keeps only the
  active runtime selection and the secrets needed for the current process.
  """

  use Agent

  @type provider_id :: atom()
  @type provider_config :: keyword()

  @spec start_link(keyword()) :: Agent.on_start()
  def start_link(_opts) do
    Agent.start_link(fn -> %{current_provider: nil, provider_configs: %{}} end, name: __MODULE__)
  end

  @spec current_provider() :: provider_id() | nil
  def current_provider do
    case Process.whereis(__MODULE__) do
      pid when is_pid(pid) -> Agent.get(pid, & &1.current_provider)
      _ -> nil
    end
  end

  @spec put_current_provider(provider_id()) :: :ok
  def put_current_provider(provider) when is_atom(provider) do
    update(fn state -> %{state | current_provider: provider} end)
  end

  @spec provider_config(provider_id()) :: provider_config()
  def provider_config(provider) when is_atom(provider) do
    case Process.whereis(__MODULE__) do
      pid when is_pid(pid) ->
        Agent.get(pid, fn state -> Map.get(state.provider_configs, provider, []) end)

      _ ->
        []
    end
  end

  @spec put_provider_config(provider_id(), provider_config()) :: :ok
  def put_provider_config(provider, config) when is_atom(provider) and is_list(config) do
    update(fn state ->
      configs = Map.put(state.provider_configs, provider, config)
      %{state | provider_configs: configs}
    end)
  end

  @spec reset() :: :ok
  def reset do
    update(fn _state -> %{current_provider: nil, provider_configs: %{}} end)
  end

  defp update(fun) do
    case Process.whereis(__MODULE__) do
      pid when is_pid(pid) -> Agent.update(pid, fun)
      _ -> :ok
    end
  end
end
