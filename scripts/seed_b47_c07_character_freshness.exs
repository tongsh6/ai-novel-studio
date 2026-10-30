alias NovelApplication.{WorkService, WorkSessionService}
alias NovelPersistence.{AdoptionRepository, MemoryLog, Repo}
alias NovelPersistence.Schemas.Character

# B47-C07 CP3：真实角色修订页面 stale/fresh 双作品种子。
# - stale：候选 base_fingerprint 取修改 summary 前的整体 fingerprint；随后 summary 被更新，
#   角色 narrative_role 未变。旧实现会因 old_role==current 放行；C07=A 要求整体 fingerprint
#   stale 拒绝且零写入。
# - fresh：候选 fingerprint 与当前角色一致，采纳应成功更新 narrative_role。
# 候选按产品同形 TurnResult.adoption_state.pending + ui_cards/available_actions 恢复；
# 产品代码不读取本文件；driver 只点击用户可见「保存到作品」。

defmodule B47C07CharacterFreshnessSeed do
  @moduledoc false

  import Ecto.Query

  alias NovelApplication.{WorkService, WorkSessionService}
  alias NovelPersistence.{AdoptionRepository, MemoryLog, Repo}
  alias NovelPersistence.Schemas.Character

  @tag "[b47-c07-character-freshness-seed]"

  def run do
    results = [seed(:stale), seed(:fresh)]
    Enum.each(results, fn result -> IO.puts("#{@tag} work=#{Jason.encode!(result)}") end)

    summary = %{
      seed_version: "b47-c07-character-freshness/v1",
      works: results,
      self_check: Enum.all?(results, & &1.self_check_ok)
    }

    IO.puts("#{@tag} seed=#{Jason.encode!(summary)}")
    unless summary.self_check, do: raise("B47-C07 seed self-check failed")
    IO.puts("#{@tag} ok works=#{length(results)}")
  end

  defp seed(scenario) do
    title =
      case scenario do
        :stale -> "B47-C07 角色错误指纹 · 过期基线"
        :fresh -> "B47-C07 角色修订 · 新鲜基线"
      end

    {:ok, work} =
      WorkService.create(%{
        "title" => title,
        "genre" => "雨港悬疑",
        "core_selling_point" => "角色修订持久层整体 fingerprint 检查",
        "target_reader" => "关注档案一致性的作者",
        "tone_preference" => "克制"
      })

    {:ok, snapshot} = WorkSessionService.resume(work.id)
    session_id = snapshot.active_session.id

    character =
      Repo.insert!(%Character{
        work_id: work.id,
        name: "沈砚",
        aliases: ["老沈"],
        role: "灯楼查账人",
        narrative_role: "ENSEMBLE_POV",
        summary: "群像视角中的查账人",
        status: "ACCEPTED"
      })

    character_ref = "character:#{character.id}"
    {:ok, fact_before} = AdoptionRepository.character_profile_context(work.id, character_ref)

    payload = %{
      object_kind: "character_profile_revision",
      character_ref: character_ref,
      character_name: "沈砚",
      base_fingerprint: fact_before.base_fingerprint,
      changes: [%{field: "narrative_role", old: "ENSEMBLE_POV", new: "PROTAGONIST"}],
      effects: ["character_field_update"],
      other_character_changes: [],
      adoption_effect: %{mode: "character_field_update", character_ref: character_ref}
    }

    if scenario == :stale do
      character
      |> Character.changeset(%{summary: "更新后的档案摘要（非角色字段）"})
      |> Repo.update!()
    end

    {:ok, fact_current} = AdoptionRepository.character_profile_context(work.id, character_ref)
    turn_id = "turn_b47_c07_character_#{scenario}"
    artifact_id = "as_b47_c07_character_#{scenario}"
    candidate_title = "沈砚 · 角色叙事身份修订稿"
    candidate_body = "将沈砚的叙事身份从群像视角（ENSEMBLE_POV）调整为主角（PROTAGONIST）。"

    turn_result =
      build_turn_result(
        work,
        session_id,
        turn_id,
        artifact_id,
        candidate_title,
        candidate_body,
        payload
      )

    record_turn!(work, session_id, turn_id, turn_result)

    {:ok, restored} = WorkSessionService.resume(work.id)
    pending_ids = Enum.map(restored.pending_adoptions, &artifact_field(&1, :artifact_id))

    pending_turns =
      Enum.map(restored.pending_adoption_turn_results, &artifact_field(&1, :turn_id))

    true = artifact_id in pending_ids
    true = turn_id in pending_turns

    %{
      scenario: Atom.to_string(scenario),
      work_id: work.id,
      work_title: title,
      session_id: session_id,
      turn_id: turn_id,
      artifact_id: artifact_id,
      character_id: character.id,
      character_ref: character_ref,
      declared_fingerprint: fact_before.base_fingerprint,
      current_fingerprint: fact_current.base_fingerprint,
      current_summary: fact_current.summary,
      expected_freshness_status: if(scenario == :stale, do: "stale", else: "fresh"),
      expected_decision:
        if(scenario == :stale, do: "fail_with_recovery", else: "adopt_tentative"),
      expected_reason_codes: if(scenario == :stale, do: ["stale_base"], else: []),
      expected_role_after: if(scenario == :stale, do: "ENSEMBLE_POV", else: "PROTAGONIST"),
      visible_approve_label: "保存到作品",
      pending_artifact_visible: true,
      self_check_ok: true
    }
  end

  defp build_turn_result(
         work,
         session_id,
         turn_id,
         artifact_id,
         card_title,
         candidate_body,
         payload
       ) do
    %{
      schema_version: "3.0-draft",
      turn_id: turn_id,
      work_id: work.id,
      session_id: session_id,
      frame_ref: "frame_b47_c07_#{artifact_id}",
      phase: "completed",
      status: "conversational",
      assistant_message: %{
        text: "已生成沈砚的角色叙事身份修订候选；保存前不会改写角色档案。"
      },
      frame_summary: %{frame_type: "revision", dialogue_goal: "B47-C07 角色意图修订"},
      ui_cards: [
        %{
          card_type: "candidate_set",
          priority: "high",
          visibility: "always",
          title: card_title,
          body: candidate_body,
          artifact_refs: [artifact_id],
          candidate_set_ref: artifact_id,
          artifact_type: "character_profile_revision",
          items: [
            %{
              item_id: "item_b47_c07_#{artifact_id}",
              title: card_title,
              body: candidate_body,
              rationale: "角色叙事身份修订"
            }
          ],
          tentative: true
        }
      ],
      adoption_state: %{
        pending: [
          %{
            artifact_id: artifact_id,
            artifact_type: "character_profile_revision",
            adoption_status: "TENTATIVE",
            requires_adoption: true,
            source_tool_result_ref: "tr_b47_c07_#{artifact_id}",
            payload: payload
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
          trace_ref: "tr_b47_c07_#{artifact_id}"
        },
        %{
          action_id: "discard:#{artifact_id}",
          action_type: "discard",
          label_key: "artifact.discard",
          source_turn_ref: turn_id,
          target_ref: artifact_id,
          enabled: true,
          idempotency_key: "idem:#{turn_id}:discard:#{artifact_id}",
          trace_ref: "tr_b47_c07_#{artifact_id}"
        }
      ],
      truthfulness: %{
        tool_called: false,
        artifact_adopted: false,
        production_write_performed: false
      },
      trace_summary: %{
        trace_ref: "trace_b47_c07_#{artifact_id}",
        decision_type: "revision",
        reason_codes: ["restored_character_revision_candidate"]
      },
      produced_at: DateTime.utc_now() |> DateTime.to_iso8601()
    }
  end

  defp record_turn!(work, session_id, turn_id, turn_result) do
    entries = [
      %{
        workspace_id: work.id,
        session_id: session_id,
        turn_id: turn_id,
        role: "user",
        content: %{text: "把沈砚改成主角。"},
        source_ref: turn_id,
        scope_ref: work.id,
        freshness_score: 0.6,
        importance_score: 0.6,
        replayable: true,
        retrievable: true
      },
      %{
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
      }
    ]

    Enum.each(entries, fn entry -> {:ok, _} = MemoryLog.record(entry) end)
  end

  defp artifact_field(artifact, key) do
    Map.get(artifact, key) || Map.get(artifact, Atom.to_string(key)) ||
      artifact_field_from_struct(artifact, key)
  end

  defp artifact_field_from_struct(artifact, key) when is_struct(artifact) do
    artifact |> Map.from_struct() |> Map.get(key)
  end

  defp artifact_field_from_struct(_artifact, _key), do: nil
end

B47C07CharacterFreshnessSeed.run()
