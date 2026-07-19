defmodule NovelDomain.ChapterSummarySectionsTest do
  use ExUnit.Case, async: true

  alias NovelDomain.ChapterSummary

  # M0 六跑 live 真实产出样本（gpt-oss-120b，狗粮库 ACCEPTED 记录）——四栏格式
  # 遵守率的回归钉。
  @live_sample """
【情节推进】林烨与影织者在实验舱内将残诀卷轴解码并同步至核心模块，通过调频仪和自动装配机生成可调用的筑基协议包，成功向城郊第七层散修营地广播能量信号，实现底层共享；随后监控提示首批受试者出现非线性异常，二人定位异常节点并准备追踪。
【人物状态与弧光】林烨从窃取者转为分发者，表现出冷静的技术掌控和对自由灵气的执念；影织者则以精准操作支持计划，两人都感受到使命重量，林眉头紧锁但坚定迈向更大行动。
【伏笔动作】协议包标记“共享层级：底层”暗示后续散修广泛接入；异常红字与被截断的信号节点预示潜在反制或未知危机；林将协议芯片植入胸甲，可能成为后续追踪或自我强化的关键。
【情绪基调】紧张而充满希望的科技仪式感交织，伴随成功的激动与突现异常的隐忧，整体氛围在突破束缚的喜悦中掺杂着对未知后果的警惕。
"""

  test "render/parse 往返稳定（四栏 map ↔ canonical 文本）" do
    sections = %{
      plot: "主角解码残诀并广播协议",
      characters: "从窃取者转为分发者",
      foreshadowing: "受试者出现非线性异常",
      mood: "使命感与不安并存"
    }

    text = ChapterSummary.render_sections(sections)
    assert ChapterSummary.four_column?(text)
    assert ChapterSummary.parse_sections(text) == sections
  end

  test "缺栏诚实：占位「（无）」还原为缺席，不伪造维度" do
    text = ChapterSummary.render_sections(%{plot: "只有情节"})
    assert ChapterSummary.four_column?(text)
    assert ChapterSummary.parse_sections(text) == %{plot: "只有情节"}
  end

  test "无标签整段归 plot（与生成侧兜底同语义）；空文本空 map" do
    assert ChapterSummary.parse_sections("一段没有标签的摘要。") == %{plot: "一段没有标签的摘要。"}
    assert ChapterSummary.parse_sections("   ") == %{}
    assert ChapterSummary.parse_sections(nil) == %{}
  end

  test "live 真实样本解析出全部四栏（M1 六跑实证钉）" do
    sections = ChapterSummary.parse_sections(@live_sample)
    assert map_size(sections) == 4
    assert sections.plot =~ "林烨"
    assert Map.has_key?(sections, :foreshadowing)
    assert Map.has_key?(sections, :mood)
  end
end
