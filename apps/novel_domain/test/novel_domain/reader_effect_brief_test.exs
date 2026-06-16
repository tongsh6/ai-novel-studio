defmodule NovelDomain.ReaderEffectBriefTest do
  use ExUnit.Case, async: true

  alias NovelDomain.ReaderEffectBrief

  test "projects reader effect brief from chapter plan direction" do
    brief =
      ReaderEffectBrief.from_plan_direction(%{
        "plot_progress" => "主角进入旧服务器并发现残诀",
        "character_change" => "主角第一次主动冒险",
        "information_release" => "残诀来源指向公司旧实验",
        "foreshadowing_action" => "残诀尾页缺失",
        "emotion" => "紧张中带兴奋",
        "opening_hook" => "红色账单倒计时",
        "ending_hook" => "服务器里传来妹妹声音"
      })

    assert %ReaderEffectBrief{} = brief
    assert brief.intended_emotion == "紧张中带兴奋"
    assert brief.tension_source == "主角进入旧服务器并发现残诀"
    assert brief.payoff_or_promise == "残诀来源指向公司旧实验"
    assert brief.suspense_boundary == "服务器里传来妹妹声音"
    assert brief.hook_target == "红色账单倒计时"
    assert [risk_note] = brief.web_serial_risk_notes
    assert risk_note =~ "self_report.risk_flags"
  end

  test "records missing hook and promise risks instead of fabricating targets" do
    brief = ReaderEffectBrief.from_plan_direction(%{"plot_progress" => "主角进入旧服务器"})

    assert brief.tension_source == "主角进入旧服务器"
    assert brief.intended_emotion == nil
    assert Enum.any?(brief.web_serial_risk_notes, &String.contains?(&1, "情绪定位"))
    assert Enum.any?(brief.web_serial_risk_notes, &String.contains?(&1, "章首拉力"))
    assert Enum.any?(brief.web_serial_risk_notes, &String.contains?(&1, "章尾断章"))
  end

  test "renders prompt lines and storage shape" do
    brief =
      ReaderEffectBrief.from_plan_direction(%{
        "emotion" => "压迫",
        "plot_progress" => "巡检队逼近",
        "information_release" => "矿区账单异常",
        "opening_hook" => "红字账单坠落",
        "ending_hook" => "阵门亮起"
      })

    assert ReaderEffectBrief.to_storage(brief) == %{
             "intended_emotion" => "压迫",
             "tension_source" => "巡检队逼近",
             "payoff_or_promise" => "矿区账单异常",
             "suspense_boundary" => "阵门亮起",
             "hook_target" => "红字账单坠落",
             "web_serial_risk_notes" => [
               "不要削弱章首拉力、章尾断章和本章承诺；无法兑现时必须在 self_report.risk_flags 标出"
             ]
           }

    lines = ReaderEffectBrief.prompt_lines(brief)
    assert Enum.any?(lines, &String.contains?(&1, "ReaderEffectBrief"))
    assert Enum.any?(lines, &String.contains?(&1, "目标情绪：压迫"))
    assert Enum.any?(lines, &String.contains?(&1, "风险约束"))
  end

  test "returns explicit omission line when brief is absent" do
    assert ["- 读者效果：未形成 ReaderEffectBrief" <> _] =
             ReaderEffectBrief.prompt_lines(nil)
  end
end
