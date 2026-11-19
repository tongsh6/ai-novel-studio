defmodule NovelApplication.AuthorVisible.PresenterTest do
  use ExUnit.Case, async: true

  alias NovelApplication.AuthorVisible.Presenter
  alias NovelApplication.AuthorVisible.Registry
  alias NovelCommon.AuthorVisible.Display
  alias NovelCommon.AuthorVisible.Text

  describe "operation_label/1（确认/取消/动作文案共用）" do
    test "已登记 tool/capability code 返回作者显示名" do
      assert %Text{text: "正文写作"} = Presenter.operation_label("prose_writing")
      assert %Text{text: "章节目标"} = Presenter.operation_label("chapter_mission")
      assert Presenter.operation_label_text("character_design") == "角色设计"
    end

    test "未登记 ref 返回作者安全兜底，不回显内部 ref/tool code" do
      ref = "artifact:b71-unregistered-ref-001"
      label = Presenter.operation_label_text(ref)

      assert label == "创作操作"
      refute label =~ "unregistered"
      refute label =~ "artifact:"
    end

    test "nil/空值返回中性文案" do
      assert Presenter.operation_label_text(nil) == "本轮操作"
      assert Presenter.operation_label_text("") == "本轮操作"
    end
  end

  describe "provider_status/2（状态行 additive 显示字段）" do
    test "测试替身未登记作者显示名，走安全兜底且内部 id 只留在调用方字段" do
      status = Presenter.provider_status(:stub, "slice_verify")

      # 2026-11-08 作者裁决：生产显示名 SSOT 不登记测试替身，未登记 code 走
      # 作者安全 fallback（不含内部 code），不再给测试环境专名。
      assert status.provider_display_name == "当前模型服务"
      assert status.provider_display_name == Display.fallback(:provider)
      # 模型名不可证时不伪造作者名（前端只显示一次「当前模型」）。
      assert status.model_display_name == nil
      refute status.provider_display_name =~ "stub"
      refute status.provider_display_name =~ "slice_verify"
    end

    test "真实 provider 返回作者名；未知 provider 走兜底" do
      assert Presenter.provider_status(:strata, nil).provider_display_name == "本地模型"
      assert Presenter.provider_status(:unknown_provider, nil).provider_display_name == "当前模型服务"
      assert Presenter.provider_status(:openai, "gpt-4o").model_display_name == nil
    end
  end

  describe "why_line/1 与 frame_label/1" do
    test "reason code / frame_type 走 SSOT，未知值兜底" do
      assert Presenter.why_line("gates_passed") == "执行门禁已通过。"
      assert Presenter.why_line("unknown_reason") == "已记录"
      assert Presenter.frame_label("creative_exploration") == "探索"
      assert Presenter.frame_label("unknown_frame") == "创作进展"
    end
  end

  describe "确认/取消作者文案（唯一出口）" do
    test "已登记目标返回作者可读操作名，未知目标不回显内部 ref/code" do
      assert Presenter.confirmed_action_message("prose_writing") =~
               "已确认「正文写作」操作"

      assert Presenter.cancelled_action_message("prose_writing") =~
               "已取消等待；「正文写作」不会执行"

      unknown = Presenter.confirmed_action_message("artifact:unknown-ref-001")
      assert unknown =~ "「创作操作」"
      refute unknown =~ "unknown-ref"
      refute unknown =~ "artifact:"
    end

    test "无目标时取消文案使用中性「这项操作」" do
      for target <- [nil, ""] do
        assert Presenter.cancelled_action_message(target) =~
                 "已取消等待；这项操作不会执行，也没有写入作品事实。"
      end
    end

    test "确认对象显示名：登记目标用作者名、未知 ref 用中性文案" do
      assert Presenter.confirmation_target("prose_writing") == "正文写作"
      assert Presenter.confirmation_target("character_design") == "角色设计"
      assert Presenter.confirmation_target("target-1") == "本轮待确认操作"
      assert Presenter.confirmation_target(nil) == "本轮待确认操作"
    end
  end

  describe "错误码作者可读提示（error_label）" do
    test "已登记错误码返回作者可读提示，未知码兜底不回显内部 code" do
      assert Presenter.error_label(:target_missing) == "未找到目标对象"
      assert Presenter.error_label("execution_in_progress") == "当前有任务在执行"
      assert Presenter.error_label(:transcript_not_found) == "会话记录未找到"
      assert Presenter.error_label("checkpoint_persistence_failed") == "整理失败，请稍后重试"
      assert Presenter.error_label(:timeout) == "模型响应超时"
      assert Presenter.error_label(:rate_limit) == "模型服务请求过于频繁"

      unknown = Presenter.error_label("new_unregistered_error")
      assert unknown == "处理遇到问题"
      refute unknown =~ "new_unregistered_error"
    end
  end

  describe "阶段 summary 显示名（tool_label/decision_label）" do
    test "工具与决策 code 转作者可读名，未知值兜底" do
      assert Presenter.tool_label("prose_writing") == "正文写作"
      assert Presenter.tool_label("chapter_mission") == "章节目标"
      assert Presenter.tool_label("unknown_tool_x") == "创作操作"

      assert Presenter.decision_label("require_confirmation") == "需要作者确认"
      assert Presenter.decision_label("allow_tool") == "允许执行工具"
      assert Presenter.decision_label("unknown_decision") == "处理中"
    end
  end

  describe "角色档案的作者可辨认投影" do
    test "目标及其他主角使用同批事实，中文差异和未生效状态完整可读" do
      target = role_target("character:old-shen", "沈砚", ["老沈"], "灯楼查账人", "ENSEMBLE_POV")
      other = role_target("character:gu", "顾青", [], "巡夜人", "PROTAGONIST")
      same_name = role_target("character:young-shen", "沈砚", ["小沈"], "账房学徒", "MINOR")
      payload = role_payload(target, [other])

      expected = %{
        title: "沈砚（别名：老沈；身份：灯楼查账人；当前：群像视角） · 叙事身份修订",
        body:
          "- 叙事身份：群像视角 → 主角\n\n候选尚未采纳，角色档案尚未修改。\n\n" <>
            "其它角色（需作者逐项裁决，未默认应用）：\n" <>
            "- 顾青（身份：巡夜人；当前：主角）；未自动修改"
      }

      for roster <- [[target, other, same_name], [same_name, other, target]] do
        assert {:ok, ^expected} = Presenter.character_profile_candidate(payload, target, roster)
      end

      assert payload.character_ref == "character:old-shen"

      assert payload.changes == [
               %{field: "narrative_role", old: "ENSEMBLE_POV", new: "PROTAGONIST"}
             ]

      assert payload.other_character_changes == []
      assert [%{character_ref: "character:gu"}] = payload.suggested_other_character_changes
      refute expected.body =~ "character:"
      refute expected.body =~ "narrative_role"
      refute expected.body =~ "PROTAGONIST"
    end

    test "同名和共享别名仍用完整事实区分；无变化状态不冒充候选" do
      target = role_target("character:elder", "沈砚", ["老沈"], "灯楼查账人", "PROTAGONIST")
      other = role_target("character:apprentice", "沈砚", ["老沈"], "账房学徒", "PROTAGONIST")
      facts = role_no_change(target)

      assert {:ok, "沈砚（别名：老沈；身份：灯楼查账人；当前：主角） 当前已是主角，本次无需修改；角色档案未发生变更。"} =
               Presenter.character_profile_no_change(facts, target, [other, target])
    end

    test "五种内部叙事角色仅经中文显示域投影，空旧身份明确显示未设置" do
      for {role, label} <- [
            {"PROTAGONIST", "主角"},
            {"ANTAGONIST", "反派"},
            {"SUPPORTING", "配角"},
            {"MINOR", "次要角色"},
            {"ENSEMBLE_POV", "群像视角"}
          ] do
        target = role_target("character:known", "配角书店店主", [], nil, role)

        assert {:ok, message} =
                 Presenter.character_profile_no_change(role_no_change(target), target, [target])

        assert message == "配角书店店主（当前：#{label}） 当前已是#{label}，本次无需修改；角色档案未发生变更。"
      end

      target = role_target("character:unset", "沈砚", [], nil, nil)

      assert {:ok, %{body: body}} =
               Presenter.character_profile_candidate(role_payload(target), target, [target])

      assert body == "- 叙事身份：未设置 → 主角\n\n候选尚未采纳，角色档案尚未修改。"
    end

    test "可见事实完全相同不能凭隐藏 ref、摘要或顺序宣称可辨认" do
      target = role_target("character:first", "沈砚", ["老沈", "沈先生"], "查账人", "PROTAGONIST")

      other = %{
        target
        | character_ref: "character:second",
          aliases: ["沈先生", "老沈"],
          summary: "另一份摘要",
          base_fingerprint: "second-fingerprint"
      }

      for roster <- [[target, other], [other, target]] do
        assert {:error, :display_identity_ambiguous} =
                 Presenter.character_profile_no_change(role_no_change(target), target, roster)
      end

      candidate_target = %{target | narrative_role: "ENSEMBLE_POV"}
      candidate_other = %{other | narrative_role: "ENSEMBLE_POV"}

      assert {:error, :display_identity_ambiguous} =
               Presenter.character_profile_candidate(
                 role_payload(candidate_target),
                 candidate_target,
                 [candidate_other, candidate_target]
               )
    end

    test "身份投影遵循页面空白折叠，别名归一后去重且不改原始事实" do
      target =
        role_target(
          "character:spaced",
          " \t沈  砚\r\n",
          ["老  沈", "\t老 沈  ", "\n", "沈\u00a0先生"],
          " 灯楼\t\n查账人 ",
          "ENSEMBLE_POV"
        )

      payload = role_payload(target)

      assert {:ok, %{title: title}} =
               Presenter.character_profile_candidate(payload, target, [target])

      assert title == "沈 砚（别名：沈\u00a0先生、老 沈；身份：灯楼 查账人；当前：群像视角） · 叙事身份修订"
      assert payload.character_name == " \t沈  砚\r\n"
      assert target.aliases == ["老  沈", "\t老 沈  ", "\n", "沈\u00a0先生"]
      assert target.role == " 灯楼\t\n查账人 "
      assert payload.other_character_changes == []
    end

    test "空白排版和重复别名不能使页面上相同身份变为可辨认" do
      target = role_target("character:first", "沈 砚", ["老 沈"], "灯楼 查账人", "PROTAGONIST")

      other =
        role_target(
          "character:second",
          " \t沈  砚\n",
          [" 老\t沈 ", "老 沈", " \r\n"],
          "\r灯楼  查账人\t",
          "PROTAGONIST"
        )

      for roster <- [[target, other], [other, target]] do
        assert {:error, :display_identity_ambiguous} =
                 Presenter.character_profile_no_change(role_no_change(target), target, roster)
      end

      candidate_target = %{target | narrative_role: "ENSEMBLE_POV"}
      candidate_other = %{other | narrative_role: "ENSEMBLE_POV"}

      assert {:error, :display_identity_ambiguous} =
               Presenter.character_profile_candidate(
                 role_payload(candidate_target),
                 candidate_target,
                 [candidate_other, candidate_target]
               )
    end

    test "两次读取即使投影相同也必须保持全部原始事实一致" do
      target = role_target("character:actual", "沈 砚", ["老 沈"], "灯楼 查账人", "ENSEMBLE_POV")

      for changed <- [
            %{target | name: "沈  砚"},
            %{target | aliases: [" 老 沈 "]},
            %{target | role: "灯楼\t查账人"},
            %{target | summary: "读取期间变更的隐藏摘要"},
            %{target | updated_at: "2026-11-21"},
            %{target | base_fingerprint: "changed-fingerprint"}
          ] do
        assert {:error, :stale_base} =
                 Presenter.character_profile_candidate(role_payload(target), target, [changed])
      end
    end

    test "精确 ref 缺失或多次出现拒绝绑定，不能以同名同别名替代" do
      target = role_target("character:actual", "沈砚", ["老沈"], "查账人", "ENSEMBLE_POV")
      impostor = %{target | character_ref: "character:other"}

      assert {:error, :display_target_missing} =
               Presenter.character_profile_candidate(role_payload(target), target, [impostor])

      assert {:error, :display_identity_ambiguous} =
               Presenter.character_profile_candidate(role_payload(target), target, [
                 target,
                 target
               ])

      changed = %{target | role: "作者刚改过的身份", base_fingerprint: "new-fingerprint"}

      assert {:error, :stale_base} =
               Presenter.character_profile_candidate(role_payload(target), target, [changed])
    end

    test "其他角色建议也逐项按 ref 绑定并核对旧身份，不能借相同姓名补材料" do
      target = role_target("character:target", "沈砚", ["老沈"], "查账人", "ENSEMBLE_POV")
      other = role_target("character:other", "顾青", [], "巡夜人", "PROTAGONIST")
      payload = role_payload(target, [other])
      impostor = %{other | character_ref: "character:impostor"}

      assert {:error, :display_target_missing} =
               Presenter.character_profile_candidate(payload, target, [target, impostor])

      changed = %{other | narrative_role: "SUPPORTING"}

      assert {:error, :stale_base} =
               Presenter.character_profile_candidate(payload, target, [target, changed])

      duplicate = %{other | character_ref: "character:duplicate"}

      assert {:error, :display_identity_ambiguous} =
               Presenter.character_profile_candidate(payload, target, [target, other, duplicate])
    end
  end

  defp role_target(ref, name, aliases, role, narrative_role) do
    %{
      character_ref: ref,
      name: name,
      aliases: aliases,
      role: role,
      narrative_role: narrative_role,
      summary: "隐藏摘要",
      base_fingerprint: "original-fingerprint",
      status: "ACCEPTED",
      updated_at: "2026-11-20"
    }
  end

  defp role_payload(target, others \\ []) do
    %{
      character_ref: target.character_ref,
      character_name: target.name,
      base_fingerprint: target.base_fingerprint,
      changes: [%{field: "narrative_role", old: target.narrative_role, new: "PROTAGONIST"}],
      other_character_changes: [],
      suggested_other_character_changes:
        Enum.map(others, fn other ->
          %{
            character_ref: other.character_ref,
            character_name: other.name,
            current_narrative_role: other.narrative_role
          }
        end)
    }
  end

  defp role_no_change(target) do
    %{
      character_ref: target.character_ref,
      character_name: target.name,
      old_role: target.narrative_role,
      desired_role: target.narrative_role
    }
  end

  describe "Registry（完整性诊断，只读）" do
    test "判断协议全部工具 code 均已登记作者显示名" do
      codes = Registry.judgment_tool_codes()

      assert "judgment_decision" in codes
      assert "ask_author" in codes
      assert "report_capability_gap" in codes
      assert Registry.missing_tool_displays() == []
    end
  end
end
