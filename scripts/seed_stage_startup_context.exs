alias NovelApplication.{WorkService, WorkSessionService}
alias NovelPersistence.MemoryLog

{:ok, work} =
  WorkService.create(%{
    "title" => "Slice Verify Work"
  })

{:ok, snapshot} = WorkSessionService.resume(work.id)
session_id = snapshot.active_session.id
turn_id = "turn_stage_startup_seed"

turn_result = %{
  schema_version: "3.0-draft",
  turn_id: turn_id,
  phase: "completed",
  status: "conversational",
  next_action: "continue",
  assistant_message: %{text: "已恢复一个待采纳草案。"},
  produced_at: DateTime.utc_now() |> DateTime.to_iso8601(),
  adoption_state: %{
    pending: [
      %{
        artifact_id: "as_stage_startup_seed",
        artifact_type: "character_seed",
        adoption_status: "tentative",
        requires_adoption: true,
        source_tool_result_ref: "tr_stage_startup_seed",
        payload: %{
          title: "启动验证角色草案",
          items: [
            %{
              item_id: "item_stage_startup_seed",
              title: "林澈",
              body: "一个为了保护同伴而重新审视旧秩序的角色。",
              rationale: "用于验证恢复后的待采纳卡片可见"
            }
          ]
        }
      },
      %{
        artifact_id: "as_stage_startup_resolved",
        artifact_type: "character_seed",
        adoption_status: "tentative",
        requires_adoption: true,
        source_tool_result_ref: "tr_stage_startup_resolved",
        payload: %{
          title: "已处理角色草案",
          items: [
            %{
              item_id: "item_stage_startup_resolved",
              title: "顾岚",
              body: "一个已经被采纳进设定集的旧候选。",
              rationale: "用于验证 resolved artifact 不再计入 pending"
            }
          ]
        }
      }
    ],
    resolved: [
      %{
        artifact_id: "as_stage_startup_resolved",
        artifact_type: "character_seed",
        adoption_status: "ACCEPTED",
        requires_adoption: false,
        source_tool_result_ref: "tr_stage_startup_resolved",
        payload: %{
          title: "已处理角色草案",
          items: [
            %{
              item_id: "item_stage_startup_resolved",
              title: "顾岚",
              body: "一个已经被采纳进设定集的旧候选。",
              rationale: "用于验证 resolved artifact 不再计入 pending"
            }
          ]
        }
      }
    ]
  },
  trace_summary: %{
    trace_ref: "trace_stage_startup_seed",
    decision_type: "tool_dispatched",
    tool_name: "creative_generation",
    tool_status: "succeeded"
  },
  ui_cards: [
    %{
      card_type: "adoption_card",
      title: "待确认的新设定",
      body: "AI 生成了新的创作设定，请审核是否采纳。",
      priority: "high",
      actions: [
        %{
          action_id: "a_accept_stage_startup_seed",
          action_type: "accept",
          label: "采纳",
          target_ref: "as_stage_startup_seed",
          enabled: true
        }
      ]
    },
    %{
      card_type: "adoption_card",
      title: "待确认的新设定",
      body: "这条旧候选已经被处理。",
      priority: "normal",
      actions: [
        %{
          action_id: "a_accept_stage_startup_resolved",
          action_type: "accept",
          label: "采纳",
          target_ref: "as_stage_startup_resolved",
          enabled: true
        },
        %{
          action_id: "a_discard_stage_startup_resolved",
          action_type: "discard",
          label: "废弃",
          target_ref: "as_stage_startup_resolved",
          enabled: true
        }
      ]
    }
  ]
}

entries = [
  %{
    workspace_id: work.id,
    session_id: session_id,
    turn_id: turn_id,
    role: "user",
    content: %{text: "帮我准备一个启动恢复验证草案"},
    source_ref: turn_id,
    scope_ref: work.id,
    freshness_score: 1.0,
    importance_score: 0.5,
    replayable: true,
    retrievable: true
  },
  %{
    workspace_id: work.id,
    session_id: session_id,
    turn_id: turn_id,
    role: "assistant",
    content: %{text: "已恢复一个待采纳草案。", turn_result: turn_result},
    source_ref: turn_id,
    scope_ref: work.id,
    freshness_score: 1.0,
    importance_score: 0.5,
    replayable: true,
    retrievable: true
  }
]

Enum.each(entries, fn entry ->
  {:ok, _interaction} = MemoryLog.record(entry)
end)

IO.puts("[stage-startup-context-seed] work_id=#{work.id} session_id=#{session_id} turn_id=#{turn_id}")
