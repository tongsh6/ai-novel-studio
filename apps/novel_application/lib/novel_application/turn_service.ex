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

  alias NovelAgent.AuthorityGate
  alias NovelAgent.Memory.Store, as: MemoryStore
  alias NovelAgent.Orchestrator
  alias NovelAgent.Provider.Gateway, as: ProviderGateway
  alias NovelApplication.AdoptionBoundary
  alias NovelApplication.MemoryRecallService
  alias NovelDomain.Work

  alias NovelFoundation.Enums.AdoptionStatus
  alias NovelFoundation.Enums.BehaviorStatus
  alias NovelFoundation.Enums.MemoryClass
  alias NovelFoundation.Enums.NextAction
  alias NovelFoundation.Enums.ProjectionRefreshStatus
  alias NovelFoundation.Enums.RetentionTier
  alias NovelFoundation.Enums.SourceType
  alias NovelFoundation.Enums.Status
  alias NovelFoundation.Enums.TurnPhase
  alias NovelFoundation.ID
  alias NovelFoundation.TurnResultValidator

  alias NovelPersistence.MemoryLog
  alias NovelPersistence.Repo
  alias NovelPersistence.Schemas.Chapter
  alias NovelPersistence.Schemas.Scene
  alias NovelPersistence.Schemas.Volume

  import Ecto.Query, only: [from: 2]

  @schema_version "2.0.0"

  @doc """
  处理用户文本输入，返回 TurnResult map。
  workspace_id 用于 memory 记录的分区。
  work_id 可选，用于记忆召回（Governed Memory）。
  """
  @spec handle_message(String.t(), String.t(), String.t(), String.t() | nil) :: map()
  def handle_message(user_text, workspace_id \\ "lobby", turn_id \\ nil, work_id \\ nil) do
    turn = Orchestrator.start_turn(user_text, maybe_turn_id(turn_id))
    turn_id = turn.turn_id

    # 记忆召回：将治理层记忆注入上下文
    memory_context = build_memory_context(work_id, user_text, turn_id)

    turn_result =
      case turn.route_result do
        %{intent_name: :unknown} ->
          build_unknown_clarification(turn_id, memory_context)

        %{needs_clarification: true} = result ->
          build_clarification(turn_id, result, memory_context)

        %{needs_clarification: false} = result ->
          # VS-003: check if intent requires confirmation before execution
          intent_context = %{
            intent_name: result.intent_name,
            extracted_slots: result.extracted_slots,
            requires_confirmation: Map.get(result, :requires_confirmation, false),
            risk_class: Map.get(result, :risk_class, "low")
          }

          case AuthorityGate.authorize(result.intent_name, intent_context) do
            {:confirm_required, reason} ->
              build_confirmation(turn_id, result, reason, memory_context)

            :allowed ->
              build_tentative_for(turn_id, result, memory_context)
          end
      end

    record_to_memory(workspace_id, turn_id, :user, user_text)
    record_to_memory(workspace_id, turn_id, :assistant, turn_result.assistant_message.text)

    TurnResultValidator.validate!(turn_result)
  end

  @doc """
  采纳一个 tentative artifact。根据 artifact_type 分派到 Work 或 Draft 采纳。
  """
  @spec handle_adopt(String.t(), pos_integer(), map(), String.t(), String.t() | nil, String.t() | nil) ::
          {:ok, map()} | {:error, term()}
  def handle_adopt(artifact_id, base_revision, mutation_attrs, workspace_id \\ "lobby", turn_id \\ nil, artifact_type \\ nil)

  def handle_adopt(artifact_id, base_revision, mutation_attrs, workspace_id, turn_id, "draft_text") do
    handle_adopt_draft(artifact_id, base_revision, mutation_attrs, workspace_id, turn_id)
  end

  def handle_adopt(work_id, base_revision, mutation_attrs, workspace_id, turn_id, _artifact_type)
      when is_integer(base_revision) and base_revision > 0 do
    turn_id = turn_id || Orchestrator.allocate_turn_id()

    attrs = Map.merge(mutation_attrs, %{source_turn_ref: turn_id})

    case AdoptionBoundary.accept(work_id, base_revision, attrs) do
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
            resolved_artifacts: [artifact],
            projection_refs: build_projection_refs(work)
          })

        record_to_memory(workspace_id, turn_id, :assistant, text)

        {:ok, TurnResultValidator.validate!(turn_result)}

      {:error, reason} ->
        {:error, reason}
    end
  end

  def handle_adopt(_work_id, _base_revision, _mutation_attrs, _workspace_id, _turn_id, _artifact_type) do
    {:error, :invalid_base_revision}
  end

  # ---- Draft adoption ----

  @spec handle_adopt_draft(String.t(), pos_integer(), map(), String.t(), String.t() | nil) ::
          {:ok, map()} | {:error, term()}
  defp handle_adopt_draft(draft_id, base_revision, mutation_attrs, workspace_id, turn_id)
       when is_integer(base_revision) and base_revision > 0 do
    turn_id = turn_id || Orchestrator.allocate_turn_id()
    attrs = Map.merge(mutation_attrs, %{source_turn_ref: turn_id})

    case AdoptionBoundary.accept_draft(draft_id, base_revision, attrs) do
      {:ok, draft} ->
        artifact = %{
          artifact_id: draft.id,
          artifact_type: "draft_text",
          adoption_status: AdoptionStatus.accepted(),
          requires_adoption: false,
          payload: %{content: draft.content}
        }

        text = "已采纳草稿。"

        turn_result =
          build_turn_result(turn_id, %{
            phase: TurnPhase.completed(),
            status: Status.done(),
            next_action: NextAction.no_further_action(),
            assistant_text: text,
            resolved_artifacts: [artifact],
            projection_refs: build_draft_projection_refs(draft)
          })

        record_to_memory(workspace_id, turn_id, :assistant, text)
        {:ok, TurnResultValidator.validate!(turn_result)}

      {:error, reason} ->
        {:error, reason}
    end
  end

  @doc """
  丢弃一个 tentative artifact。

  将 work 状态设为 DISCARDED，返回 TurnResult。
  """
  @spec handle_discard(String.t(), String.t()) :: {:ok, map()} | {:error, term()}
  def handle_discard(work_id, workspace_id \\ "lobby") do
    turn_id = Orchestrator.allocate_turn_id()

    mutation_attrs = %{
      actor_ref: "user",
      source_turn_ref: turn_id,
      target_scope: "work",
      target_object_ref: work_id
    }

    case AdoptionBoundary.discard(work_id, mutation_attrs) do
      {:ok, work} ->
        artifact = %{
          artifact_id: work.id,
          artifact_type: "work",
          adoption_status: AdoptionStatus.discarded(),
          requires_adoption: false,
          payload: %{title: work.title, genre: work.genre, status: work.status}
        }

        text = "已丢弃「#{work.title}」。"

        turn_result =
          build_turn_result(turn_id, %{
            phase: TurnPhase.completed(),
            status: Status.done(),
            next_action: NextAction.no_further_action(),
            assistant_text: text,
            resolved_artifacts: [artifact],
            projection_refs: build_projection_refs(work)
          })

        record_to_memory(workspace_id, turn_id, :assistant, text)

        {:ok, TurnResultValidator.validate!(turn_result)}

      {:error, reason} ->
        {:error, reason}
    end
  end

  @doc """
  确认执行前等待的操作。behavior_id 对应 confirmation_card 中的 behavior。

  从 AuthorityGate 取回 pending confirmation 上下文，执行原 intent。
  """
  @spec handle_confirm(String.t(), String.t()) :: {:ok, map()} | {:error, term()}
  def handle_confirm(behavior_id, workspace_id \\ "lobby") do
    case AuthorityGate.take_pending(behavior_id) do
      nil ->
        {:error, :unknown_behavior}

      pending ->
        turn_id = Orchestrator.allocate_turn_id()

        # Re-execute the original intent with stored context
        result = %{
          intent_name: pending.intent_name,
          extracted_slots: pending.extracted_slots,
          needs_clarification: false
        }

        turn_result = build_tentative_for(turn_id, result, nil)
        text = turn_result.assistant_message.text

        record_to_memory(workspace_id, turn_id, :assistant, text)

        # Resolve the original behavior into history
        turn_result = %{turn_result | behavior_state: %{
          active: nil,
          history: [
            %{
              behavior_type: "confirmation",
              behavior_id: behavior_id,
              status: BehaviorStatus.resolved(),
              resolution_ref: "confirmed"
            }
          ]
        }}

        {:ok, TurnResultValidator.validate!(turn_result)}
    end
  end

  @doc """
  拒绝执行前等待的操作。返回 CANCELLED TurnResult。
  """
  @spec handle_reject(String.t(), String.t()) :: {:ok, map()} | {:error, term()}
  def handle_reject(behavior_id, workspace_id \\ "lobby") do
    case AuthorityGate.take_pending(behavior_id) do
      nil ->
        {:error, :unknown_behavior}

      _pending ->
        turn_id = Orchestrator.allocate_turn_id()
        text = "已取消操作。"

        turn_result =
          build_turn_result(turn_id, %{
            phase: TurnPhase.cancelled(),
            status: Status.cancelled(),
            next_action: NextAction.no_further_action(),
            assistant_text: text,
            behavior: nil,
            ui_cards: [],
            history_behavior: %{
              behavior_type: "confirmation",
              behavior_id: behavior_id,
              status: BehaviorStatus.cancelled(),
              resolution_ref: "rejected"
            }
          })

        turn_result = %{turn_result | behavior_state: %{
          active: nil,
          history: [
            %{
              behavior_type: "confirmation",
              behavior_id: behavior_id,
              status: BehaviorStatus.cancelled(),
              resolution_ref: "rejected"
            }
          ]
        }}

        record_to_memory(workspace_id, turn_id, :assistant, text)

        {:ok, TurnResultValidator.validate!(turn_result)}
    end
  end

  # ---- Revise (VS-002/VS-003 variant) ----

  @doc """
  用户请求重新生成/换一组方向。

  VS-002 §4.1.2 / VS-003 §4.2.2：clarification 和 confirmation 卡片的 revise action。
  """
  @spec handle_revise(String.t(), String.t()) :: {:ok, map()} | {:error, term()}
  def handle_revise(behavior_id, workspace_id \\ "lobby") do
    case AuthorityGate.take_pending(behavior_id) do
      nil ->
        {:error, :unknown_behavior}

      _pending ->
        turn_id = Orchestrator.allocate_turn_id()
        text = "好的，请告诉我你希望调整的方向或补充的信息。"

        turn_result =
          build_turn_result(turn_id, %{
            phase: TurnPhase.needs_clarification(),
            status: Status.waiting_user(),
            next_action: NextAction.ask_user(),
            assistant_text: text,
            behavior: nil,
            ui_cards: [
              %{
                card_type: "clarification_card",
                priority: "normal",
                visibility: "primary",
                title: "需要更新信息",
                body: text,
                actions: [
                  %{
                    action_id: "answer",
                    action_type: "answer",
                    label: "输入反馈",
                    target_ref: "input",
                    enabled: true,
                    style_hint: "primary"
                  }
                ]
              }
            ],
            history_behavior: %{
              behavior_type: "clarification",
              behavior_id: behavior_id,
              status: BehaviorStatus.cancelled(),
              resolution_ref: "revised"
            }
          })

        record_to_memory(workspace_id, turn_id, :assistant, text)

        {:ok, TurnResultValidator.validate!(turn_result)}
    end
  end

  # ---- Dismiss (close card without further action) ----

  @doc """
  用户关闭卡片不做进一步操作。
  """
  @spec handle_dismiss(String.t(), String.t()) :: {:ok, map()} | {:error, term()}
  def handle_dismiss(behavior_id, workspace_id \\ "lobby") do
    case AuthorityGate.take_pending(behavior_id) do
      nil ->
        {:error, :unknown_behavior}

      _pending ->
        turn_id = Orchestrator.allocate_turn_id()
        text = "已关闭。随时可以继续。"

        turn_result =
          build_turn_result(turn_id, %{
            phase: TurnPhase.completed(),
            status: Status.done(),
            next_action: NextAction.no_further_action(),
            assistant_text: text,
            behavior: nil,
            ui_cards: [],
            history_behavior: %{
              behavior_type: "clarification",
              behavior_id: behavior_id,
              status: BehaviorStatus.cancelled(),
              resolution_ref: "dismissed"
            }
          })

        record_to_memory(workspace_id, turn_id, :assistant, text)

        {:ok, TurnResultValidator.validate!(turn_result)}
    end
  end

  # ---- Retry (VS-004 failure recovery) ----

  @doc """
  用户请求重试失败的操作。
  重新触发上一个 turn 的 intent 执行。
  """
  @spec handle_retry(String.t(), String.t()) :: {:ok, map()} | {:error, term()}
  def handle_retry(_behavior_id, workspace_id \\ "lobby") do
    turn_id = Orchestrator.allocate_turn_id()
    text = "正在重试..."

    turn_result =
      build_turn_result(turn_id, %{
        phase: TurnPhase.executing(),
        status: Status.running(),
        next_action: NextAction.retry_system(),
        assistant_text: text,
        behavior: nil,
        ui_cards: [
          %{
            card_type: "progress_card",
            priority: "normal",
            visibility: "primary",
            title: "重试中",
            body: "正在重新执行上次失败的操作...",
            actions: []
          }
        ]
      })

    record_to_memory(workspace_id, turn_id, :assistant, text)

    {:ok, TurnResultValidator.validate!(turn_result)}
  end

  # ---- Memory Recall (Governed Memory) ----

  defp build_memory_context(nil, _user_text, _turn_id), do: nil

  defp build_memory_context(work_id, user_text, turn_id) do
    result = MemoryRecallService.recall(work_id,
      query: user_text,
      scene: "turn_#{turn_id}",
      token_budget: 2000
    )

    %{
      text: result.text,
      iron_law_count: result.iron_law_count,
      candidate_count: result.candidate_count,
      estimated_tokens: result.estimated_tokens
    }
  end

  # ---- Episodic Memory ----

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

  defp build_unknown_clarification(turn_id, memory_context) do
    behavior_id = "behavior_#{turn_id}"

    build_turn_result(turn_id, %{
      phase: TurnPhase.needs_clarification(),
      status: Status.waiting_user(),
      next_action: NextAction.ask_user(),
      assistant_text: "抱歉，我不太理解你的意图。请重新描述一下？",
      behavior: %{
        behavior_type: "clarification",
        behavior_id: behavior_id,
        status: BehaviorStatus.waiting_user(),
        resolution_ref: nil
      },
      ui_cards: [
        clarification_card(behavior_id,
          title: "需要补充信息",
          body: "请重新描述你的意图，我会尽力理解。"
        )
      ],
      memory_context: memory_context
    })
  end

  # ---- Intent routing ----

  defp build_tentative_for(turn_id, result, memory_context) do
    case normalize_intent(result.intent_name) do
      :create_work_seed ->
        build_create_work_tentative(turn_id, result, memory_context)

      _ ->
        build_draft_tentative(turn_id, result, memory_context)
    end
  end

  defp normalize_intent("intent.CREATE_WORK_SEED"), do: :create_work_seed
  defp normalize_intent("create_work_seed"), do: :create_work_seed
  defp normalize_intent(:create_work_seed), do: :create_work_seed
  defp normalize_intent(_other), do: :other

  # ---- Generic clarification (any intent) ----

  defp build_clarification(turn_id, route_result, memory_context) do
    missing = route_result.missing_required_slots
    intent_label = intent_display_name(route_result.intent_name)
    slots = route_result.extracted_slots
    behavior_id = "behavior_#{turn_id}"

    prefix = clarification_prefix(intent_label, slots)
    body = "#{prefix}在开始之前，还需要了解：\n" <> (missing |> Enum.map_join("\n", &slot_label/1))

    build_turn_result(turn_id, %{
      phase: TurnPhase.needs_clarification(),
      status: Status.waiting_user(),
      next_action: NextAction.ask_user(),
      assistant_text: body,
      behavior: %{
        behavior_type: "clarification",
        behavior_id: behavior_id,
        status: BehaviorStatus.waiting_user(),
        resolution_ref: nil,
        missing_slots: missing
      },
      ui_cards: [
        clarification_card(behavior_id,
          title: "需要补充信息",
          body: body
        )
      ],
      memory_context: memory_context
    })
  end

  defp intent_display_name("intent.DRAFT_SCENE"), do: "起草场景"
  defp intent_display_name("intent.DRAFT_CHAPTER"), do: "起草章节"
  defp intent_display_name("intent.REVISE_DRAFT"), do: "修改草稿"
  defp intent_display_name("intent.CONTINUE_DRAFTING"), do: "续写"
  defp intent_display_name(_other), do: "执行"

  defp clarification_prefix(_intent_label, %{"genre" => genre}) when is_binary(genre) and genre != "",
    do: "好的，你想创建一部#{genre}小说。"
  defp clarification_prefix(intent_label, _slots), do: "你想#{intent_label}。"

  # ---- CREATE_WORK_SEED ----

  defp build_create_work_tentative(turn_id, route_result, memory_context) do
    slots = route_result.extracted_slots
    domain_work = Work.new(ID.uuid(), "#{slots["genre"]}小说")

    # Persist tentative work to DB — 07-consistency §4.4: tentative must have
    # a revision before adoption can check base_revision.
    payload = %{
      "title" => domain_work.title,
      "genre" => slots["genre"],
      "core_selling_point" => slots["core_selling_point"],
      "target_reader" => slots["target_reader"]
    }

    artifact =
      case AdoptionBoundary.create_tentative(payload) do
        {:ok, work} ->
          %{
            artifact_id: work.id,
            artifact_type: "work",
            adoption_status: AdoptionStatus.tentative(),
            requires_adoption: true,
            revision_base: Integer.to_string(work.revision),
            payload: %{
              title: work.title,
              genre: work.genre,
              core_selling_point: work.core_selling_point,
              target_reader: work.target_reader
            }
          }

        {:error, _changeset} ->
          # Fallback: return ephemeral artifact (DB insert failure shouldn't
          # block the turn; adoption will fail gracefully)
          %{
            artifact_id: ID.uuid(),
            artifact_type: "work",
            adoption_status: AdoptionStatus.tentative(),
            requires_adoption: true,
            payload: %{
              title: domain_work.title,
              genre: slots["genre"],
              core_selling_point: slots["core_selling_point"],
              target_reader: slots["target_reader"]
            }
          }
      end

    build_turn_result(turn_id, %{
      phase: TurnPhase.completed(),
      status: Status.done(),
      next_action: NextAction.adopt_artifacts(),
      assistant_text:
        "已为你生成作品种子：「#{slots["genre"]}小说」\n核心卖点：#{slots["core_selling_point"]}\n目标读者：#{slots["target_reader"]}",
      pending_artifacts: [artifact],
      ui_cards: [adoption_card(slots, artifact.artifact_id)],
      memory_context: memory_context
    })
  end

  # ---- Draft / Content Generation (VS-007 / VS-012) ----

  defp build_draft_tentative(turn_id, route_result, memory_context) do
    slots = route_result.extracted_slots
    intent_name = route_result.intent_name
    display = intent_display_name(intent_name)

    prompt = build_generation_prompt(intent_name, slots)

    generated_text =
      case ProviderGateway.complete(prompt) do
        {:ok, %{content: content}} -> content
        {:error, _} -> "[生成失败：Provider 不可用]"
      end

    # Ensure structural context exists for Draft attachment
    work_id = Map.get(slots, "work_id") || memory_work_id(memory_context)
    scene_id = ensure_scene_context(work_id)

    # Persist Draft via AdoptionBoundary
    artifact =
      case AdoptionBoundary.create_tentative_draft(%{
             work_id: work_id,
             scene_id: scene_id,
             content: generated_text
           }) do
        {:ok, draft} ->
          %{
            artifact_id: draft.id,
            artifact_type: "draft_text",
            adoption_status: AdoptionStatus.tentative(),
            requires_adoption: true,
            revision_base: Integer.to_string(draft.revision),
            payload: %{
              intent: intent_name,
              content: generated_text,
              slots: slots,
              work_id: work_id,
              scene_id: scene_id
            }
          }

        {:error, _changeset} ->
          artifact_id = ID.uuid()
          %{
            artifact_id: artifact_id,
            artifact_type: "draft_text",
            adoption_status: AdoptionStatus.tentative(),
            requires_adoption: true,
            payload: %{
              intent: intent_name,
              content: generated_text,
              slots: slots
            }
          }
      end

    build_turn_result(turn_id, %{
      phase: TurnPhase.completed(),
      status: Status.done(),
      next_action: NextAction.adopt_artifacts(),
      assistant_text: "已为你#{display}：\n\n#{generated_text}",
      pending_artifacts: [artifact],
      ui_cards: [adoption_card_for_draft(slots, artifact.artifact_id, display)],
      memory_context: memory_context
    })
  end

  defp memory_work_id(%{work_id: work_id}) when is_binary(work_id), do: work_id
  defp memory_work_id(_), do: nil

  # Auto-create default Volume → Chapter → Scene hierarchy if needed
  defp ensure_scene_context(nil), do: nil
  defp ensure_scene_context(work_id) do
    case Repo.one(from s in Scene, where: s.work_id == ^work_id, limit: 1) do
      %Scene{id: scene_id} -> scene_id
      nil -> create_default_hierarchy(work_id)
    end
  end

  defp create_default_hierarchy(work_id) do
    vol_id = Ecto.UUID.generate()
    ch_id = Ecto.UUID.generate()
    sc_id = Ecto.UUID.generate()

    %Volume{}
    |> Volume.changeset(%{work_id: work_id, title: "第一卷", seq: 1, status: "PLANNED", id: vol_id})
    |> Repo.insert!(on_conflict: :nothing)

    %Chapter{}
    |> Chapter.changeset(%{work_id: work_id, volume_id: vol_id, title: "第一章", seq: 1, status: "PLANNED", id: ch_id})
    |> Repo.insert!(on_conflict: :nothing)

    %Scene{}
    |> Scene.changeset(%{work_id: work_id, chapter_id: ch_id, title: "第一场", seq: 1, status: "PLANNED", id: sc_id})
    |> Repo.insert!(on_conflict: :nothing)

    sc_id
  end

  defp build_draft_projection_refs(draft) do
    [
      %{
        projection_type: "reading_projection_chapter",
        projection_id: "proj-draft-#{draft.id}",
        source_revision_refs: ["rev-draft-#{draft.id}-r#{draft.revision}"],
        refresh_status: ProjectionRefreshStatus.stale()
      }
    ]
  end

  defp build_generation_prompt(intent_name, slots) do
    intent_label = intent_display_name(intent_name)
    slot_desc = Enum.map_join(slots, "\n", fn {k, v} -> "  - #{k}: #{v}" end)

    "你是一位小说创作助手。用户要求：#{intent_label}。\n参数：\n#{slot_desc}\n\n请生成内容。"
  end

  defp adoption_card_for_draft(_slots, artifact_id, display) do
    %{
      card_type: "adoption_card",
      priority: "high",
      visibility: "primary",
      title: "#{display}结果",
      body: "AI 已生成#{display}内容，请审核后决定采纳、修改或放弃。",
      artifact_refs: [artifact_id],
      actions: [
        %{
          action_id: "accept",
          action_type: "accept",
          label: "采纳",
          target_ref: artifact_id,
          enabled: true,
          style_hint: "primary"
        },
        %{
          action_id: "edit_then_accept",
          action_type: "edit_then_accept",
          label: "修改后采纳",
          target_ref: artifact_id,
          enabled: true,
          style_hint: "secondary"
        },
        %{
          action_id: "discard",
          action_type: "discard",
          label: "放弃",
          target_ref: artifact_id,
          enabled: true,
          style_hint: "secondary"
        }
      ]
    }
  end

  # ---- Confirmation (VS-003) ----

  defp build_confirmation(turn_id, route_result, reason, memory_context) do
    behavior_id = AuthorityGate.request_confirmation(%{
      intent_name: route_result.intent_name,
      extracted_slots: route_result.extracted_slots
    })

    _slots = route_result.extracted_slots
    display = intent_display_name(route_result.intent_name)
    title = "确认#{display}"

    build_turn_result(turn_id, %{
      phase: TurnPhase.needs_confirmation(),
      status: Status.waiting_user(),
      next_action: NextAction.confirm_before_execute(),
      assistant_text:
        "即将#{display}。\n\n#{reason}",
      behavior: %{
        behavior_type: "confirmation",
        behavior_id: behavior_id,
        status: BehaviorStatus.waiting_user(),
        resolution_ref: nil,
        pending_intent: route_result.intent_name
      },
      ui_cards: [
        confirmation_card(behavior_id,
          title: title,
          body: "即将#{display}\n\n#{reason}"
        )
      ],
      memory_context: memory_context
    })
  end

  defp confirmation_card(behavior_id, opts) do
    %{
      card_type: "confirmation_card",
      priority: "high",
      visibility: "primary",
      title: Keyword.get(opts, :title, "请确认"),
      body: Keyword.get(opts, :body, ""),
      actions: [
        %{
          action_id: "confirm",
          action_type: "confirm",
          label: "确认执行",
          target_ref: behavior_id,
          enabled: true,
          style_hint: "primary"
        },
        %{
          action_id: "reject",
          action_type: "reject",
          label: "取消",
          target_ref: behavior_id,
          enabled: true,
          style_hint: "secondary"
        }
      ]
    }
  end

  defp clarification_card(behavior_id, opts) do
    %{
      card_type: "clarification_card",
      priority: "normal",
      visibility: "primary",
      title: Keyword.get(opts, :title, "需要补充信息"),
      body: Keyword.get(opts, :body, ""),
      actions: [
        %{
          action_id: "answer",
          action_type: "answer",
          label: "输入回答",
          target_ref: behavior_id,
          enabled: true,
          style_hint: "primary"
        }
      ]
    }
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
          action_type: "accept",
          label: "确认创建",
          target_ref: artifact_id,
          enabled: true,
          style_hint: "primary"
        },
        %{
          action_id: "edit_then_accept",
          action_type: "edit_then_accept",
          label: "修改后采纳",
          target_ref: artifact_id,
          enabled: true,
          style_hint: "secondary"
        },
        %{
          action_id: "discard",
          action_type: "discard",
          label: "放弃",
          target_ref: artifact_id,
          enabled: true,
          style_hint: "secondary"
        }
      ]
    }
  end

  # ---- Projection (VS-005) ----

  defp build_projection_refs(work) do
    [
      %{
        projection_type: "reading_projection_root",
        projection_id: "proj-#{work.id}",
        source_revision_refs: ["rev-work-#{work.id}-r#{work.revision}"],
        refresh_status: ProjectionRefreshStatus.stale()
      }
    ]
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
      projection_refs: Map.get(fields, :projection_refs, []),
      validation: %{},
      usage: %{},
      trace_ref: %{},
      produced_at: DateTime.utc_now() |> DateTime.to_iso8601(),
      memory_context: Map.get(fields, :memory_context)
    }
  end

  defp maybe_turn_id(nil), do: []
  defp maybe_turn_id(turn_id), do: [turn_id: turn_id]

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
  defp slot_label("scene_boundary"), do: "- 场景的边界或剧情范围是什么？"
  defp slot_label("revision_direction"), do: "- 你想往哪个方向修改？"
  defp slot_label("continuation_range"), do: "- 你想从哪继续写？"
  defp slot_label(slot), do: "- #{slot}"
end
