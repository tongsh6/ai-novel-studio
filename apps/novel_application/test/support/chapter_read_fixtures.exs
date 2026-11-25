defmodule NovelApplication.TestChapterReadFixtures do
  @moduledoc false

  import ExUnit.Assertions

  alias NovelApplication.{AuthoringTranscript, JudgmentProtocol, WorkService}
  alias NovelCommon.RequestIR
  alias NovelCommon.RequestIR.Projection
  alias NovelFoundation.Enums.AdoptionStatus
  alias NovelPersistence.Repo
  alias NovelPersistence.Schemas.{Chapter, ChapterSummary, Draft, Scene, Volume}

  def projected_observation(work_id, observation) do
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

  def page_body(observation) do
    [_, rest] = String.split(observation.summary, "\n【正文】", parts: 2)
    [_, body] = String.split(rest, "\n", parts: 2)
    body |> String.split("\n【续读】", parts: 2) |> hd()
  end

  def insert_chapter(work_id, volume_id, title, seq, plan_direction \\ nil) do
    %Chapter{}
    |> Chapter.changeset(%{
      work_id: work_id,
      volume_id: volume_id,
      title: title,
      seq: seq,
      plan_direction: plan_direction
    })
    |> Repo.insert!()
  end

  def seed_work_with_chapter(title, prose, opts \\ []) do
    work_id =
      case opts[:work_id] do
        nil ->
          {:ok, work} = WorkService.create(%{"title" => opts[:work_title] || "探索读取验证作品"})
          work.id

        work_id ->
          work_id
      end

    volume =
      if opts[:new_volume] do
        %Volume{}
        |> Volume.changeset(%{
          work_id: work_id,
          title: "卷#{System.unique_integer([:positive])}",
          seq: System.unique_integer([:positive])
        })
        |> Repo.insert!()
      else
        case Volume |> Repo.all() |> Enum.find(&(&1.work_id == work_id)) do
          nil ->
            %Volume{}
            |> Volume.changeset(%{work_id: work_id, title: "卷一", seq: 1})
            |> Repo.insert!()

          volume ->
            volume
        end
      end

    chapter =
      insert_chapter(work_id, volume.id, title, opts[:seq] || 1, opts[:plan_direction])

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

    if summary = opts[:summary] do
      %ChapterSummary{}
      |> ChapterSummary.changeset(%{
        work_id: work_id,
        chapter_id: chapter.id,
        status: AdoptionStatus.accepted(),
        summary_text: summary
      })
      |> Repo.insert!()
    end

    {work_id, chapter.id}
  end
end
