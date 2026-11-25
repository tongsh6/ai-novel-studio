defmodule NovelApplication.ChapterStatisticsContractTest do
  use ExUnit.Case, async: false

  import NovelApplication.TestChapterReadFixtures

  alias Ecto.Adapters.SQL.Sandbox
  alias NovelApplication.{ExplorationService, JudgmentProtocol}
  alias NovelCommon.RequestIR.Projection
  alias NovelPersistence.Repo

  setup do
    :ok = Sandbox.checkout(Repo)
    :ok
  end

  test "R08 作品与章同口径统计，整章有效字数与分页字符数、材料覆盖分离" do
    # 第一章 A、甲、3 三个有效字符；第二章乙、B 两个；第三章只有符号。
    {work_id, chapter_id} = seed_work_with_chapter("统计章", "A 甲，3。")
    {^work_id, _} = seed_work_with_chapter("另一章", "乙 B！", work_id: work_id, seq: 2)
    {^work_id, zero_id} = seed_work_with_chapter("符号章", "……！", work_id: work_id, seq: 3)

    context =
      NovelApplication.ContextAssembler.assemble_for_input(
        work_id,
        "正文有效字数是多少？",
        NovelPersistence.WorkspaceContext.context_fetcher_with_query()
      )

    scope = NovelApplication.DialoguePlanningService.judgment_scope(context)
    stats = scope.facts.work.chapter_statistics
    assert stats.total_effective_word_count == 5
    assert stats.written_chapter_count == 2
    assert stats.empty_chapter_count == 1
    assert scope.coverage.chapter_statistics.status == "complete"
    assert scope.coverage.chapter_prose.status == "not_read"
    refute Map.has_key?(stats, :total_word_count)

    request =
      JudgmentProtocol.request_for_production(
        %{
          author_text: "正文有效字数是多少？",
          scope: scope,
          source_input_ref: "r08-statistics-author",
          supplied_context_refs: ["work:#{work_id}"],
          options: [plan_run: %{run_id: "r08-statistics-request"}]
        },
        :judgment
      )

    for target <- ["chat_completions", "anthropic_messages", "responses_api"] do
      assert {:ok, projected} = Projection.project(request, target)
      wire = Jason.encode!(projected)
      assert wire =~ "total_effective_word_count"
      assert wire =~ stats.word_count_basis
    end

    chapter_ref = "chapter:#{chapter_id}"
    assert {:ok, page} = ExplorationService.run(work_id, "chapter_read", chapter_ref)

    assert page.facts == %{
             prose_chars: 6,
             effective_word_count: 3,
             word_count_basis:
               "sum of per-segment grapheme counts after retaining only Unicode Letter (L) and Number (N) characters"
           }

    assert stats.word_count_basis == page.facts.word_count_basis
    assert page.prose_range == %{start: 1, end: 6}
    assert page.next_offset == nil
    assert page_body(page) == "A 甲，3。"

    assert projected_observation(work_id, page)["content"]["facts"] == %{
             "prose_chars" => 6,
             "effective_word_count" => 3,
             "word_count_basis" =>
               "sum of per-segment grapheme counts after retaining only Unicode Letter (L) and Number (N) characters"
           }

    for {offset, outcome} <- [{6, :end_of_content}, {7, :out_of_range}] do
      assert {:ok, observation} =
               ExplorationService.run(
                 work_id,
                 "chapter_read",
                 Jason.encode!(%{chapter_ref: chapter_ref, offset: offset})
               )

      assert observation.outcome == outcome
      assert observation.facts == page.facts
      refute Map.has_key?(observation, :prose_range)
    end

    assert {:ok, zero} = ExplorationService.run(work_id, "chapter_read", "chapter:#{zero_id}")
    assert zero.outcome == :observed
    assert zero.facts.effective_word_count == 0
    assert zero.facts.prose_chars == 3
    assert page_body(zero) == "……！"

    assert {:ok, missing} = ExplorationService.run(work_id, "chapter_read", "不存在的章")
    assert missing.outcome == :target_not_found
    refute Map.has_key?(missing.facts, :effective_word_count)
    refute Map.has_key?(missing.facts, :prose_chars)
    refute Map.has_key?(missing.facts, :word_count_basis)
  end

  test "R08 分页统计来自整章，而非页面或双 LF 的原始长度" do
    # 5999 个甲、一个标点、一个空格、一个乙：总 6002 字符，6000 有效字。
    {work_id, chapter_id} = seed_work_with_chapter("统计长章", String.duplicate("甲", 5999) <> "， 乙")
    ref = "chapter:#{chapter_id}"
    assert {:ok, first} = ExplorationService.run(work_id, "chapter_read", ref)
    assert first.facts.prose_chars == 6002
    assert first.facts.effective_word_count == 6000
    assert first.next_offset == 6000
    assert first.prose_range == %{start: 1, end: 6000}

    assert {:ok, last} =
             ExplorationService.run(
               work_id,
               "chapter_read",
               Jason.encode!(%{chapter_ref: ref, offset: 6000})
             )

    assert last.facts == first.facts
    assert last.prose_range == %{start: 6001, end: 6002}
    assert last.next_offset == nil
    assert page_body(last) == " 乙"
  end
end
