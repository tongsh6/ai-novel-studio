defmodule NovelApplication.TurnService do
  @moduledoc """
  Turn 用例编排：Router → Executor → TurnResult 组装。

  Phase 0 Week 4：只支持 CREATE_WORK_SEED 一条链路。
  """

  alias NovelAgent.Router
  alias NovelDomain.Work
  alias NovelFoundation.ID

  @doc """
  处理用户文本输入，返回 TurnResult map。
  """
  @spec handle_message(String.t(), String.t()) :: map()
  def handle_message(user_text, turn_id \\ nil) do
    turn_id = turn_id || "turn_#{System.unique_integer([:positive])}"

    case Router.route(user_text) do
      %{intent_name: :unknown} ->
        build_turn_result(turn_id, "clarification", %{
          text: "抱歉，我不太理解你的意图。请重新描述一下？"
        })

      %{intent_name: :create_work_seed, needs_clarification: true} = result ->
        build_create_work_clarification(turn_id, result)

      %{intent_name: :create_work_seed, needs_clarification: false} = result ->
        build_create_work_tentative(turn_id, result)
    end
  end

  # ---- CREATE_WORK_SEED ----

  defp build_create_work_clarification(turn_id, route_result) do
    missing = route_result.missing_required_slots
    genre = route_result.extracted_slots[:genre] || "未指定"

    build_turn_result(turn_id, "clarification", %{
      text:
        "好的，你想创建一部#{genre}小说。在开始之前，我还需要了解：\n" <>
          (missing |> Enum.map_join("\n", &slot_label/1)),
      missing_slots: missing,
      genre: genre
    })
  end

  defp build_create_work_tentative(turn_id, route_result) do
    slots = route_result.extracted_slots
    work = Work.new(ID.uuid(), "#{slots.genre}小说")

    artifact_id = ID.uuid()

    build_turn_result(turn_id, "await_adoption", %{
      text:
        "已为你生成作品种子：「#{slots.genre}小说」\n核心卖点：#{slots.core_selling_point}\n目标读者：#{slots.target_reader}",
      artifact: %{
        artifact_id: artifact_id,
        artifact_type: "work",
        adoption_status: "TENTATIVE",
        requires_adoption: true,
        payload: %{
          title: work.title,
          genre: slots.genre,
          core_selling_point: slots.core_selling_point,
          target_reader: slots.target_reader
        }
      },
      ui_cards: [
        %{
          card_type: "adoption_card",
          priority: "high",
          visibility: "primary",
          title: "确认创建作品",
          body: "即将创建「#{slots.genre}小说」",
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
      ]
    })
  end

  # ---- Helpers ----

  defp build_turn_result(turn_id, next_action, fields) do
    %{
      schema_version: "0.1.0",
      turn_id: turn_id,
      phase: "execution",
      status: "completed",
      next_action: next_action,
      assistant_message: %{text: fields.text},
      ui_cards: Map.get(fields, :ui_cards, []),
      adoption_state: build_adoption_state(fields),
      behavior_state: build_behavior_state(fields),
      produced_at: DateTime.utc_now() |> DateTime.to_iso8601()
    }
  end

  defp build_adoption_state(fields) do
    case Map.get(fields, :artifact) do
      nil -> %{pending: [], resolved: []}
      artifact -> %{pending: [artifact], resolved: []}
    end
  end

  defp build_behavior_state(fields) do
    case Map.get(fields, :missing_slots) do
      nil -> %{active: nil}
      missing -> %{active: %{type: "clarification", missing_slots: missing}}
    end
  end

  defp slot_label(:core_selling_point), do: "- 这部小说的核心卖点是什么？"
  defp slot_label(:target_reader), do: "- 目标读者群体是？"
  defp slot_label(:tone_preference), do: "- 偏好什么语调风格？"
  defp slot_label(slot), do: "- #{slot}"
end
