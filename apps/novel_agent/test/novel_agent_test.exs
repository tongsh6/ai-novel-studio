defmodule NovelAgentTest do
  use ExUnit.Case, async: false

  alias NovelAgent.Agent.Writer
  alias NovelAgent.Runtime.Agent, as: Agent
  alias NovelAgent.Runtime.AuthorSession, as: Author
  alias NovelAgent.Runtime.WorkspaceSession, as: Workspace

  setup do
    on_exit(fn ->
      for ws <- Workspace.list() do
        NovelAgent.stop_workspace(ws)
      end
    end)

    :ok
  end

  describe "supervision tree 三层启停" do
    test "start_workspace/1 幂等" do
      assert {:ok, pid1} = NovelAgent.start_workspace("ws-a")
      assert is_pid(pid1)
      assert {:ok, ^pid1} = NovelAgent.start_workspace("ws-a")
      assert NovelAgent.workspace_pid("ws-a") == pid1
      assert "ws-a" in Workspace.list()
    end

    test "start_author/2 必须先启 workspace" do
      assert {:ok, _} = NovelAgent.start_workspace("ws-b")
      assert {:ok, pid} = NovelAgent.start_author("ws-b", "author-1")
      assert is_pid(pid)
      assert NovelAgent.author_pid("ws-b", "author-1") == pid
      assert "author-1" in Author.list("ws-b")
    end

    test "spawn_agent/4 起 Writer Agent" do
      assert {:ok, _} = NovelAgent.start_workspace("ws-c")
      assert {:ok, _} = NovelAgent.start_author("ws-c", "author-1")
      assert {:ok, agent_pid} = NovelAgent.spawn_agent("ws-c", "author-1", "writer-1", :writer)
      assert is_pid(agent_pid)
      assert NovelAgent.agent_pid("ws-c", "author-1", "writer-1") == agent_pid
      assert "writer-1" in Agent.list("ws-c", "author-1")
    end

    test "Writer.identity/1 返回实例级身份元数据（不再是硬编码 nil）" do
      assert {:ok, _} = NovelAgent.start_workspace("ws-id")
      assert {:ok, _} = NovelAgent.start_author("ws-id", "author-x")
      assert {:ok, pid} = NovelAgent.spawn_agent("ws-id", "author-x", "writer-id-1", :writer)

      identity = Writer.identity(pid)

      assert identity.agent_id == "writer-id-1"
      assert identity.agent_type == :writer
      assert identity.workspace_id == "ws-id"
      assert identity.author_id == "author-x"
    end
  end

  describe "crash isolation" do
    test "Agent crash 不影响兄弟 Agent（Agent.Children.DynamicSupervisor :one_for_one）" do
      ws = "ws-crash"
      assert {:ok, _} = NovelAgent.start_workspace(ws)
      assert {:ok, _} = NovelAgent.start_author(ws, "a1")
      assert {:ok, p1} = NovelAgent.spawn_agent(ws, "a1", "ag-1", :writer)
      assert {:ok, p2} = NovelAgent.spawn_agent(ws, "a1", "ag-2", :writer)

      ref2 = Process.monitor(p2)
      Process.exit(p1, :kill)
      Process.sleep(50)

      refute_receive {:DOWN, ^ref2, :process, ^p2, _}, 200
      assert Process.alive?(p2)
    end

    test "一个 workspace 崩了不影响别的 workspace（Workspace.DynamicSupervisor :one_for_one）" do
      assert {:ok, _} = NovelAgent.start_workspace("ws-1")
      assert {:ok, p2} = NovelAgent.start_workspace("ws-2")

      ws1_pid = NovelAgent.workspace_pid("ws-1")
      Process.exit(ws1_pid, :kill)

      # 等 supervisor 处理 :EXIT 完成。:one_for_one 下兄弟 (ws-2) 不受影响。
      Process.sleep(100)

      assert Process.alive?(p2)
      assert NovelAgent.workspace_pid("ws-2") == p2
    end
  end
end
