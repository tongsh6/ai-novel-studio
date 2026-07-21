defmodule NovelApplication.WorkArchiveService do
  @moduledoc """
  Application boundary for the work archive panel.

  Web and frontend callers consume DTOs through this module so archive reads
  keep the umbrella dependency direction intact.
  """

  alias NovelPersistence.WorkArchiveRepo

  @spec profile(String.t()) :: map()
  def profile(work_id) when is_binary(work_id), do: WorkArchiveRepo.profile(work_id)

  @spec characters(String.t()) :: [map()]
  def characters(work_id) when is_binary(work_id), do: WorkArchiveRepo.characters(work_id)

  @spec foreshadowing(String.t()) :: [map()]
  def foreshadowing(work_id) when is_binary(work_id), do: WorkArchiveRepo.foreshadowing(work_id)

  @spec rules(String.t()) :: [map()]
  def rules(work_id) when is_binary(work_id), do: WorkArchiveRepo.rules(work_id)

  @spec stats(String.t()) :: map()
  def stats(work_id) when is_binary(work_id), do: WorkArchiveRepo.stats(work_id)

  @spec current_states(String.t()) :: [map()]
  def current_states(work_id) when is_binary(work_id), do: WorkArchiveRepo.current_states(work_id)

  @spec relationships(String.t()) :: [map()]
  def relationships(work_id) when is_binary(work_id), do: WorkArchiveRepo.relationships(work_id)

  @spec preferences(String.t()) :: [map()]
  def preferences(work_id) when is_binary(work_id), do: WorkArchiveRepo.preferences(work_id)

  @doc "五本账进度视图（VS-00F CP1/CP2a：弧光/承诺/信息账）。"
  @spec ledgers(String.t()) :: [map()]
  def ledgers(work_id) when is_binary(work_id),
    do: NovelPersistence.LedgerRepository.list_all(work_id)

  @doc "当前活跃对账报告（TENTATIVE，作者裁决材料；无则 nil。VS-00F CP2b）。"
  @spec latest_reconciliation_report(String.t()) :: map() | nil
  def latest_reconciliation_report(work_id) when is_binary(work_id),
    do: NovelPersistence.ReconciliationReportRepo.latest(work_id)
end
