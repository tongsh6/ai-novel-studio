defmodule NovelApplication.AuthorVisible.PresenterTest do
  use ExUnit.Case, async: true

  alias NovelApplication.AuthorVisible.Presenter
  alias NovelApplication.AuthorVisible.Registry
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
    test "测试替身显示作者可读文案，内部 id 只留在调用方字段" do
      status = Presenter.provider_status(:stub, "slice_verify")

      assert status.provider_display_name == "本地模型（测试环境）"
      assert status.model_display_name == "当前模型"
      refute status.provider_display_name =~ "stub"
      refute status.model_display_name =~ "slice_verify"
    end

    test "真实 provider 返回作者名；未知 provider 走兜底" do
      assert Presenter.provider_status(:strata, nil).provider_display_name == "本地模型"
      assert Presenter.provider_status(:unknown_provider, nil).provider_display_name == "当前模型服务"
      assert Presenter.provider_status(:openai, "gpt-4o").model_display_name == "当前模型"
    end
  end

  describe "why_line/1 与 frame_label/1" do
    test "reason code / frame_type 走 SSOT，未知值兜底" do
      assert Presenter.why_line("gates_passed") == "已通过前置检查"
      assert Presenter.why_line("unknown_reason") == "已记录"
      assert Presenter.frame_label("creative_exploration") == "探索"
      assert Presenter.frame_label("unknown_frame") == "创作进展"
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
