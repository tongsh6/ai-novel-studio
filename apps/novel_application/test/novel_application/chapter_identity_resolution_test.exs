defmodule NovelApplication.ChapterIdentityResolutionTest do
  use ExUnit.Case, async: true

  alias NovelApplication.TurnExecutionService
  alias NovelDomain.DialogueContext

  # B25 CP2b：写前目标章身份解析——模型给出的 chapter_ref 优先（同名章唯一可区分），
  # 无 ref 才按 title 唯一命中映射；同名多章不猜（ref nil，采纳层诚实失败）。
  describe "resolve_target_chapter_identity/6" do
    test "action ref 优先：索引 title 纠正模型复制的旧标题，ref 原样返回" do
      chapter_id = "11111111-1111-4111-8111-111111111111"
      chapter_ref = "chapter:#{chapter_id}"

      index_reader = fn _work_id ->
        [%{id: chapter_id, seq: 2, title: "灰烬中的手印（改名后）"}]
      end

      context = %DialogueContext{current_chapters: ["灰烬中的手印（改名后）"]}

      action = %{
        target_chapter: "灰烬中的手印（改名前）",
        target_chapter_ref: chapter_ref,
        authoring_intent: :continuation
      }

      assert %{title: "灰烬中的手印（改名后）", ref: ^chapter_ref} =
               TurnExecutionService.resolve_target_chapter_identity(
                 action,
                 context,
                 nil,
                 index_reader,
                 "work-id",
                 "接着第 2 章继续写"
               )
    end

    test "stale ref（索引无此 id）保留 ref 交给持久层诚实失败，不回退 title 静默写错章" do
      stale_ref = "chapter:99999999-9999-4999-8999-999999999999"

      index_reader = fn _work_id ->
        [%{id: "11111111-1111-4111-8111-111111111111", seq: 1, title: "另一章"}]
      end

      context = %DialogueContext{current_chapters: ["另一章"]}

      action = %{target_chapter: "另一章", target_chapter_ref: stale_ref}

      assert %{title: "另一章", ref: ^stale_ref} =
               TurnExecutionService.resolve_target_chapter_identity(
                 action,
                 context,
                 nil,
                 index_reader,
                 "work-id",
                 "继续写"
               )
    end

    test "无 ref 时按 title 唯一命中映射 ref" do
      chapter_id = "22222222-2222-4222-8222-222222222222"

      index_reader = fn _work_id ->
        [
          %{id: chapter_id, seq: 3, title: "灰烬中的手印"},
          %{id: "33333333-3333-4333-8333-333333333333", seq: 4, title: "另一章"}
        ]
      end

      context = %DialogueContext{current_chapters: ["灰烬中的手印", "另一章"]}
      action = %{target_chapter: "灰烬中的手印"}

      assert %{title: "灰烬中的手印", ref: "chapter:" <> ^chapter_id} =
               TurnExecutionService.resolve_target_chapter_identity(
                 action,
                 context,
                 nil,
                 index_reader,
                 "work-id",
                 "续写灰烬中的手印"
               )
    end

    test "无 ref 且同名多章：ref 为 nil（不猜），title 仍按解析结果返回" do
      index_reader = fn _work_id ->
        [
          %{id: "44444444-4444-4444-8444-444444444444", seq: 2, title: "灰烬中的手印"},
          %{id: "55555555-5555-4555-8555-555555555555", seq: 5, title: "灰烬中的手印"}
        ]
      end

      context = %DialogueContext{current_chapters: ["灰烬中的手印", "灰烬中的手印"]}
      action = %{target_chapter: "灰烬中的手印"}

      assert %{title: "灰烬中的手印", ref: nil} =
               TurnExecutionService.resolve_target_chapter_identity(
                 action,
                 context,
                 nil,
                 index_reader,
                 "work-id",
                 "续写灰烬中的手印"
               )
    end

    test "非法 ref 字符串按无 ref 处理（title 唯一命中仍可映射）" do
      chapter_id = "66666666-6666-4666-8666-666666666666"
      index_reader = fn _work_id -> [%{id: chapter_id, seq: 1, title: "唯一章"}] end
      context = %DialogueContext{current_chapters: ["唯一章"]}

      action = %{target_chapter: "唯一章", target_chapter_ref: "chapter:not-a-uuid"}

      assert %{ref: "chapter:" <> ^chapter_id} =
               TurnExecutionService.resolve_target_chapter_identity(
                 action,
                 context,
                 nil,
                 index_reader,
                 "work-id",
                 "继续写"
               )
    end

    test "读取端口缺失（nil）时保持旧行为：title 解析、ref nil" do
      context = %DialogueContext{current_chapters: ["第01章：开端"]}
      action = %{target_chapter: "第01章：开端"}

      assert %{title: "第01章：开端", ref: nil} =
               TurnExecutionService.resolve_target_chapter_identity(
                 action,
                 context,
                 nil,
                 nil,
                 "work-id",
                 "继续写"
               )
    end
  end
end
