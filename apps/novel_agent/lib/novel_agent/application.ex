defmodule NovelAgent.Application do
  @moduledoc """
  Agent 层 OTP application。

  当前阶段（Phase 0 Week 2）supervision tree：

  ```
  NovelAgent.Supervisor (one_for_one)
  ├── Registry × 5                          # NovelAgent.Runtime.Registries.child_specs/0
  └── NovelAgent.Runtime.WorkspaceSession.DynamicSupervisor   # 顶层多 workspace 根
      └── (per workspace) Workspace.Supervisor (rest_for_one)
          └── Author.DynamicSupervisor
              └── (per author) Author.Supervisor (rest_for_one)
                  └── Agent.Children.DynamicSupervisor (one_for_one, crash isolation)
                      └── (per agent) Agent.Dummy (Phase 1 替换为真 Agent)
  ```

  权威定义：`docs/design-v2/tech-stack/08-multi-agent.md` §2 / §2.1。
  Agent 层其他子树（Authority.Gate / Budget.Meter / Provider.Gateway / Capability.Registry /
  Memory.Service / Observability.Pipeline 等）按 `03-backend.md` §3 留待 Week 3+ 落地。
  """

  use Application

  require Logger

  alias NovelAgent.Runtime.Registries
  alias NovelAgent.Runtime.WorkspaceSession, as: Workspace

  @impl true
  def start(_type, _args) do
    ensure_log_dir()
    NovelAgent.Telemetry.attach_all()

    children =
      Registries.child_specs() ++
        [
          NovelAgent.AuthorityGate,
          NovelAgent.ClarificationStore,
          NovelAgent.BudgetMeter,
          NovelAgent.Memory.Store,
          NovelAgent.LongRunner,
          Workspace.DynamicSupervisor
        ]

    opts = [strategy: :one_for_one, name: NovelAgent.Supervisor]

    with {:ok, pid} <- Supervisor.start_link(children, opts) do
      Logger.info("[NovelAgent] 应用已启动")
      {:ok, pid}
    end
  end

  defp ensure_log_dir do
    File.mkdir_p!("log")
  end
end
