defmodule NovelApplication.B81Cp2SessionDerivationTest do
  @moduledoc """
  B81 CP2 机制验收：第 N 轮判断请求由会话 canonical 历史派生。

  真实链路（存储 → 历史视图 → 请求 IR）：
  1) 第一轮 run 以真实 canonical 形状持久化到会话存储（作者原话 + tool_call +
     observation + validation）；
  2) 第二轮 run 读取会话历史并经 `AuthoringSessionHistory` 组装；
  3) `JudgmentProtocol.request_for_production/1` 产出实际请求 IR。

  判据（B81 §7 CP2）：第二轮请求含第一轮作者原话字节；历史 observation 与其
  来源 refs 进入请求与 IR refs；当前 run 的 base 唯一且最前；段视图（持久化边界）
  不含历史消息。
  """

  use ExUnit.Case, async: false

  alias Ecto.Adapters.SQL.Sandbox
  alias NovelApplication.AuthoringCheckpoint
  alias NovelApplication.AuthoringSessionHistory
  alias NovelApplication.AuthoringTranscript
  alias NovelApplication.JudgmentProtocol
  alias NovelCommon.RequestIR
  alias NovelPersistence.{AuthoringSessionLog, Repo}

  @first_author_text "第一轮作者原话：请核对全章是否有重复"
  @second_author_text "第二轮作者原话：继续按刚才的问题处理"

  setup do
    :ok = Sandbox.checkout(Repo)
    :ok
  end

  defp identity(run_id, overrides \\ %{}) do
    Map.merge(
      %{
        run_id: run_id,
        workspace_id: "ws-cp2",
        work_id: "work-cp2",
        session_id: "sess-cp2",
        parent_turn_ref: "turn-#{run_id}"
      },
      overrides
    )
  end

  defp run_record(run_id) do
    identity = identity(run_id)

    %{
      id: identity.run_id,
      workspace_id: identity.workspace_id,
      work_id: identity.work_id,
      session_id: identity.session_id,
      parent_turn_ref: identity.parent_turn_ref
    }
  end

  defp first_round_transcript do
    AuthoringTranscript.new(identity("run-cp2-1"),
      base_text: "CP2 历史 Base",
      author_text: @first_author_text,
      base_refs: [%{ref: "ctx:base-1"}]
    )
    |> AuthoringTranscript.append_assistant("先核对全章。", [
      RequestIR.tool_call_block("chapter_read", %{"chapter" => "第01章"}, "call-read")
    ])
    |> AuthoringTranscript.append_observation("call-read", %{
      status: :ok,
      source_refs: [%{ref: "chapter:01"}],
      content: %{"text" => "第01章正文（真实观察）"}
    })
  end

  defp seed_first_round! do
    transcript = first_round_transcript()
    record = run_record("run-cp2-1")

    {:ok, segment} = AuthoringCheckpoint.encode_segment_for_write(record, transcript)

    {:ok, _} =
      Repo.transaction(fn -> AuthoringSessionLog.append_run(record, segment) end)

    transcript
  end

  defp protocol_input(session_history) do
    %{
      author_text: @second_author_text,
      context_block: "章计划/当前 scope",
      source_input_ref: "author-turn-2",
      supplied_context_refs: ["ctx:base-2"],
      options: [],
      session_history: session_history
    }
  end

  test "第二轮请求含第一轮作者原话与历史观察，base 唯一且最前，段视图不含历史" do
    seed_first_round!()

    assert {:ok, history} =
             AuthoringSessionHistory.fetch(%{run_id: "run-cp2-2", session_id: "sess-cp2"})

    assert is_map(history)

    input = protocol_input(history)

    # 段视图（持久化边界）不含历史消息：run2 只保存自己的应用事实。
    assert {:ok, segment} = JudgmentProtocol.transcript_for_production(input)
    refute Enum.any?(segment.messages, &(message_text(&1) == @first_author_text))
    assert hd(segment.messages).role == "application_base"

    # 请求 IR：base 唯一且最前 → 第一轮历史原序 → 当前作者最后。
    request = JudgmentProtocol.request_for_production(input)
    roles = Enum.map(request.messages, & &1.role)
    assert Enum.count(roles, &(&1 == "application_base")) == 1
    assert hd(request.messages).role == "application_base"

    texts = Enum.map(request.messages, &message_text/1)
    assert @first_author_text in texts
    assert Enum.any?(texts, &String.contains?(&1, "第01章正文（真实观察）"))
    assert List.last(request.messages).role == "user"
    assert message_text(List.last(request.messages)) == @second_author_text

    # 历史观察来源 refs 进入 IR refs（I-ART-9 与审计回查依据）。
    assert Enum.any?(request.refs.observation_refs, &(&1.ref == "chapter:01"))
    assert Enum.any?(request.refs.base_refs, &(&1.ref == "ctx:base-2"))
  end

  test "无历史时请求派生与 CP1 行为一致（仅当前 base/scope/作者）" do
    input = protocol_input(nil)
    request = JudgmentProtocol.request_for_production(input)
    texts = Enum.map(request.messages, &message_text/1)

    refute @first_author_text in texts
    assert @second_author_text in texts
    assert hd(request.messages).role == "application_base"
  end

  defp message_text(%{blocks: blocks}) do
    Enum.map_join(blocks, "", fn block ->
      Map.get(block, :text) || get_in(block, [:content, "text"]) ||
        get_in(block, [:content, :text]) || ""
    end)
  end

  defp message_text(message), do: inspect(message)

  describe "协议层合并视图（纯输入，无 DB）" do
    test "base 唯一且最前、历史原序、当前作者最后、refs 会话累计" do
      history = %{
        messages: [
          %{role: "user", provenance: "author", blocks: [%{type: "text", text: "上一轮作者原话"}]},
          %{role: "assistant", provenance: "model", blocks: [%{type: "text", text: "上一轮助手回复"}]}
        ],
        refs: %{
          base_refs: [%{"ref" => "chapter:one"}],
          observation_refs: [%{"ref" => "chapter:two"}],
          used_refs: []
        }
      }

      request = JudgmentProtocol.request_for_production(protocol_input(history))
      roles = Enum.map(request.messages, & &1.role)

      assert Enum.count(roles, &(&1 == "application_base")) == 1
      assert hd(request.messages).role == "application_base"
      assert request.messages |> Enum.at(1) |> message_text() == "上一轮作者原话"
      assert request.messages |> Enum.at(2) |> message_text() == "上一轮助手回复"
      assert List.last(request.messages).role == "user"
      assert Enum.any?(request.refs.base_refs, &(&1.ref == "chapter:one"))
      assert Enum.any?(request.refs.observation_refs, &(&1.ref == "chapter:two"))
    end

    test "transcript_for_production 仍是本 run 段视图（持久化边界不含历史）" do
      history = %{
        messages: [
          %{role: "user", provenance: "author", blocks: [%{type: "text", text: "历史作者原话"}]}
        ],
        refs: %{base_refs: [], observation_refs: [], used_refs: []}
      }

      {:ok, segment} = JudgmentProtocol.transcript_for_production(protocol_input(history))

      refute Enum.any?(segment.messages, &(message_text(&1) == "历史作者原话"))
      assert hd(segment.messages).role == "application_base"
    end
  end
end
