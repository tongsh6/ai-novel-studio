defmodule NovelApplication.B29CharacterProfileTest do
  use ExUnit.Case, async: true

  alias NovelAgent.Provider.Execution
  alias NovelApplication.{CapabilityRegistry, CharacterProfile, PendingArtifactWorkflow}
  alias NovelDomain.DialogueContext

  @shen_ref "character:11111111-1111-1111-1111-111111111111"
  @gu_ref "character:22222222-2222-2222-2222-222222222222"
  @shen2_ref "character:33333333-3333-3333-3333-333333333333"

  defp target(ref, name, aliases, role, summary \\ "角色摘要") do
    %{
      character_ref: ref,
      name: name,
      aliases: aliases,
      role: "身份",
      summary: summary,
      narrative_role: role,
      status: "ACCEPTED",
      updated_at: "2026-10-24T22:24:08Z",
      base_fingerprint: "fp-#{ref}"
    }
  end

  defp roster do
    [
      target(@shen_ref, "沈砚", ["老沈"], "ENSEMBLE_POV"),
      target(@gu_ref, "顾青", [], "PROTAGONIST"),
      target(@shen2_ref, "沈砚", ["小沈"], "MINOR")
    ]
  end

  test "能力注册：revise_character_profile 与 design/evolution 严格区分" do
    entry = CapabilityRegistry.get("revise_character_profile")

    assert entry
    assert entry.provider_dependency == :none
    assert entry.write_scopes == ["character_dossier"]
    assert entry.status == :active
    assert entry.effect_summary =~ "修订既有角色主档案字段"
    assert entry.effect_summary =~ "不新建角色"
    assert entry.effect_summary =~ "不写正文"
    assert entry.effect_summary =~ "不冒充角色演化记忆"
    assert "revise_character_profile" in CapabilityRegistry.list()

    refute entry == CapabilityRegistry.get("character_design")
    refute entry == CapabilityRegistry.get("character_evolution")
  end

  test "角色绑定：唯一别名/name/ref 命中；同名歧义/不存在不猜" do
    assert {:ok, %{character_ref: @shen_ref}} =
             CharacterProfile.resolve_target("指定老沈为主角", roster())

    assert {:ok, %{character_ref: @shen_ref}} =
             CharacterProfile.resolve_target("把老沈确立为主角", roster(), nil)

    # 名字「沈砚」命中两个同名 → 歧义（不按 name 猜）
    assert {:error, :target_ambiguous} = CharacterProfile.resolve_target("指定沈砚为主角", roster())

    # 模型提供 ref 时以 ref 为准（同名字也能精确绑定）
    assert {:ok, %{character_ref: @shen2_ref}} =
             CharacterProfile.resolve_target("指定沈砚为主角", roster(), @shen2_ref)

    assert {:ok, %{character_ref: @gu_ref}} =
             CharacterProfile.resolve_target("指定顾青为主角", roster())

    assert {:error, :target_missing} = CharacterProfile.resolve_target("指定阿鸢为主角", roster())
  end

  test "narrative_role 白名单从原话映射（修订意图路由已移交 B33 判断链）" do
    assert CharacterProfile.narrative_role_from_text("指定沈砚为主角") == "PROTAGONIST"
    assert CharacterProfile.narrative_role_from_text("把顾青改成反派") == "ANTAGONIST"
    assert CharacterProfile.narrative_role_from_text("把已有角色的叙事身份从配角改为主角") == "PROTAGONIST"
    assert CharacterProfile.narrative_role_from_text("把阿鸢设为配角") == "SUPPORTING"
    assert CharacterProfile.narrative_role_from_text("把沈砚定为主角") == "PROTAGONIST"
    assert CharacterProfile.narrative_role_from_text("随便聊聊") == nil
  end

  test "候选 payload：目标旧→新 + 唯一主角时其它角色变化供裁决（不默认应用）" do
    shen = target(@shen_ref, "沈砚", ["老沈"], "ENSEMBLE_POV")

    assert {:ok, payload} =
             CharacterProfile.build_candidate(
               shen,
               "PROTAGONIST",
               "把沈砚定为唯一主角，替换原主角",
               roster()
             )

    assert payload.object_kind == "character_profile_revision"
    assert payload.character_ref == @shen_ref
    assert payload.character_name == "沈砚"
    assert payload.base_fingerprint == "fp-#{@shen_ref}"
    assert payload.effects == ["character_field_update"]

    assert payload.changes == [
             %{field: "narrative_role", old: "ENSEMBLE_POV", new: "PROTAGONIST"}
           ]

    assert payload.adoption_effect == %{
             mode: "character_field_update",
             character_ref: @shen_ref
           }

    # 采纳 payload 首闭环只改目标；既有另一个 PROTAGONIST（顾青）只作建议展示
    assert payload.other_character_changes == []

    assert [%{character_ref: @gu_ref, character_name: "顾青"}] =
             payload.suggested_other_character_changes

    assert :ok = CharacterProfile.validate_changes(payload)

    # 普通指定（非唯一）不生成其它角色变化建议
    {:ok, normal} = CharacterProfile.build_candidate(shen, "PROTAGONIST", "把沈砚设为主角", roster())
    assert normal.other_character_changes == []
    assert normal.suggested_other_character_changes == []

    # 白名单/枚举校验
    assert {:error, :unsupported_field} =
             CharacterProfile.validate_changes(%{changes: [%{field: "aliases", new: "x"}]})

    assert {:error, :invalid_character_role} =
             CharacterProfile.validate_changes(%{
               changes: [%{field: "narrative_role", old: "MINOR", new: "VILLAIN"}],
               effects: ["character_field_update"]
             })

    assert {:error, :invalid_character_role} =
             CharacterProfile.build_candidate(shen, "VILLAIN", "把沈砚设为主角", roster())
  end

  defp desired_judgment(overrides \\ %{}) do
    Map.merge(
      %{
        action: "execute",
        capability: "revise_character_profile",
        character_ref: @shen_ref,
        narrative: "已找到沈砚（老沈），我会先给出叙事身份修订候选，待你确认后再改。",
        dialogue_goal: "把沈砚定为主角",
        reason: "character_profile_revision",
        frame_type: "execution_candidate",
        candidate_directions: [],
        pending_artifact_ref: nil,
        adopted_content_ref: nil,
        question: nil,
        options: [],
        reason_codes: [],
        guidance: nil,
        missing_effect: nil,
        author_content_source_ref: nil,
        explore_request: nil,
        plan_result: nil,
        tool_call_id: nil,
        model_interpretation_status: "provided"
      },
      overrides
    )
  end

  defp run(author_text) do
    %{
      run_id: "run-b29-character",
      run_mode: :bounded,
      profile_ref: "judgment_loop_v1",
      budget: %{max_tool_calls: 2, max_provider_calls: 2},
      consumed_budget: %{},
      authority_scope: %{production_write: false, allowed_tools: ["judgment"]},
      workspace_id: "work-b29",
      work_id: "work-b29",
      session_id: "session-b29",
      parent_turn_ref: "turn-b29",
      goal: %{text: author_text, version: 1}
    }
  end

  defp context do
    %DialogueContext{workspace_id: "work-b29", interaction_state: %{}}
  end

  test "未采纳零写入：执行修订产出候选（无 provider、无 DB 写入），字段/对象可见" do
    judgment = desired_judgment()
    provider = %Execution{result_fn: fn _ -> flunk("角色档案修订不得调用 provider") end}

    assert {:ok, result} =
             PendingArtifactWorkflow.run(
               judgment,
               %{"character_profile_context" => %{roster: roster()}},
               run("把沈砚定为唯一主角，替换原主角"),
               context(),
               provider
             )

    assert result.provider_call_count == 0
    [pending] = result.turn_result.adoption_state.pending
    assert pending.artifact_type == :character_profile_revision
    assert pending.adoption_status == NovelDomain.AdoptionStatus.initial()

    payload = pending.payload
    assert payload.object_kind == "character_profile_revision"
    assert payload.character_ref == @shen_ref
    assert payload.character_name == "沈砚"
    assert payload.base_fingerprint == "fp-#{@shen_ref}"
    assert payload.effects == ["character_field_update"]

    assert payload.changes == [
             %{field: "narrative_role", old: "ENSEMBLE_POV", new: "PROTAGONIST"}
           ]

    assert payload.adoption_effect == %{mode: "character_field_update", character_ref: @shen_ref}
    assert payload.other_character_changes == []
    assert Enum.map(payload.suggested_other_character_changes, & &1.character_ref) == [@gu_ref]

    [item] = payload.items
    assert item.body =~ "narrative_role"
    assert item.body =~ "ENSEMBLE_POV → PROTAGONIST"
    assert item.body =~ "其它角色（需作者逐项裁决"

    # 候选 title 可见对象，不新建角色（runtime 只产 pending，无 production_write）
    assert payload.title =~ "沈砚"

    refute Enum.any?(
             result.turn_result.truthfulness |> Map.get(:evidence_refs, []),
             &(&1 == :none)
           )
  end

  test "同名歧义：绑定失败给可解释错误，不产候选" do
    judgment = desired_judgment(%{character_ref: nil})

    assert {:error, {:character_profile_invalid, :target_ambiguous}} =
             PendingArtifactWorkflow.run(
               judgment,
               %{"character_profile_context" => %{roster: roster()}},
               run("指定沈砚为主角"),
               context(),
               %Execution{result_fn: fn _ -> flunk("不得调用 provider") end}
             )
  end
end
