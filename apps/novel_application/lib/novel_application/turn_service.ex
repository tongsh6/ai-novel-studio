defmodule NovelApplication.TurnService do
  @moduledoc """
  Turn 用例编排：Router → Executor → TurnResult 组装。

  Phase 0 Week 4：只支持 CREATE_WORK_SEED 一条链路。

  ## ADR refs
  - ADR-0001 — TurnResult v2 schema (14 必填字段 + 枚举字段引用)
  - ADR-0002 §3 / §6 / §8 — turn phase / next_action / behavior_status 枚举
  - ADR-0010 §6 — clarification 触发规则

  TurnResult 由 NovelFoundation.TurnResultValidator 在出口处强校验；任何未引用
  Foundation.Enums 的枚举字面量都会被运行时拦截。
  """

  alias NovelAgent.Memory.Store, as: MemoryStore
  alias NovelAgent.Router
  alias NovelApplication.AdoptionBoundary
  alias NovelDomain.Work

  alias NovelFoundation.Enums.AdoptionStatus
  alias NovelFoundation.Enums.BehaviorStatus
  alias NovelFoundation.Enums.MemoryClass
  alias NovelFoundation.Enums.NextAction
  alias NovelFoundation.Enums.RetentionTier
  alias NovelFoundation.Enums.SourceType
  alias NovelFoundation.Enums.Status
  alias NovelFoundation.Enums.TurnPhase
  alias NovelFoundation.ID
  alias NovelFoundation.TurnResultValidator

  alias NovelPersistence.MemoryLog

  @schema_version "2.0.0"

  @doc """
  处理用户文本输入，返回 TurnResult map。
  workspace_id 用于 memory 记录的分区。
  """
  @spec handle_message(String.t(), String.t(), String.t()) :: map()
  def handle_message(user_text, workspace_id \\ "lobby", turn_id \\ nil) do
    turn_id = turn_id || "turn_#{:os.system_time(:millisecond)}"

    turn_result =
      case Router.route(user_text) do
        %{intent_name: :unknown} ->
          build_unknown_clarification(turn_id)

        %{needs_clarification: true} = result ->
          build_create_work_clarification(turn_id, result)

        %{needs_clarification: false} = result ->
          build_create_work_tentative(turn_id, result)
      end

    record_to_memory(workspace_id, turn_id, :user, user_text)
    record_to_memory(workspace_id, turn_id, :assistant, turn_result.assistant_message.text)

    TurnResultValidator.validate!(turn_result)
  end

  @doc """
  采纳一个 tentative artifact。成功时返回合法 TurnResult（phase=COMPLETED,
  next_action=NO_FURTHER_ACTION，artifact 进入 adoption_state.resolved）。
  """
  @spec handle_adopt(map(), String.t(), String.t() | nil) ::
          {:ok, map()} | {:error, term()}
  def handle_adopt(payload, workspace_id \\ "lobby", turn_id \\ nil) do
    turn_id = turn_id || "turn_#{:os.system_time(:millisecond)}"

    case AdoptionBoundary.accept(payload) do
      {:ok, work} ->
        artifact = %{
          artifact_id: work.id,
          artifact_type: "work",
          adoption_status: AdoptionStatus.accepted(),
          requires_adoption: false,
          payload: %{title: work.title, genre: work.genre, status: work.status}
        }

        text = "已采纳「#{work.title}」。"

        turn_result =
          build_turn_result(turn_id, %{
            phase: TurnPhase.completed(),
            status: Status.done(),
            next_action: NextAction.no_further_action(),
            assistant_text: text,
            resolved_artifacts: [artifact]
          })

        record_to_memory(workspace_id, turn_id, :assistant, text)

        {:ok, TurnResultValidator.validate!(turn_result)}

      {:error, reason} ->
        {:error, reason}
    end
  end

  # ---- Memory ----

  defp record_to_memory(workspace_id, turn_id, role, text) do
    entry = %{
      workspace_id: workspace_id,
      turn_id: turn_id,
      role: Atom.to_string(role),
      content: %{text: text},
      memory_class: MemoryClass.episodic(),
      retention_tier: RetentionTier.hot(),
      source_type: SourceType.turn(),
      source_ref: turn_id,
      scope_ref: workspace_id,
      freshness_score: 1.0,
      importance_score: 0.5,
      replayable: true,
      retrievable: true
    }

    MemoryStore.record(entry)
    MemoryLog.record(entry)
  end

  # ---- Unknown intent ----

  defp build_unknown_clarification(turn_id) do
    build_turn_result(turn_id, %{
      phase: TurnPhase.needs_clarification(),
      status: Status.waiting_user(),
      next_action: NextAction.ask_user(),
      assistant_text: "抱歉，我不太理解你的意图。请重新描述一下？",
      behavior: %{
        behavior_type: "clarification",
        behavior_id: "behavior_#{turn_id}",
        status: BehaviorStatus.waiting_user(),
        resolution_ref: nil
      }
    })
  end

  # ---- CREATE_WORK_SEED ----

  defp build_create_work_clarification(turn_id, route_result) do
    missing = route_result.missing_required_slots
    genre = route_result.extracted_slots["genre"] || "未指定"

    build_turn_result(turn_id, %{
      phase: TurnPhase.needs_clarification(),
      status: Status.waiting_user(),
      next_action: NextAction.ask_user(),
      assistant_text:
        "好的，你想创建一部#{genre}小说。在开始之前，我还需要了解：\n" <>
          (missing |> Enum.map_join("\n", &slot_label/1)),
      behavior: %{
        behavior_type: "clarification",
        behavior_id: "behavior_#{turn_id}",
        status: BehaviorStatus.waiting_user(),
        resolution_ref: nil,
        missing_slots: missing
      }
    })
  end

  defp build_create_work_tentative(turn_id, route_result) do
    slots = route_result.extracted_slots
    work = Work.new(ID.uuid(), "#{slots["genre"]}小说")
    artifact_id = ID.uuid()

    artifact = %{
      artifact_id: artifact_id,
      artifact_type: "work",
      adoption_status: AdoptionStatus.tentative(),
      requires_adoption: true,
      payload: %{
        title: work.title,
        genre: slots["genre"],
        core_selling_point: slots["core_selling_point"],
        target_reader: slots["target_reader"]
      }
    }

    build_turn_result(turn_id, %{
      phase: TurnPhase.completed(),
      status: Status.done(),
      next_action: NextAction.adopt_artifacts(),
      assistant_text:
        "已为你生成作品种子：「#{slots["genre"]}小说」\n核心卖点：#{slots["core_selling_point"]}\n目标读者：#{slots["target_reader"]}",
      pending_artifacts: [artifact],
      ui_cards: [adoption_card(slots, artifact_id)]
    })
  end

  defp adoption_card(slots, artifact_id) do
    %{
      card_type: "adoption_card",
      priority: "high",
      visibility: "primary",
      title: "确认创建作品",
      body: "即将创建「#{slots["genre"]}小说」",
      artifact_refs: [artifact_id],
      actions: [
        %{
          action_id: "accept",
          label: "确认创建",
          target_ref: artifact_id,
          enabled: true,
          style_hint: "primary"
        },
        %{
          action_id: "discard",
          label: "放弃",
          target_ref: artifact_id,
          enabled: true,
          style_hint: "secondary"
        }
      ]
    }
  end

  # ---- TurnResult envelope (ADR-0001 §1) ----

  defp build_turn_result(turn_id, fields) do
    %{
      schema_version: @schema_version,
      turn_id: turn_id,
      phase: fields.phase,
      status: fields.status,
      next_action: fields.next_action,
      assistant_message: %{text: fields.assistant_text},
      ui_cards: Map.get(fields, :ui_cards, []),
      behavior_state: build_behavior_state(fields),
      adoption_state: build_adoption_state(fields),
      projection_refs: [],
      validation: %{},
      usage: %{},
      trace_ref: %{},
      produced_at: DateTime.utc_now() |> DateTime.to_iso8601()
    }
  end

  defp build_adoption_state(fields) do
    %{
      pending: Map.get(fields, :pending_artifacts, []),
      resolved: Map.get(fields, :resolved_artifacts, [])
    }
  end

  defp build_behavior_state(fields) do
    %{
      active: Map.get(fields, :behavior),
      history: []
    }
  end

  defp slot_label("core_selling_point"), do: "- 这部小说的核心卖点是什么？"
  defp slot_label("target_reader"), do: "- 目标读者群体是？"
  defp slot_label("tone_preference"), do: "- 偏好什么语调风格？"
  defp slot_label("reference_works"), do: "- 有没有希望参考的作品？"
  defp slot_label(slot), do: "- #{slot}"
end
