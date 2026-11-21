defmodule NovelApplication.B30ExplorationSeqTest do
  use ExUnit.Case, async: false

  alias Ecto.Adapters.SQL.Sandbox
  alias NovelApplication.{AuthoringTranscript, ExplorationService, JudgmentProtocol, WorkService}
  alias NovelCommon.RequestIR
  alias NovelCommon.RequestIR.Projection
  alias NovelFoundation.Enums.AdoptionStatus
  alias NovelPersistence.{AdoptionRepository, ReadingProjectionRepo, Repo}
  alias NovelPersistence.Schemas.{Chapter, Draft, Scene, Volume}

  setup do
    :ok = Sandbox.checkout(Repo)
    :ok
  end

  test "重编号后 chapter_read 按当前 seq 解析；旧 seq 不再静默命中；TOC 按新 seq 排序" do
    {:ok, work} = WorkService.create(%{"title" => "B30 探索"})
    volume = Repo.insert!(%Volume{work_id: work.id, title: "第二卷", seq: 2})

    chapters =
      for {title, seq, prose} <- [{"旧第十一章", 11, "井底传来的灯油味。"}, {"旧第十二章", 12, "账册上记着旧名。"}] do
        c = Repo.insert!(%Chapter{work_id: work.id, volume_id: volume.id, title: title, seq: seq})
        s = Repo.insert!(%Scene{work_id: work.id, chapter_id: c.id, title: "场景 1", seq: 1})

        Repo.insert!(%Draft{
          work_id: work.id,
          scene_id: s.id,
          content: prose,
          status: AdoptionStatus.accepted(),
          revision: 1
        })

        c
      end

    [c1, c2] = chapters

    assert {:ok, _} =
             AdoptionRepository.renumber_chapters(
               work.id,
               [%{"chapter_ref" => "chapter:#{c1.id}", "new_seq" => 3}],
               [%{"chapter_ref" => "chapter:#{c1.id}", "expected_seq" => 11}]
             )

    # TOC 按当前 seq 排序
    toc = ReadingProjectionRepo.toc(work.id)
    chapter_seqs = toc.volumes |> Enum.flat_map(& &1.chapters) |> Enum.map(& &1.seq)
    assert chapter_seqs == [3, 12]

    # 新 seq 命中同一章；旧 seq 11 不再命中（不静默错位）
    assert {:ok, new_obs} =
             ExplorationService.run(
               work.id,
               "chapter_read",
               Jason.encode!(%{"chapter_seq" => 3, "offset" => 0}),
               "session-b30"
             )

    assert new_obs.refs == ["chapter:#{c1.id}"]
    assert new_obs.summary =~ "灯油"

    assert {:ok, old_obs} =
             ExplorationService.run(
               work.id,
               "chapter_read",
               Jason.encode!(%{"chapter_seq" => 11, "offset" => 0}),
               "session-b30"
             )

    assert old_obs.summary =~ "没有找到"
    assert old_obs.refs == []

    # prose_search 展示当前 seq（ref 保持同一章身份）
    assert {:ok, search_obs} =
             ExplorationService.run(work.id, "prose_search", "灯油", "session-b30")

    # prose_search 展示当前章节标题（ref 同源；不嵌 seq，无旧编号展示路径）
    assert search_obs.summary =~ "旧第十一章"
    assert Enum.any?(search_obs.refs, &(&1 == "chapter:#{c1.id}"))
    assert is_binary(c2.id)
  end

  test "同名章歧义保留结构候选与真实引用，目录和续读请求不从summary解析身份" do
    {work_id, first_id} = seed_work_with_chapter("午夜来电", "第一章独有正文", seq: 1)

    {^work_id, second_id} =
      seed_work_with_chapter("午夜来电", "第二章独有正文", work_id: work_id, seq: 2)

    expected = [
      %{ref: "chapter:#{first_id}", seq: 1, title: "午夜来电", has_prose: true},
      %{ref: "chapter:#{second_id}", seq: 2, title: "午夜来电", has_prose: true}
    ]

    assert {:ok, ambiguous} = ExplorationService.run(work_id, "chapter_read", "午夜来电")
    assert ambiguous.outcome == :ambiguous_target
    assert ambiguous.facts == %{matched_count: 2, chapters: expected}
    assert ambiguous.refs == Enum.map(expected, & &1.ref)
    assert ambiguous.summary =~ "存在歧义"
    refute ambiguous.summary =~ "chapter:"
    refute ambiguous.summary =~ "chapter_ref"
    refute ambiguous.summary =~ "{"
    refute ambiguous.summary =~ "【正文】第"
    refute ambiguous.activity_summary =~ "chapter:"

    assert {:ok, partial} = ExplorationService.run(work_id, "chapter_read", "来电")
    assert partial.outcome == :ambiguous_target
    assert partial.facts.chapters == expected

    selected = Enum.at(ambiguous.facts.chapters, 1)

    assert {:ok, detail} =
             ExplorationService.run(
               work_id,
               "chapter_read",
               Jason.encode!(%{chapter_ref: selected.ref, offset: 0})
             )

    assert detail.refs == ["chapter:#{second_id}"]
    assert detail.summary =~ "第二章独有正文"
    refute detail.summary =~ "第一章独有正文"

    candidate_payload = projected_observation(work_id, ambiguous)
    assert candidate_payload["source_refs"] == Enum.map(expected, & &1.ref)

    assert candidate_payload["content"]["facts"]["chapters"] ==
             Jason.decode!(Jason.encode!(expected))

    assert candidate_payload["content"]["summary"] == ambiguous.summary

    assert {:ok, directory} = ExplorationService.run(work_id, "archive_read", "chapters")
    directory_payload = projected_observation(work_id, directory)
    expected_directory = Enum.map(expected, &Map.put(&1, :volume, "卷一"))
    assert directory_payload["source_refs"] == Enum.map(expected, & &1.ref)
    assert directory_payload["coverage"]["kind"] == "directory"

    assert directory_payload["content"]["facts"]["chapters"] ==
             Jason.decode!(Jason.encode!(expected_directory))

    refute directory_payload["content"]["summary"] =~ "chapter:"
    refute directory_payload["content"]["summary"] =~ "{"

    {^work_id, third_id} =
      seed_work_with_chapter("午夜来电·终章", "第三章独有正文", work_id: work_id, seq: 3)

    assert {:ok, exact} = ExplorationService.run(work_id, "chapter_read", "午夜来电·终章")
    assert exact.refs == ["chapter:#{third_id}"]
  end

  test "未找到章时结构索引保留真实ref、当前seq和原始标题，不在自然说明混入身份" do
    title = "第11章：外门名册上的空白"
    {work_id, chapter_id} = seed_work_with_chapter(title, long_prose(200), seq: 2)

    assert {:ok, miss} = ExplorationService.run(work_id, "chapter_read", "不存在的章名")

    assert miss.facts == %{
             chapter_count: 1,
             chapters: [%{ref: "chapter:#{chapter_id}", seq: 2, title: title, has_prose: true}]
           }

    assert miss.summary =~ "没有找到"
    refute miss.summary =~ "chapter:"
    refute miss.summary =~ "chapter_ref"
    refute miss.summary =~ "{"
    refute miss.activity_summary =~ "chapter:"
  end

  test "错误候选保留原1500材料预算，裁减不改变全量歧义结论或授予正文资格" do
    {:ok, work} = WorkService.create(%{"title" => "候选预算"})
    volume = Repo.insert!(%Volume{work_id: work.id, title: "卷一", seq: 1})
    chapters = for seq <- 1..40, do: insert_chapter(work.id, volume.id, "同名候选", seq)

    assert {:ok, ambiguous} = ExplorationService.run(work.id, "chapter_read", "同名候选")
    assert ambiguous.outcome == :ambiguous_target
    assert ambiguous.facts.matched_count == 40
    listed = ambiguous.facts.chapters
    assert listed != [] and length(listed) < 40

    assert Enum.map(listed, & &1.ref) ==
             chapters |> Enum.take(length(listed)) |> Enum.map(&"chapter:#{&1.id}")

    assert ambiguous.refs == Enum.map(listed, & &1.ref)
    assert ambiguous.coverage.chapters.status == "partial"
    assert ambiguous.coverage.chapters.returned == length(listed)
    assert ambiguous.coverage.chapters.total == 40
    assert ambiguous.omissions != []

    assert String.length(Jason.encode!(%{summary: ambiguous.summary, facts: ambiguous.facts})) <=
             1500

    assert {:ok, missing} = ExplorationService.run(work.id, "chapter_read", "没有这个章名")
    assert missing.outcome == :target_not_found
    assert missing.facts.chapter_count == 40
    assert missing.refs == []
    assert missing.coverage.chapters.status == "partial"
    assert missing.omissions != []
    assert String.length(Jason.encode!(%{summary: missing.summary, facts: missing.facts})) <= 1500

    query = ambiguous.coverage.chapters.read_query
    assert Jason.decode!(query) == %{"facet" => "chapters", "offset" => 0}
    assert {:ok, directory} = ExplorationService.run(work.id, "archive_read", query)
    assert length(directory.facts.chapters) > length(listed)
    assert Enum.all?(directory.facts.chapters, &(&1.has_prose == false))
  end

  test "单条标题转义后超出索引预算时不截断身份，零候选仍保留歧义与真实目录入口" do
    {:ok, work} = WorkService.create(%{"title" => "长标题预算"})
    volume = Repo.insert!(%Volume{work_id: work.id, title: "卷一", seq: 1})
    title = String.duplicate(<<1>>, 250)
    first = insert_chapter(work.id, volume.id, title, 1)
    second = insert_chapter(work.id, volume.id, title, 2)

    assert {:ok, ambiguous} = ExplorationService.run(work.id, "chapter_read", title)
    assert ambiguous.outcome == :ambiguous_target
    assert ambiguous.facts == %{matched_count: 2, chapters: []}
    assert ambiguous.refs == []
    assert ambiguous.coverage.chapters.status == "partial"
    assert ambiguous.coverage.chapters.returned == 0
    assert ambiguous.coverage.chapters.total == 2
    assert ambiguous.omissions != []

    assert String.length(Jason.encode!(%{summary: ambiguous.summary, facts: ambiguous.facts})) <=
             1500

    assert {:ok, directory} =
             ExplorationService.run(
               work.id,
               "archive_read",
               ambiguous.coverage.chapters.read_query
             )

    assert Enum.map(directory.facts.chapters, & &1.ref) ==
             ["chapter:#{first.id}", "chapter:#{second.id}"]

    assert Enum.map(directory.facts.chapters, & &1.title) == [title, title]
  end

  defp projected_observation(work_id, observation) do
    author_text = "核对当前作品材料，再决定下一步。"
    call_id = "r06-observation"

    transcript =
      AuthoringTranscript.new(
        %{
          run_id: "r06-projection",
          work_id: work_id,
          workspace_id: "r06-workspace",
          goal: %{text: author_text}
        },
        base_text: "按实际供应的作品材料判断。",
        author_text: author_text,
        author_turn_ref: "author_turn:r06-projection",
        tools: [%{name: observation.tool, description: "读取作品材料", input_schema: %{type: "object"}}]
      )
      |> AuthoringTranscript.append_assistant("", [
        RequestIR.tool_call_block(observation.tool, %{"query" => observation.query}, call_id)
      ])
      |> JudgmentProtocol.observation_transcript(%{tool_call_id: call_id}, observation)

    assert {:ok, ir} = AuthoringTranscript.to_request_ir(transcript)
    assert :ok = RequestIR.validate(ir)
    assert {:ok, body} = Projection.project(ir, "chat_completions")
    [tool] = Enum.filter(body.messages, &(&1.role == "tool"))
    assert tool.tool_call_id == call_id
    assert Enum.any?(body.messages, &(&1 == %{role: "user", content: author_text}))
    Jason.decode!(tool.content) |> Map.fetch!("data")
  end

  defp long_prose(total) do
    base = "灰烬从指缝里漏下去，井底的风把纸灰卷成一条细线，他数着自己的呼吸等回声。"

    String.duplicate(base, div(total, String.length(base)) + 1)
    |> String.slice(0, total)
  end

  defp insert_chapter(work_id, volume_id, title, seq) do
    %Chapter{}
    |> Chapter.changeset(%{
      work_id: work_id,
      volume_id: volume_id,
      title: title,
      seq: seq,
      plan_direction: nil
    })
    |> Repo.insert!()
  end

  defp seed_work_with_chapter(title, prose, opts) do
    work_id =
      case opts[:work_id] do
        nil ->
          {:ok, work} = WorkService.create(%{"title" => "探索读取验证作品"})
          work.id

        work_id ->
          work_id
      end

    volume =
      case Volume |> Repo.all() |> Enum.find(&(&1.work_id == work_id)) do
        nil ->
          %Volume{}
          |> Volume.changeset(%{work_id: work_id, title: "卷一", seq: 1})
          |> Repo.insert!()

        volume ->
          volume
      end

    chapter = insert_chapter(work_id, volume.id, title, opts[:seq] || 1)

    scene =
      %Scene{}
      |> Scene.changeset(%{work_id: work_id, chapter_id: chapter.id, title: "场1", seq: 1})
      |> Repo.insert!()

    %Draft{}
    |> Draft.changeset(%{
      work_id: work_id,
      scene_id: scene.id,
      content: prose,
      status: AdoptionStatus.accepted(),
      revision: 1
    })
    |> Repo.insert!()

    {work_id, chapter.id}
  end
end
