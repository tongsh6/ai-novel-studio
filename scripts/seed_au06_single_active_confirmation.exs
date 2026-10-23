# AU06 单一活跃 confirmation 种子：两章各有已采纳正文 + 两条待采纳「覆盖重写」候选。
#
# 事实布置：
#   - 一个作品、一卷、两章（第 1 / 第 2 章），两章都已有已采纳正文；
#   - 会话里恢复两条**待采纳候选**（不同 turn）：两条候选都带 `authoring_intent: "rewrite"`
#     + `target_chapter_ref`，分别指向第 1 / 第 2 章；两条的目标章都已有已采纳正文，
#     因此采纳时都会在 AdoptionWorkflow 打开覆盖确认 behavior。
#
# 验收语义（外部 Playwright 驱动真实页面）：
#   作者采纳第一条 → 覆盖确认 B1 打开；不确认，继续采纳第二条 → 覆盖确认 B2 打开，
#   且 B2 的 behavior_state.history 显式 supersede B1（resolution_ref 指向 B2）；
#   旧确认不可执行；确认 B2 → 只采纳一次（覆盖第 2 章），B1 未被静默采纳。
#   产品代码不感知任何 slice id / 验收开关。

alias NovelApplication.{WorkService, WorkSessionService}
alias NovelFoundation.Enums.{AdoptionStatus, StructureStatus}
alias NovelPersistence.MemoryLog
alias NovelPersistence.Repo
alias NovelPersistence.Schemas.{Chapter, Draft, Scene, Volume}

{:ok, work} =
  WorkService.create(%{
    "title" => "AU06 单一活跃确认作品",
    "genre" => "东方奇幻",
    "core_selling_point" => "同一时刻只允许一个待作者确认的覆盖写入",
    "target_reader" => "喜欢稳健长篇推进的读者",
    "tone_preference" => "克制、悬疑"
  })

{:ok, snapshot} = WorkSessionService.resume(work.id)
session_id = snapshot.active_session.id

volume =
  %Volume{}
  |> Volume.changeset(%{
    work_id: work.id,
    title: "第一卷：双线账单",
    seq: 1,
    status: StructureStatus.planned()
  })
  |> Repo.insert!()

first_chapter =
  %Chapter{}
  |> Chapter.changeset(%{
    work_id: work.id,
    volume_id: volume.id,
    title: "第01章：底层灵气账单",
    seq: 1,
    status: StructureStatus.planned(),
    summary: "第一章已有已采纳正文，第二条候选采纳会触发覆盖确认。"
  })
  |> Repo.insert!()

second_chapter =
  %Chapter{}
  |> Chapter.changeset(%{
    work_id: work.id,
    volume_id: volume.id,
    title: "第02章：旧服务器里的残诀",
    seq: 2,
    status: StructureStatus.planned(),
    summary: "第二章已有已采纳正文，最新一条候选采纳会触发覆盖确认并 supersede 旧确认。"
  })
  |> Repo.insert!()

defmodule Au06SeedHelpers do
  alias NovelFoundation.Enums.AdoptionStatus
  alias NovelPersistence.Repo
  alias NovelPersistence.Schemas.{Draft, Scene}

  def accepted_prose!(work_id, chapter_id, body_text) do
    scene =
      %Scene{}
      |> Scene.changeset(%{
        work_id: work_id,
        chapter_id: chapter_id,
        title: "场景 1",
        seq: 1
      })
      |> Repo.insert!()

    %Draft{}
    |> Draft.changeset(%{
      work_id: work_id,
      scene_id: scene.id,
      content: body_text,
      status: AdoptionStatus.accepted(),
      revision: 1
    })
    |> Repo.insert!()

    scene
  end
end

first_legacy_body = "旧账页上仍有上一夜的灰，他把指尖在纸边蹭净才敢继续翻。"
second_legacy_body = "旧服务器风扇低鸣，残诀停在最后一行，像是有人刻意留白。"

Au06SeedHelpers.accepted_prose!(work.id, first_chapter.id, first_legacy_body)
Au06SeedHelpers.accepted_prose!(work.id, second_chapter.id, second_legacy_body)

first_turn_id = "turn_au06_rewrite_first"
second_turn_id = "turn_au06_rewrite_second"
first_artifact_id = "as_au06_rewrite_first"
second_artifact_id = "as_au06_rewrite_second"

first_rewrite_body = "他把账单翻到背面，用红笔把第三行整段划掉，重新写上新的数目。"
second_rewrite_body = "残诀最后一页被撕开，夹层里露出一行从未见过的旧服务器地址。"

