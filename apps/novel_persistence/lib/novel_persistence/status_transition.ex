defmodule NovelPersistence.StatusTransition do
  @moduledoc """
  持久化 changeset 的状态转换守卫（矩阵策略由调用方注入）。

  - adoption artifact（章摘要等）：注入 `&NovelDomain.AdoptionStatus.transition_allowed?/2`
    （ADR-0019 通用矩阵）；
  - 维护类 artifact（对账报告）：注入 `&NovelDomain.MaintenanceArtifactStatus.transition_allowed?/2`
    （通用矩阵 ∪ 维护类替换）。

  本模块不持有任何矩阵，只做 changeset 形状适配与可解释 error
  （`illegal <kind> transition FROM -> TO`）。新建 struct 的初始态由 schema 默认值
  保证（`TENTATIVE`）；首次以 canon 态落库等价 TENTATIVE→canon 的第二步。
  """

  import Ecto.Changeset, only: [add_error: 3]

  @typedoc "转换合法性策略：from/to 为已持久化/待写入的 UPPER_SNAKE 状态。"
  @type allowed? :: (String.t(), String.t() -> boolean())

  @doc """
  校验 changeset 的状态变更是否合法。

  `field` 为目标字段（如 `:status` / `:adoption_status`），`attrs` 为本次 cast
  的原始输入（可含 string/atom key），`opts` 必含 `:allowed?`（合法性策略）
  与 `:kind`（error 文案中的领域名，如 `"adoption"` / `"maintenance"`）。
  同态写入视为合法 no-op；任一态缺席不校验。
  """
  @spec validate(Ecto.Changeset.t(), atom(), map(), keyword()) :: Ecto.Changeset.t()
  def validate(%Ecto.Changeset{data: data} = changeset, field, attrs, opts)
      when is_atom(field) and is_map(attrs) and is_list(opts) do
    allowed? = Keyword.fetch!(opts, :allowed?)
    kind = Keyword.fetch!(opts, :kind)
    from = Map.get(data, field)
    to = fetch_attr(attrs, field)

    cond do
      is_nil(from) or is_nil(to) ->
        changeset

      to_string(from) == to_string(to) ->
        changeset

      allowed?.(to_string(from), to_string(to)) ->
        changeset

      true ->
        add_error(changeset, field, "illegal #{kind} transition #{from} -> #{to}")
    end
  end

  defp fetch_attr(attrs, key),
    do: Map.get(attrs, key) || Map.get(attrs, Atom.to_string(key))
end
