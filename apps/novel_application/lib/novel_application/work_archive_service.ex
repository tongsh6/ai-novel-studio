defmodule NovelApplication.WorkArchiveService do
  @moduledoc """
  Application boundary for the work archive panel.

  Web and frontend callers consume DTOs through this module so archive reads
  keep the umbrella dependency direction intact.
  """

  alias NovelPersistence.WorkArchiveRepo

  @spec characters(String.t()) :: [map()]
  def characters(work_id) when is_binary(work_id), do: WorkArchiveRepo.characters(work_id)

  @spec foreshadowing(String.t()) :: [map()]
  def foreshadowing(work_id) when is_binary(work_id), do: WorkArchiveRepo.foreshadowing(work_id)

  @spec rules(String.t()) :: [map()]
  def rules(work_id) when is_binary(work_id), do: WorkArchiveRepo.rules(work_id)

  @spec stats(String.t()) :: map()
  def stats(work_id) when is_binary(work_id), do: WorkArchiveRepo.stats(work_id)
end
