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
