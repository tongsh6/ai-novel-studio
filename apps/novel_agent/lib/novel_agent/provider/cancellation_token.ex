defmodule NovelAgent.Provider.CancellationToken do
  @moduledoc """
  ProviderExecution cancellation token.

  The token is owned by the provider execution runtime and observed by adapters.
  It is not a separate provider path: adapters use it to stop reading stream
  data and materialize cancelled ProviderRun / ProviderEvent / ProviderOutput
  facts in the same execution stream.
  """

  use Agent

  @type reason :: atom() | String.t()
  @type t :: pid()

  @spec start_link(map()) :: Agent.on_start()
  def start_link(metadata \\ %{}) when is_map(metadata) do
    Agent.start_link(fn ->
      %{
        cancelled?: false,
        reason: nil,
        requested_at: nil,
        metadata: metadata
      }
    end)
  end

  @spec cancel(t() | nil, reason()) :: :ok
  def cancel(token, reason \\ :author_cancelled)

  def cancel(nil, _reason), do: :ok

  def cancel(token, reason) when is_pid(token) do
    if Process.alive?(token) do
      Agent.update(token, fn
        %{cancelled?: true} = state ->
          state

        state ->
          %{
            state
            | cancelled?: true,
              reason: reason,
              requested_at: DateTime.utc_now()
          }
      end)
    else
      :ok
    end
  catch
    :exit, _reason -> :ok
  end

  @spec cancelled?(t() | nil) :: boolean()
  def cancelled?(nil), do: false

  def cancelled?(token) when is_pid(token) do
    Process.alive?(token) and Agent.get(token, & &1.cancelled?)
  catch
    :exit, _reason -> false
  end

  @spec snapshot(t() | nil) :: map()
  def snapshot(nil), do: %{}

  def snapshot(token) when is_pid(token) do
    if Process.alive?(token), do: Agent.get(token, & &1), else: %{}
  catch
    :exit, _reason -> %{}
  end

  @spec reason(t() | nil) :: reason() | nil
  def reason(token) do
    token
    |> snapshot()
    |> Map.get(:reason)
  end
end
