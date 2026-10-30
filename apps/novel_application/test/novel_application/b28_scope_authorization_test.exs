defmodule NovelApplication.B28ScopeAuthorizationTest do
  use ExUnit.Case, async: true

  alias NovelApplication.ChapterRevisionScope

  # B28 CP1：scope 表达“作者授权修改的范围”，材料读取不等于修改授权；
  # 否定/局部限制/条件不得被词面扩大；只读拒绝不得生成整章候选。
  @matrix [
    # 否定整章 + 局部限制：局部限制优先，不扩为整章
    {"不要整章重写，只改第一段。", {:ok, :target_segments}},
    # 通读/全文是材料读取，不是修改授权；局部限制仍生效
    {"通读全文后只修第二段。", {:ok, :target_segments}},
    # 只读检查 + 明确不改：不授权任何修改
    {"整章检查一遍，有问题告诉我，别改。", {:error, :author_scope_not_authorized}},
    {"只读一遍第03章，不要改。", {:error, :author_scope_not_authorized}},
    # 条件性整章：条件未判定前保守为局部，不自动授整章
    {"如果第03章有明显问题就整章改一遍，没有问题就告诉我。", {:ok, :target_segments}},
    # 正向整章授权
    {"把第03章整章重写一遍，情节不变。", {:ok, :whole_chapter}},
    {"通读全文后整章润色，保留所有情节。", {:ok, :whole_chapter}},
    {"请通读整章并修订第一章正文。", {:ok, :whole_chapter}},
    # 仅排版正向限制（既有契约保留）
    {"只调整第03章分段和排版，不要改字句。", {:ok, :format_only}},
    {"把第一章正文整理一下，只调整分段和排版，别改字句。", {:ok, :format_only}},
    # 局部授权 / 字面替换默认局部
    {"把第03章第一段改得更紧张，其他段落别动。", {:ok, :target_segments}},
    {"把已保存的第一章正文里的年龄改一下，二十五岁改成三十岁，其余逐字不变。", {:ok, :target_segments}},
    # 否定“仅排版”不是排版授权
    {"不是仅排版，需要修改第二段里的指定句子。", {:ok, :target_segments}}
  ]

  test "authorize/1 矩阵：否定/条件/读取/局部/正向授权" do
    for {text, expected} <- @matrix do
      assert ChapterRevisionScope.authorize(text) == expected, "input=#{text}"
    end
  end

  test "空文本/纯读取保守不授权整章" do
    assert ChapterRevisionScope.authorize("") == {:ok, :target_segments}
    assert ChapterRevisionScope.authorize(nil) == {:ok, :target_segments}
    assert ChapterRevisionScope.authorize("把这一章读一遍。") == {:ok, :target_segments}
  end

  test "否定整章但无局部限制 → 不授整章（保守局部，交由目标解析/澄清处理）" do
    assert ChapterRevisionScope.authorize("不要整章重写。") == {:ok, :target_segments}
  end
end
