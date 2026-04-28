defmodule NovelAgent.Agent do
  @moduledoc """
  Agent behaviour — 所有 Agent 类型的统一接口。

  Phase 1：最小接口（identity + handle_task）。

  ## ADR refs
  - tech-stack/08-multi-agent §3.1 — agent_ref struct，6 个 agent_type
  - 12-multi-agent-composition.md — Agent 类型枚举与协作契约
  """

  alias NovelFoundation.Enums.AgentType

  @type agent_type :: AgentType.t()

  @type identity :: %{
          agent_id: String.t(),
          agent_type: agent_type(),
          workspace_id: String.t(),
          author_id: String.t()
        }

  @type task :: %{
          task_id: String.t(),
          intent: atom(),
          payload: map()
        }

  @type task_result :: {:ok, map()} | {:error, term()}

  @doc "返回该 Agent 实例的身份元数据。注意：identity 是 instance-level，必须传 server。"
  @callback identity(GenServer.server()) :: identity()

  @doc "处理一个任务请求，返回结果。"
  @callback handle_task(task(), GenServer.server()) :: task_result()
end
