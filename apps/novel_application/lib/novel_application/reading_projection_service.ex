defmodule NovelApplication.ReadingProjectionService do
  @moduledoc """
  Application boundary for AU-08 Reading Mode projections.

  Web callers consume DTOs from this module instead of reading persistence
  schemas directly.
  """

  alias NovelPersistence.ReadingProjectionRepo

  @type toc :: %{work_id: String.t(), volumes: [map()]}
  @type chapter_content :: %{id: String.t(), title: String.t(), scenes: [map()]}

  @spec toc(String.t()) :: toc()
  def toc(work_id) when is_binary(work_id) do
    ReadingProjectionRepo.toc(work_id)
  end

  @spec chapter_content(String.t(), String.t()) :: {:ok, chapter_content()} | {:error, :not_found}
  def chapter_content(chapter_id, work_id)
      when is_binary(chapter_id) and is_binary(work_id) do
    ReadingProjectionRepo.chapter_content(chapter_id, work_id)
  end
end
