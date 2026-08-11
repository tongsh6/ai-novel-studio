defmodule NovelApplication.LedgerAdjudicationService do
  @moduledoc """
  对账报告逐项裁决用例（VS-00F §3.3 / ADR-0026，CP2c-1 服务核心）。

  作者对活跃（TENTATIVE）报告的偏离项逐项裁决，处置四枚举：
  - `accept_drift`：知情接受——账面裁决态转移（arc STALLED→DRIFTED /
    promise→BROKEN / information LEAKED→留档），同类信号不再重复报警
    （扫描规则只报机械态）；
  - `dismiss`：误报——不动账面；发 `ledger.dismiss.done` 结构化证据日志
    （33 Experience Engine 的 runtime evidence 形态；Engine 运行时尚未建成
    ——代码盘点 2026-07-21——落地后由其收编本日志族，不在此发明第二套回路）；
  - `revise_design` / `revise_prose`：记录处置并返回 `{:follow_up, ...}`，
    修订生成联动（VS-00E §8 / 设计态修订候选）与作者入口归 CP2c-2。

  裁决是作者动作（actor_ref 必填、留痕 `ledger.adjudicate.done`）；全部条目
  裁决完成后报告转 ACCEPTED（repo 语义）。I-L2：账面裁决态转移只在本用例
  （作者授权路径）发生，机械维护不可达（域层 @adjudication_targets 双保险）。
  """

  require NovelCommon.LogEmit

  alias NovelCommon.LogEmit
  alias NovelDomain.LedgerEntry

  @dispositions ~w(revise_design revise_prose accept_drift dismiss)

  @type input :: %{
          required(:work_id) => String.t(),
          required(:report_id) => String.t(),
          required(:finding_index) => non_neg_integer(),
          required(:disposition) => String.t(),
          required(:actor_ref) => String.t(),
          optional(:note) => String.t() | nil
        }

  @type finding_input :: %{
          required(:work_id) => String.t(),
          required(:report_id) => String.t(),
          required(:finding_index) => non_neg_integer()
        }

  @type deps :: %{
          required(:report_repo) => %{
            required(:get) => (String.t(), String.t() -> map() | nil),
            required(:update_findings) => (String.t(), String.t(), [map()] ->
                                             {:ok, map()} | {:error, term()})
          },
          required(:ledger_repo) => %{
            required(:list) => (String.t() -> [map()]),
            required(:upsert) => (map() -> {:ok, map()} | {:error, term()})
          }
        }

  @spec adjudicate(input(), deps()) ::
          {:ok, map()} | {:follow_up, atom(), map()} | {:error, term()}
  def adjudicate(input, deps) do
    with :ok <- validate(input),
         {:ok, %{report: report, finding: finding}} <-
           active_finding(Map.take(input, [:work_id, :report_id, :finding_index]), deps),
         {:ok, effect} <- apply_disposition(input, finding, deps),
         {:ok, updated_report} <- record_disposition(input, report, deps) do
      LogEmit.emit(:ledger, :adjudicate, :done, %{
        work_id: input.work_id,
        report_id: input.report_id,
        finding_index: input.finding_index,
        rule: finding["rule"],
        disposition: input.disposition,
        actor_ref: input.actor_ref,
        report_status: updated_report.adoption_status
      })

      case effect do
        {:follow_up, kind} -> {:follow_up, kind, %{report: updated_report, finding: finding}}
        :applied -> {:ok, %{report: updated_report, finding: finding}}
      end
    end
  end

  @doc """
  读取仍可处置的报告条目，不产生副作用。

  finding 触发其它作者动作时先用本入口绑定真实报告与真实规则，避免客户端仅凭
  `rule` 文本发起不相干的后续运行。
  """
  @spec active_finding(finding_input(), deps()) ::
          {:ok, %{report: map(), finding: map()}} | {:error, term()}
  def active_finding(input, deps) do
    with :ok <- validate_finding_input(input),
         report when is_map(report) <-
           deps.report_repo.get.(input.work_id, input.report_id) || {:error, :report_not_found},
         :ok <- ensure_adjudicable(report),
         {:ok, finding} <- fetch_finding(report, input.finding_index),
         :ok <- ensure_not_dispositioned(finding) do
      {:ok, %{report: report, finding: finding}}
    end
  end

  defp validate(%{
         work_id: w,
         report_id: r,
         finding_index: i,
         disposition: d,
         actor_ref: a
       })
       when is_binary(w) and is_binary(r) and is_integer(i) and i >= 0 and is_binary(a) and
              a != "" do
    if d in @dispositions, do: :ok, else: {:error, {:unknown_disposition, d}}
  end

  defp validate(_input), do: {:error, :missing_adjudication_input}

  defp validate_finding_input(%{work_id: work_id, report_id: report_id, finding_index: index})
       when is_binary(work_id) and work_id != "" and is_binary(report_id) and report_id != "" and
              is_integer(index) and index >= 0,
       do: :ok

  defp validate_finding_input(_input), do: {:error, :missing_finding_input}

  defp ensure_adjudicable(%{adoption_status: "TENTATIVE"}), do: :ok
  defp ensure_adjudicable(%{adoption_status: status}), do: {:error, {:report_not_active, status}}

  defp fetch_finding(report, index) do
    case Enum.at(report.findings, index) do
      nil -> {:error, {:finding_not_found, index}}
      finding -> {:ok, finding}
    end
  end

  defp ensure_not_dispositioned(finding) do
    case finding["disposition"] do
      value when value in [nil, ""] -> :ok
      value -> {:error, {:already_dispositioned, value}}
    end
  end

  # accept_drift：账面裁决态转移（按账目标态映射）；找不到条目时容忍为仅记录处置
  # （信息账 LEAKED 本就是留档记账，无需转移）。
  defp apply_disposition(%{disposition: "accept_drift"} = input, finding, deps) do
    case finding["entry_ref"] do
      nil ->
        {:ok, :applied}

      entry_ref ->
        entry_map =
          deps.ledger_repo.list.(input.work_id) |> Enum.find(&(&1.id == entry_ref))

        with %{} = found <- entry_map,
             {:ok, entry} <- LedgerEntry.new(found),
             target when is_binary(target) <- accept_drift_target(entry),
             {:ok, adjudicated} <- LedgerEntry.adjudicate(entry, target, Map.get(input, :note)) do
          persist(adjudicated, deps.ledger_repo)
          {:ok, :applied}
        else
          # 无条目/无可转移目标（如信息账 LEAKED 留档）→ 处置照记，账面不动
          nil -> {:ok, :applied}
          {:error, reason} -> {:error, reason}
        end
    end
  end

  defp apply_disposition(%{disposition: "dismiss"} = input, finding, _deps) do
    LogEmit.emit(:ledger, :dismiss, :done, %{
      work_id: input.work_id,
      rule: finding["rule"],
      signal: String.slice(finding["signal"] || "", 0, 120),
      actor_ref: input.actor_ref
    })

    {:ok, :applied}
  end

  defp apply_disposition(%{disposition: "revise_design"}, _finding, _deps),
    do: {:ok, {:follow_up, :revise_design}}

  defp apply_disposition(%{disposition: "revise_prose"}, _finding, _deps),
    do: {:ok, {:follow_up, :revise_prose}}

  defp accept_drift_target(%{ledger: "arc", status: "STALLED"}), do: "DRIFTED"
  defp accept_drift_target(%{ledger: "promise", status: "OPEN"}), do: "BROKEN"
  defp accept_drift_target(%{ledger: "promise", status: "PROGRESSING"}), do: "BROKEN"
  # VS00F 刀④ R9：作者对超期伏笔选「接受走向」= 判已回收/不再追踪，账面收束。
  defp accept_drift_target(%{ledger: "information", status: "HIDDEN"}), do: "REVEALED"
  defp accept_drift_target(_entry), do: nil

  defp record_disposition(input, report, deps) do
    findings =
      List.update_at(report.findings, input.finding_index, fn finding ->
        finding
        |> Map.put("disposition", input.disposition)
        |> Map.put("dispositioned_by", input.actor_ref)
        |> Map.put("dispositioned_at", DateTime.utc_now() |> DateTime.to_iso8601())
      end)

    deps.report_repo.update_findings.(input.work_id, input.report_id, findings)
  end

  defp persist(%LedgerEntry{} = entry, ledger_repo) do
    ledger_repo.upsert.(%{
      work_id: entry.work_id,
      ledger: entry.ledger,
      subject_kind: entry.subject_kind,
      subject_ref: entry.subject_ref,
      subject_label: entry.subject_label,
      design_ref: entry.design_ref,
      status: entry.status,
      payload: entry.payload,
      source_refs: entry.source_refs,
      last_event_chapter: entry.last_event_chapter,
      revision: entry.revision
    })
  end

  @doc "生产端口装配。"
  @spec persistence_deps() :: deps()
  def persistence_deps do
    %{
      report_repo: %{
        get: &NovelPersistence.ReconciliationReportRepo.get/2,
        update_findings: &NovelPersistence.ReconciliationReportRepo.update_findings/3
      },
      ledger_repo: %{
        list: &NovelPersistence.LedgerRepository.list_all/1,
        upsert: &NovelPersistence.LedgerRepository.upsert/1
      }
    }
  end
end
