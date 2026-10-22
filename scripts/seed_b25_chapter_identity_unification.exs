# B25 CP4 场景种子：章节身份统一（同名两章 + 指向第二章 ref 的续写候选）
#
# 事实布置：
#   - 一个作品、一卷、两章**完全同名**（"灰烬中的手印"，seq=1 / seq=2）——同名是创作事实，
#     两章必须并存、不得合并；
#   - 第二章已有已采纳旧正文（续写基线），第一章为空（待补足）；
#   - 会话里恢复一条**续写待采纳候选**，其 `target_chapter_ref = chapter:<第二章 id>`，
#     title 与两章都相同——只有 ref 能唯一指定目标章。
#
# 验收语义（外部 Playwright 驱动真实页面）：
#   作者从真实工作台采纳该候选 → 采纳边界必须按 ref 写入第二章（第一章逐字节不受影响），
#   续写以 append 落为第二章新场景；阅读模式里两章同名并存（一章待补足、一章旧+新正文），
#   目录/字数/投影只反映第二章；产品代码不感知任何 slice id / 验收开关。

alias NovelApplication.{WorkService, WorkSessionService}
alias NovelFoundation.Enums.{AdoptionStatus, StructureStatus}
alias NovelPersistence.MemoryLog
alias NovelPersistence.Repo
alias NovelPersistence.Schemas.{Chapter, Draft, Scene, Volume}

{:ok, work} =
  WorkService.create(%{
    "title" => "B25 章节身份统一验收作品",
    "genre" => "东方奇幻",
    "core_selling_point" => "同名章节必须靠身份而非标题区分",
    "target_reader" => "喜欢悬疑与手记体叙事的读者",
    "tone_preference" => "冷峻、克制"
  })

{:ok, snapshot} = WorkSessionService.resume(work.id)
session_id = snapshot.active_session.id

volume =
  %Volume{}
  |> Volume.changeset(%{
    work_id: work.id,
    title: "第一卷：同名的雾",
    seq: 1,
    status: StructureStatus.planned()
  })
  |> Repo.insert!()

first_chapter =
  %Chapter{}
  |> Chapter.changeset(%{
    work_id: work.id,
    volume_id: volume.id,
    title: "灰烬中的手印",
    seq: 1,
    status: StructureStatus.planned(),
    summary: "第一章只留下手印，不写正文。"
  })
  |> Repo.insert!()

second_chapter =
  %Chapter{}
  |> Chapter.changeset(%{
    work_id: work.id,
    volume_id: volume.id,
    title: "灰烬中的手印",
    seq: 2,
    status: StructureStatus.planned(),
    summary: "第二章已有旧正文，续写必须落在这一章。"
  })
  |> Repo.insert!()

# 第二章已采纳旧正文（续写基线）：阅读模式必须显示它，且第一章保持空章。
legacy_body = "旧账页上仍有上一夜的灰，他把指尖在纸边蹭净才敢继续翻。"

legacy_scene =
  %Scene{}
  |> Scene.changeset(%{
    work_id: work.id,
    chapter_id: second_chapter.id,
    title: "场景 1",
    seq: 1
  })
  |> Repo.insert!()

%Draft{}
|> Draft.changeset(%{
  work_id: work.id,
  scene_id: legacy_scene.id,
  content: legacy_body,
  status: AdoptionStatus.accepted(),
  revision: 1
})
|> Repo.insert!()

turn_id = "turn_b25_chapter_identity_seed"
artifact_id = "as_b25_same_title_continuation"
continuation_body = "他把新查到的一行账目补在页脚，指尖停在墨迹未干处。"

turn_result = %{
  schema_version: "3.0-draft",
  turn_id: turn_id,
  work_id: work.id,
  session_id: session_id,
  frame_ref: "frame_b25_chapter_identity_seed",
  phase: "completed",
  status: "conversational",
  assistant_message: %{
    text: "已恢复一条续写候选：它指向同名两章中的第二章，采纳后只应改动第二章。"
  },
  frame_summary: %{
    frame_type: "creative_exploration",
    dialogue_goal: "同名章节身份验收"
  },
  # 作者可见候选卡：真实 TurnResultBuilder 会同时给 pending 条目 + candidate_set 卡；
  # 种子补同形卡，保证恢复后作者能先读到候选正文再决定采纳。
  ui_cards: [
    %{
      card_type: "candidate_set",
      priority: "high",
      visibility: "always",
      title: "灰烬中的手印正文草稿",
      body: continuation_body,
      artifact_refs: [artifact_id],
      candidate_set_ref: artifact_id,
      artifact_type: "prose_fragment",
      items: [
        %{
          item_id: "item_b25_continuation",
          title: "灰烬中的手印",
          body: continuation_body,
          rationale: "续写同名第二章；只有 chapter_ref 能唯一指定目标章。"
        }
      ],
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
        source_tool_result_ref: "tr_b25_chapter_identity_seed",
        authoring_intent: "continuation",
        target_chapter: "灰烬中的手印",
        target_chapter_ref: "chapter:#{second_chapter.id}",
        payload: %{
          title: "灰烬中的手印",
          item_count: 1,
          items: [
            %{
              item_id: "item_b25_continuation",
              title: "灰烬中的手印",
              body: continuation_body,
              rationale: "续写同名第二章；只有 chapter_ref 能唯一指定目标章。"
            }
          ]
        }
      }
    ],
    resolved: []
  },
  available_actions: [
    %{
      action_id: "accept:#{artifact_id}",
      action_type: "accept",
      label_key: "artifact.accept",
      source_turn_ref: turn_id,
      target_ref: artifact_id,
      enabled: true,
      idempotency_key: "idem:#{turn_id}:accept:#{artifact_id}",
      trace_ref: "tr_b25_chapter_identity_seed"
    },
    %{
      action_id: "discard:#{artifact_id}",
      action_type: "discard",
      label_key: "artifact.discard",
      source_turn_ref: turn_id,
      target_ref: artifact_id,
      enabled: true,
      idempotency_key: "idem:#{turn_id}:discard:#{artifact_id}",
      trace_ref: "tr_b25_chapter_identity_seed"
    }
  ],
  truthfulness: %{
    tool_called: false,
    artifact_adopted: false,
    production_write_performed: false,
    durable_behavior_opened: false
  },
  trace_summary: %{
    trace_ref: "trace_b25_chapter_identity_seed",
    decision_type: "exploration",
    reason_codes: ["b25_same_title_chapter_ref_target"]
  },
  produced_at: DateTime.utc_now() |> DateTime.to_iso8601()
}

{:ok, _interaction} =
  MemoryLog.record(%{
    workspace_id: work.id,
    session_id: session_id,
    turn_id: turn_id,
    role: "assistant",
    content: %{text: turn_result.assistant_message.text, turn_result: turn_result},
    source_ref: turn_id,
    scope_ref: work.id,
    freshness_score: 0.6,
    importance_score: 0.6,
    replayable: true,
    retrievable: true
  })

IO.puts(
  "[b25-chapter-identity-seed] work_id=#{work.id} session_id=#{session_id} " <>
    "first_chapter=#{first_chapter.id} second_chapter=#{second_chapter.id} " <>
    "artifact_id=#{artifact_id} turn_id=#{turn_id}"
)
