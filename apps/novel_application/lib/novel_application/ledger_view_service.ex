defmodule NovelApplication.LedgerViewService do
  @moduledoc """
  「脉络」面板读投影 + 裁决入口（VS-00F CP4c / ui43 §5 模块 9 / AU-13）。

  只读投影：五账分组条目 + 最新审读报告；裁决转发 LedgerAdjudicationService
  （作者授权路径，I-L2）。本服务输出内部 canonical 值（arc/STALLED/...），
  用户可见命名（脉络/审读/停滞）统一在前端 copy 层（ui43 §5.0.1）。
  """

  alias NovelApplication.LedgerAdjudicationService

  @ledgers ~w(arc conflict promise information emotion_curve)

  @doc "五账分组条目（面板 L2 进度态列表；空账诚实为空列表，不伪造）。"
  @spec threads(String.t()) :: map()
  def threads(work_id) when is_binary(work_id) do
    entries = NovelPersistence.LedgerRepository.list_all(work_id)

    Map.new(@ledgers, fn ledger ->
      {ledger, entries |> Enum.filter(&(&1.ledger == ledger)) |> Enum.map(&thread_entry/1)}
    end)
  end

  @doc "最新活跃审读报告（面板 L3；无报告返回 nil，诚实缺席）。"
  @spec review_report(String.t()) :: map() | nil
  def review_report(work_id) when is_binary(work_id) do
    NovelPersistence.ReconciliationReportRepo.latest(work_id)
  end

  @doc "逐项裁决（四处置；revise_* 返回 follow_up 供前端回对话流发起修订意图）。"
  @spec adjudicate(map()) :: {:ok, map()} | {:follow_up, atom(), map()} | {:error, term()}
  def adjudicate(input) when is_map(input) do
    LedgerAdjudicationService.adjudicate(input, LedgerAdjudicationService.persistence_deps())
  end

  defp thread_entry(entry) do
    Map.take(entry, [
      :id,
      :ledger,
      :subject_label,
      :subject_ref,
      :status,
      :payload,
      :source_refs,
      :last_event_chapter
    ])
  end
end
