defmodule NovelAgent.Agent do
  @moduledoc """
  Agent behaviour — 所有 Agent 类型的统一接口。

  Phase 1：最小接口（identity + handle_task）。
  """

  @type agent_type :: :writer | :reviewer | :planner | :orchestrator

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

  @doc "返回 Agent 身份元数据。"
  @callback identity() :: identity()

  @doc "处理一个任务请求，返回结果。"
  @callback handle_task(task(), GenServer.server()) :: task_result()
end