defmodule Au06SeedTurn do
  def rewrite_candidate!(
        work_id,
        session_id,
        turn_id,
        artifact_id,
        chapter_title,
        chapter_ref,
        body_text,
        rationale
      ) do
    accept_action = %{
      action_id: "accept:#{artifact_id}",
      action_type: "accept",
      label_key: "artifact.accept",
      source_turn_ref: turn_id,
      target_ref: artifact_id,
      enabled: true,
      idempotency_key: "idem:#{turn_id}:accept:#{artifact_id}",
      trace_ref: "tr_#{artifact_id}"
    }

    discard_action = %{
      action_id: "discard:#{artifact_id}",
      action_type: "discard",
      label_key: "artifact.discard",
      source_turn_ref: turn_id,
      target_ref: artifact_id,
      enabled: true,
      idempotency_key: "idem:#{turn_id}:discard:#{artifact_id}",
      trace_ref: "tr_#{artifact_id}"
    }

    %{
      schema_version: "3.0-draft",
      turn_id: turn_id,
      work_id: work_id,
      session_id: session_id,
      frame_ref: "frame_#{turn_id}",
      phase: "completed",
      status: "conversational",
      assistant_message: %{
        text: "已恢复一条覆盖重写候选：采纳后会覆盖该章已有正文，因此需要作者确认。"
      },
      frame_summary: %{
        frame_type: "creative_exploration",
        dialogue_goal: "覆盖重写候选验收"
      },
      ui_cards: [
        %{
          card_type: "candidate_set",
          priority: "high",
          visibility: "always",
          title: "#{chapter_title}正文草稿",
          body: body_text,
          artifact_refs: [artifact_id],
          candidate_set_ref: artifact_id,
          artifact_type: "prose_fragment",
          items: [%{item_id: "item_#{artifact_id}", title: chapter_title, body: body_text}],
          tentative: true
        }
      ],
      adoption_state: %{
        pending: [
          %{
            artifact_id: artifact_id,
            artifact_type: "prose_fragment",
            adoption_status: "TENTATIVE",
            requires_adoption: true,
            source_tool_result_ref: "tr_#{artifact_id}",
            authoring_intent: "rewrite",
            target_chapter: chapter_title,
            target_chapter_ref: chapter_ref,
            payload: %{
              title: chapter_title,
              item_count: 1,
              items: [
                %{
                  item_id: "item_#{artifact_id}",
                  title: chapter_title,
                  body: body_text,
                  rationale: rationale
                }
              ]
            }
          }
        ],
        resolved: []
      },
      available_actions: [accept_action, discard_action],
      truthfulness: %{
        tool_called: false,
        artifact_adopted: false,
        production_write_performed: false,
        durable_behavior_opened: false
      },
      trace_summary: %{
        trace_ref: "trace_#{turn_id}",
        decision_type: "exploration",
        reason_codes: ["au06_rewrite_candidate_seeded"]
      },
      produced_at: DateTime.utc_now() |> DateTime.to_iso8601()
    }
  end
end

first_turn_result =
  Au06SeedTurn.rewrite_candidate!(
    work.id,
    session_id,
    first_turn_id,
    first_artifact_id,
    first_chapter.title,
    "chapter:#{first_chapter.id}",
    first_rewrite_body,
    "显式覆盖重写第一章；采纳时必须打开覆盖确认。"
  )

second_turn_result =
  Au06SeedTurn.rewrite_candidate!(
    work.id,
    session_id,
    second_turn_id,
    second_artifact_id,
    second_chapter.title,
    "chapter:#{second_chapter.id}",
    second_rewrite_body,
    "显式覆盖重写第二章；采纳时必须打开覆盖确认并 supersede 旧确认。"
  )

Enum.each([first_turn_result, second_turn_result], fn turn_result ->
  {:ok, _interaction} =
    MemoryLog.record(%{
      workspace_id: work.id,
      session_id: session_id,
      turn_id: turn_result.turn_id,
      role: "assistant",
      content: %{text: turn_result.assistant_message.text, turn_result: turn_result},
      source_ref: turn_result.turn_id,
      scope_ref: work.id,
      freshness_score: 0.6,
      importance_score: 0.6,
      replayable: true,
      retrievable: true
    })
end)

IO.puts(
  "[au06-single-active-confirmation-seed] work_id=#{work.id} session_id=#{session_id} " <>
    "first_chapter=#{first_chapter.id} second_chapter=#{second_chapter.id} " <>
    "first_artifact_id=#{first_artifact_id} second_artifact_id=#{second_artifact_id}"
)
