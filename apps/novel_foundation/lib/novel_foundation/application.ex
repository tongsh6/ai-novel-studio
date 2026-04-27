defmodule NovelFoundation.Application do
  @moduledoc """
  Foundation 层 OTP application。

  当前阶段（Phase 0 Week 2）supervision tree：

  ```
  NovelFoundation.Supervisor (one_for_one)
  ├── Registry × 5                          # NovelFoundation.Registries.child_specs/0
  └── NovelFoundation.Workspace.DynamicSupervisor   # 顶层多 workspace 根
      └── (per workspace) Workspace.Supervisor (rest_for_one)
          └── Author.DynamicSupervisor
              └── (per author) Author.Supervisor (rest_for_one)
                  └── Agent.Children.DynamicSupervisor (one_for_one, crash isolation)
                      └── (per agent) Agent.Dummy (Phase 1 替换为真 Agent)
  ```

  权威定义：`docs/design-v2/tech-stack/08-multi-agent.md` §2 / §2.1。
  Foundation 层其他子树（Authority.Gate / Budget.Meter / Provider.Gateway / Capability.Registry /
  Memory.Service / Observability.Pipeline 等）按 `03-backend.md` §3 留待 Week 3+ 落地。
  """

  use Application

  require Logger

  alias NovelFoundation.Registries
  alias NovelFoundation.Workspace

  @impl true
  def start(_type, _args) do
    children =
      Registries.child_specs() ++
        [
          Workspace.DynamicSupervisor
        ]

    opts = [strategy: :one_for_one, name: NovelFoundation.Supervisor]

    with {:ok, pid} <- Supervisor.start_link(children, opts) do
      Logger.info("[NovelFoundation] Application started")
      {:ok, pid}
    end
  end
end
