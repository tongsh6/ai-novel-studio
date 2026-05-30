defmodule NovelDomain.ProseWordCountTest do
  use ExUnit.Case, async: true

  alias NovelDomain.ProseWordCount

  describe "count/1" do
    test "nil 与空串记为 0" do
      assert ProseWordCount.count(nil) == 0
      assert ProseWordCount.count("") == 0
    end

    test "汉字每字计 1" do
      assert ProseWordCount.count("林澈醒来") == 4
    end

    test "标点与空白不计入有效字数" do
      assert ProseWordCount.count("林澈，醒来。") == 4
      assert ProseWordCount.count("林澈 醒来\n再睡") == 6
      assert ProseWordCount.count("“你是谁？”他问道……") == 6
    end

    test "拉丁字母与数字按字符计入" do
      assert ProseWordCount.count("OK") == 2
      assert ProseWordCount.count("第3章") == 3
      assert ProseWordCount.count("a, b. c") == 3
    end

    test "中英混排只数文字本身" do
      assert ProseWordCount.count("AI 写了 100 字。") == 8
    end

    test "纯标点与空白记为 0" do
      assert ProseWordCount.count("，。！？ \n\t——……") == 0
    end
  end

  describe "sum/1" do
    test "汇总多段，nil 记为 0" do
      assert ProseWordCount.sum(["林澈", nil, "醒来。"]) == 4
    end

    test "空列表为 0" do
      assert ProseWordCount.sum([]) == 0
    end
  end
end
