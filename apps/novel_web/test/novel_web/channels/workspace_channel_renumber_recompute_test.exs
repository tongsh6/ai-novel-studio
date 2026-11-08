defmodule NovelWeb.WorkspaceChannelRenumberRecomputeTest do
  @moduledoc """
  2026-11-08 B71 复审 P1-3：B80 CP2 把「章节重编号采纳后的机械账面重算」从退役的
  旧 adopt 入口迁移到唯一采纳入口 `author_action`，但迁移后全仓测试 0 引用
  `recompute_ledgers_after_structure_change/1` / `maybe_recompute_ledgers_after_renumber`，
  rescue 分支只记业务日志、无回归保护。本文件锁定真实触发链：

  - `renumber_chapters` 采纳成功 → 重算被调用并记录 `ledger.recompute_after_renumber`
    可观测完成日志（rescue/降级分支记录同事件 error 相，不静默吞掉）；
  - 非重编号采纳不得触发重算（条件绑定，不是无条件兜底）；
  - application 重算入口按已采纳章摘要返回真实机械账结果（非空手）。
  """

  use ExUnit.Case, async: false

  import ExUnit.CaptureLog
  import Phoenix.ChannelTest

  alias Ecto.Adapters.SQL.Sandbox
  alias NovelFoundation.Enums.AdoptionStatus
  alias NovelPersistence.Repo
  alias NovelPersistence.Schemas.{Chapter, ChapterSummary, Draft, Scene, Volume, Work}
  alias NovelWeb.{UserSocket, WorkspaceChannel}

  @endpoint NovelWeb.Endpoint

  setup do
    owner = Sandbox.start_owner!(Repo, shared: true)

    # 真实重编号采纳只在 persistence 注入开启时走持久化 renumber 分支（否则退化为
    # 内存采纳、不会产生 adoption_effect，也就不会触发账面重算）。本文件全部用例
    # 使用隔离 Sandbox 库，显式开启注入。
    previous_persistence = Application.get_env(:novel_web, :persistence)

    Application.put_env(
      :novel_web,
      :persistence,
      Keyword.put(previous_persistence || [], :inject_real_persistence, true)
    )

    # LogEmit 的 done/error 事件经 Logger.info 输出；测试环境全局 level=warning，
    # 这里只对 LogEmit 模块放开 info，避免影响其它并行测试的日志级。
    Logger.put_module_level(NovelTelemetry.LogEmit, :info)

    on_exit(fn ->
      Logger.delete_module_level(NovelTelemetry.LogEmit)

      if previous_persistence do
        Application.put_env(:novel_web, :persistence, previous_persistence)
      else
        Application.delete_env(:novel_web, :persistence)
      end

      NovelApplication.TestAgentRunCleanup.await_quiescent()
      Sandbox.stop_owner(owner)
    end)

    :ok
  end

  test "重编号采纳成功后触发机械账面重算并记录可观测完成日志" do
    {work, chapters} = seed_work!()
    [c1, _c2, c3] = chapters
    artifact_id = "as-renumber-#{System.unique_integer([:positive])}"
    turn = renumber_turn(work, chapters, artifact_id)
    socket = join_socket(work, turn)

    log =
      capture_log(fn ->
        assert {:reply, {:ok, %{received: true, action_status: "accepted"}}, _socket} =
                 WorkspaceChannel.handle_in(
                   "author_action",
                   accept_action(artifact_id, turn.turn_id),
                   socket
                 )
      end)

    assert_broadcast("action_result", %{adoption_effect: %{mode: "renumber_chapters"}})

    # 重算通过唯一采纳入口真实触发；done 相日志是既有可观测出口。
    assert log =~ "ledger.recompute_after_renumber"
    assert log =~ "完成"

    # 采纳结果本身仍然成立：章节显示号按提交映射互换。
    assert Repo.get!(Chapter, c1.id).seq == 13
    assert Repo.get!(Chapter, c3.id).seq == 11
  end

  test "非重编号采纳不触发账面重算（条件绑定而非无条件兜底）" do
    {work, [c1 | _]} = seed_work!()
    artifact_id = "as-character-#{System.unique_integer([:positive])}"
    turn = character_turn(work, artifact_id)
    socket = join_socket(work, turn)

    log =
      capture_log(fn ->
        assert {:reply, {:ok, %{received: true, action_status: "accepted"}}, _socket} =
                 WorkspaceChannel.handle_in(
                   "author_action",
                   accept_action(artifact_id, turn.turn_id),
                   socket
                 )
      end)

    refute log =~ "ledger.recompute_after_renumber"
    assert Repo.get!(Chapter, c1.id).seq == 11
  end

  test "application 重算入口按已采纳章摘要返回真实机械账结果" do
    {work, _chapters} = seed_work!()

    assert {:ok, counts} = NovelApplication.recompute_ledgers_after_structure_change(work.id)
    assert counts.current_seq == 13
    assert counts.arc == 0
    assert counts.conflict == 0
    assert counts.stalled == 0
  end

  defp seed_work! do
    work = Repo.insert!(%Work{title: "重编号账面重算"})
    volume = Repo.insert!(%Volume{work_id: work.id, title: "第一卷", seq: 1})

    chapters =
      for {title, seq} <- [{"第11章：甲", 11}, {"第12章：乙", 12}, {"第13章：丙", 13}] do
        chapter =
          Repo.insert!(%Chapter{
            work_id: work.id,
            volume_id: volume.id,
            title: title,
            seq: seq
          })

        scene =
          Repo.insert!(%Scene{
            work_id: work.id,
            chapter_id: chapter.id,
            title: "场景 1",
            seq: 1
          })

        Repo.insert!(%Draft{
          work_id: work.id,
          scene_id: scene.id,
          content: "正文-#{seq}",
          status: AdoptionStatus.accepted(),
          revision: 1
        })

        # 机械账面重算的数据源是「已采纳章摘要」；没有摘要时重算按契约诚实跳过。
        Repo.insert!(%ChapterSummary{
          work_id: work.id,
          chapter_id: chapter.id,
          status: AdoptionStatus.accepted(),
          summary_text: "第#{seq}章摘要"
        })

        chapter
      end

    {work, chapters}
  end

  defp renumber_turn(work, [c1, _c2, c3], artifact_id) do
    payload = %{
      object_kind: "chapter_structure_change_plan",
      change_plan: %{
        operation: "renumber_chapters",
        object_count: 2,
        effects: ["display_number_only"],
        mapping: [
          %{chapter_ref: "chapter:#{c1.id}", from_seq: 11, to_seq: 13},
          %{chapter_ref: "chapter:#{c3.id}", from_seq: 13, to_seq: 11}
        ],
        base_versions: [
          %{chapter_ref: "chapter:#{c1.id}", version: 1},
          %{chapter_ref: "chapter:#{c3.id}", version: 1}
        ],
        warnings: []
      }
    }

    pending_turn(work, artifact_id, :outline_draft, payload)
  end

  defp character_turn(work, artifact_id) do
    pending_turn(work, artifact_id, :character_seed, %{
      title: "角色设定",
      content: "主角更果断"
    })
  end

  defp pending_turn(work, artifact_id, artifact_type, payload) do
    %{
      turn_id: "turn-renumber-#{System.unique_integer([:positive])}",
      frame_ref: "frame-renumber",
      work_id: work.id,
      available_actions: [
        %{
          action_id: "accept:#{artifact_id}",
          action_type: "accept",
          target_ref: artifact_id,
          enabled: true,
          idempotency_key: "ik-renumber"
        }
      ],
      adoption_state: %{
        pending: [
          %{
            artifact_id: artifact_id,
            artifact_type: artifact_type,
            adoption_status: "TENTATIVE",
            requires_adoption: true,
            source_tool_result_ref: "tr-renumber",
            payload: payload
          }
        ],
        resolved: []
      }
    }
  end

  defp join_socket(work, turn) do
    {:ok, _reply, socket} =
      UserSocket
      |> socket("user_id", %{})
      |> subscribe_and_join(WorkspaceChannel, "workspace:lobby")

    # 不注入 session_id：AdoptionWorkflow 的持久 pending 校验只在 work+session
    # 均为可信 binary 时要求真实 Interaction；本测试聚焦 Channel 后置重算触发链，
    # 来源 turn 由内存 turn_results_by_id 提供（与既有 channel 合同测试同边界）。
    # 来源 turn 由内存 turn_results_by_id 提供（与既有 channel 合同测试同边界）；
    # session_id 置 nil，避免 AdoptionWorkflow 的持久 pending 校验把内存来源
    # 误判为「已不可用」——本测试聚焦 Channel 后置重算触发链，不测持久来源恢复。
    socket
    |> Phoenix.Socket.assign(:workspace_id, "lobby")
    |> Phoenix.Socket.assign(:work_id, work.id)
    |> Phoenix.Socket.assign(:session_id, nil)
    |> Phoenix.Socket.assign(:current_turn_id, turn.turn_id)
    |> Phoenix.Socket.assign(:turn_results_by_id, %{turn.turn_id => turn})
  end

  defp accept_action(artifact_id, turn_id) do
    %{
      "action" => %{
        "action_id" => "accept:#{artifact_id}",
        "action_type" => "accept",
        "target_ref" => artifact_id,
        "source_turn_ref" => turn_id,
        # available action 登记了幂等键，客户端必须携带同一键（scope mismatch 会拒绝）。
        "idempotency_key" => "ik-renumber"
      }
    }
  end
end
