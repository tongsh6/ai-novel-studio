defmodule NovelAgent.Application do
  @moduledoc """
  Agent 层 OTP application。v3 VS-00 阶段只保留遥测。
  监督树在后续 slice（VS-02 Toolbox）中重建。
  """

  use Application

  require Logger

  @impl true
  def start(_type, _args) do
    NovelAgent.Telemetry.attach_all()

    children = [
      NovelAgent.Provider.RuntimeConfig
    ]

    opts = [strategy: :one_for_one, name: NovelAgent.Supervisor]

    with {:ok, pid} <- Supervisor.start_link(children, opts) do
      Logger.info("[NovelAgent] v3 application started (minimal)")
      {:ok, pid}
    end
  end
end
