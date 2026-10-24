defmodule NovelApplication.AuxTaskBuilder do
  @moduledoc """
  B27 CP3c：辅助/系统域专业调用的 `AuthoringTask` 组装（application 侧）。

  职责边界（B27 §3.1 + CP3 设计冻结）：
  - 只把**真实业务事实**（材料种类/版本/完整度、对象 ref、上一轮真实结果、输出契约）
    组装成 `NovelCommon.Contracts.AuthoringTask`；规则句唯一真源是
    `NovelCommon.AuthoringSemantics`，本模块不写规则文本、不猜作者意图；
  - 复用 `NovelApplication.AuthoringTaskBuilder` 的 generic helper（new/material/scope/
    prior_result/output_contract），组装后由 `AuthoringSemantics.validate/1` 机械校验；
  - 与 prose 域（writer/revision/evaluator）的 builder 分离，避免写冲突。

  映射：
  - chapter_summary → kind `:chapter_summary`、effect `:narrate`
  - fact_inventory  → kind `:fact_inventory`、effect `:extract_facts`
  - ledger_reconcile→ kind `:ledger_reconcile`、effect `:reconcile`
  - result_narration→ kind `:result_narration`、effect `:narrate`
  """

  alias NovelApplication.AuthoringTaskBuilder
  alias NovelCommon.Contracts.AuthoringTask

  @contracts %{
    chapter_summary: [
      schema_ref: "chapter_summary_v1",
      required_keys: ["plot", "characters", "foreshadowing", "mood"],
      allow_companions: false
    ],
    fact_inventory: [
      schema_ref: "fact_inventory_v1",
      required_keys: ["artifact_type", "item_id", "title", "body", "rationale"],
      allow_companions: false
    ],
    ledger_reconcile: [
      schema_ref: "ledger_reconciliation_v1",
      required_keys: ["findings"],
      allow_companions: false
    ],
    result_narration: [
      schema_ref: "tool_result_narration_v1",
      required_keys: [],
      allow_companions: false
    ]
  }

  @doc """
  章摘要任务：材料范围由真实来源决定（`attrs[:material_scope]` = `:fragment | :chapter`）。

  - 主采纳路径只有本次采纳片段 → `:fragment`：`complete?: false` + omission note，
    禁止把片段冒充整章；
  - 断供补做/修复路径拿到整章已采纳正文 → `:chapter`。
  """
  @spec for_chapter_summary(map()) :: {:ok, AuthoringTask.t()} | {:error, term()}
  def for_chapter_summary(attrs) when is_map(attrs) do
    chapter_id = text(attrs[:chapter_id] || attrs["chapter_id"])
    ref = text(attrs[:chapter_ref]) |> blank_or("chapter:#{chapter_id}")
    scope_kind = attrs[:material_scope] || attrs["material_scope"] || :fragment
    complete? = scope_kind == :chapter
    source_ref = blank_to_nil(text(attrs[:source_ref]))
    revision_base = blank_to_nil(text(attrs[:revision_base] || attrs[:version]))

    AuthoringTaskBuilder.new(:chapter_summary, %{
      author_goal: blank_to_nil(text(attrs[:author_goal])),
      author_words: blank_to_nil(text(attrs[:author_words])),
      scope:
        AuthoringTaskBuilder.scope([ref],
          object_kind: :chapter,
          coverage: if(complete?, do: :chapter, else: :single),
          target_chapter_ref: ref
        ),
      materials: [
        AuthoringTaskBuilder.material(:chapter_prose, ref,
          version: revision_base,
          complete?: complete?,
          omission_note:
            if(complete?,
              do: nil,
              else: "本次材料为单次采纳片段，不是整章已采纳正文"
            )
        )
      ],
      source_refs: string_list([source_ref, ref]),
      output_contract: contract(:chapter_summary)
    })
  end

  @doc """
  设定盘点任务：材料来自真实章材料读端口。

  `attrs[:materials]` 每项 `%{seq, title, prose, kind, version, truncated}`；`kind`
  = `:chapter_summary | :chapter_prose`。摘要材料映射为契约接受的 `:prose` kind，
  精确来源类型在 material_text 渲染层显式标注；截断/摘要 omission 如实写进材料。
  """
  @spec for_fact_inventory(map()) :: {:ok, AuthoringTask.t()} | {:error, term()}
  def for_fact_inventory(attrs) when is_map(attrs) do
    materials =
      attrs
      |> map_get(:materials)
      |> List.wrap()
      |> Enum.with_index(1)
      |> Enum.map(fn {raw, index} -> inventory_material(raw, index) end)

    work_ref = "work:#{text(attrs[:work_id] || attrs["work_id"])}"

    AuthoringTaskBuilder.new(:fact_inventory, %{
      author_goal: blank_to_nil(text(attrs[:author_goal])),
      author_words: blank_to_nil(text(attrs[:author_words])),
      scope: AuthoringTaskBuilder.scope([work_ref], object_kind: :work, coverage: :multi),
      materials: materials,
      source_refs: string_list([work_ref]),
      output_contract: contract(:fact_inventory)
    })
  end

  @doc "全书对账任务（机械规则，无模型渲染；task 用于来源/范围/输出契约留痕与校验）。"
  @spec for_ledger_reconcile(map()) :: {:ok, AuthoringTask.t()} | {:error, term()}
  def for_ledger_reconcile(attrs) when is_map(attrs) do
    work_id = text(attrs[:work_id] || attrs["work_id"])
    work_ref = "work:#{work_id}"
    trigger = attrs[:trigger] || attrs["trigger"] || :manual
    scanned_at_seq = blank_to_nil(text(attrs[:scanned_at_seq]))

    materials =
      if attrs[:include_ledger_snapshot] == false do
        []
      else
        [
          AuthoringTaskBuilder.material(:ledger_snapshot, "ledger:#{work_id}",
            version: scanned_at_seq
          )
        ]
      end

    AuthoringTaskBuilder.new(:ledger_reconcile, %{
      author_goal: blank_to_nil(text(attrs[:author_goal])),
      author_words: blank_to_nil(text(attrs[:author_words])),
      scope: AuthoringTaskBuilder.scope([work_ref], object_kind: :ledger, coverage: :multi),
      materials: materials,
      source_refs: string_list([work_ref, "ledger_trigger:#{trigger}"]),
      output_contract: contract(:ledger_reconcile)
    })
  end

  @doc "工具结果叙述任务：携带真实作者目标、工具实际后果与失败/边界信息。"
  @spec for_result_narration(map()) :: {:ok, AuthoringTask.t()} | {:error, term()}
  def for_result_narration(attrs) when is_map(attrs) do
    tool_name = blank_to_nil(text(attrs[:tool_name]))
    artifact_refs = string_list(attrs[:artifact_refs])
    tool_ref = if tool_name, do: "tool:#{tool_name}", else: nil

    AuthoringTaskBuilder.new(:result_narration, %{
      author_goal: blank_to_nil(text(attrs[:author_goal])),
      author_words: blank_to_nil(text(attrs[:author_words])),
      scope:
        AuthoringTaskBuilder.scope(Enum.reject([tool_ref | artifact_refs], &is_nil/1),
          object_kind: :tool_result,
          coverage: :single
        ),
      materials: [],
      prior_result:
        AuthoringTaskBuilder.prior_result(%{
          run_ref: attrs[:run_ref],
          turn_ref: attrs[:turn_ref],
          status: attrs[:tool_status],
          summary: attrs[:outcome_summary],
          pending_refs: artifact_refs
        }),
      source_refs: string_list([tool_ref, blank_to_nil(text(attrs[:provider_call_ref]))]),
      output_contract: contract(:result_narration)
    })
  end

  # ── helpers ──────────────────────────────────────────────

  defp contract(kind) do
    opts = Map.fetch!(@contracts, kind)
    AuthoringTaskBuilder.output_contract(:json, opts)
  end

  defp inventory_material(raw, index) when is_map(raw) do
    seq = map_get(raw, :seq) || index
    source_kind = map_get(raw, :kind) || :chapter_prose
    truncated = map_get(raw, :truncated) == true

    # 契约 required material 只接受 :prose / :chapter_prose；摘要材料用 :prose。
    contract_kind = if source_kind == :chapter_summary, do: :prose, else: :chapter_prose

    AuthoringTaskBuilder.material(contract_kind, "chapter:#{seq}",
      version: blank_to_nil(text(map_get(raw, :version))),
      complete?: not truncated,
      omission_note: inventory_omission(source_kind, truncated)
    )
  end

  defp inventory_material(raw, index), do: inventory_material(%{seq: index, prose: raw}, index)

  defp inventory_omission(:chapter_summary, _truncated), do: "材料来源：章摘要（非正文全文）"
  defp inventory_omission(_kind, true), do: "正文摘录已截断，未覆盖全章"
  defp inventory_omission(_kind, _truncated), do: nil

  defp map_get(map, key) when is_map(map) do
    Map.get(map, key, Map.get(map, Atom.to_string(key)))
  end

  defp map_get(_map, _key), do: nil

  defp text(nil), do: ""
  defp text(value) when is_binary(value), do: value
  defp text(value), do: to_string(value)

  defp blank_to_nil(value) when is_binary(value) do
    if String.trim(value) == "", do: nil, else: value
  end

  defp blank_to_nil(_value), do: nil

  defp blank_or("", fallback), do: fallback
  defp blank_or(nil, fallback), do: fallback
  defp blank_or(value, _fallback), do: value

  defp string_list(values) when is_list(values) do
    values
    |> Enum.filter(&is_binary/1)
    |> Enum.reject(&(String.trim(&1) == ""))
    |> Enum.uniq()
  end

  defp string_list(_values), do: []
end
