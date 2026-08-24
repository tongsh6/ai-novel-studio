defmodule NovelApplication.CarryRegistry do
  @moduledoc """
  携带登记表（CA03 / VS-00C §3.5）：创作调用前「往 prompt 里搬状态」的唯一选取门面。

  四层体系 ②携带层的收敛：每条携带一行登记（id / 三态归类 / 服务哪些调用点 / 载体），
  组装层（`TurnExecutionService`）按登记表决定带不带；块的渲染函数留在原地。

  纪律（与 ADR-0024 决策面注册表同款）：**新增携带必须先在此登记一行**，不入册的
  携带通道视为契约违规。登记表 v1 = 现状快照（CA03 用户拍板：先统一不改行为），
  门的不对称是缺口清单的机器底稿，修补须逐条经作者拍板。

  三分口径（I-C3）：`carried`（真带了）/ `gated`（登记表挡的，设计如此）/
  `empty`（该带但源为空——诚实缺席，不伪造）。`gated` 不冒充 `empty`。
  """

  alias NovelDomain.CapabilityFactManifest

  @type row :: %{
          required(:id) => atom(),
          required(:state) => :design | :realized | :progress | :presence | :session,
          required(:actions) => [String.t()] | :all | :manifest,
          optional(:kind) => :text | :data
        }

  # 顺序即 prompt/装配顺序参照；actions 为现状快照（2026-08-24 盘点），
  # :manifest = 由 CapabilityFactManifest 是否登记该能力决定（VS-00G 语义门）。
  @carriers [
    %{id: :target_structure, state: :design, actions: ["prose_writing"]},
    %{
      id: :character_roster,
      state: :design,
      actions: ["character_design", "character_evolution", "prose_writing", "plot_outline"]
    },
    %{id: :roster_payload, state: :design, actions: ["character_roster"], kind: :data},
    %{id: :prior_summaries, state: :realized, actions: ["prose_writing", "plot_outline"]},
    %{id: :prior_prose, state: :realized, actions: ["prose_writing"]},
    %{id: :creative_facts, state: :realized, actions: ["prose_writing"]},
    %{id: :style_guide, state: :realized, actions: ["prose_writing"]},
    %{id: :work_skeleton, state: :design, actions: ["plot_outline"]},
    %{id: :absence_directives, state: :presence, actions: :manifest},
    %{id: :progress_state, state: :progress, actions: ["prose_writing", "plot_outline"]},
    %{id: :execution_brief, state: :design, actions: ["prose_writing"]},
    %{id: :decision_packet, state: :design, actions: ["prose_writing"], kind: :data},
    %{id: :planning_mission, state: :design, actions: ["plot_outline"]},
    %{id: :dialogue_context, state: :session, actions: :all}
  ]

  @spec rows() :: [row()]
  def rows, do: @carriers

  @spec ids() :: [atom()]
  def ids, do: Enum.map(@carriers, & &1.id)

  @doc "该携带条目是否服务此调用点（唯一的门面判定，I-C2）。"
  @spec carries?(atom(), String.t()) :: boolean()
  def carries?(id, capability) when is_atom(id) and is_binary(capability) do
    case Enum.find(@carriers, &(&1.id == id)) do
      nil -> false
      %{actions: :all} -> true
      %{actions: :manifest} -> CapabilityFactManifest.facts(capability) != []
      %{actions: actions} -> capability in actions
    end
  end

  def carries?(_id, _capability), do: false

  @doc """
  三分报告（纯函数，供 `context.carry.done` 日志）：entries 为登记表顺序的
  `{id, 渲染结果}`；文本载体空串=empty，数据载体 nil/[]=empty。
  """
  @spec carry_report(String.t(), [{atom(), term()}]) :: %{
          carried: [String.t()],
          gated: [String.t()],
          empty: [String.t()]
        }
  def carry_report(capability, entries) when is_binary(capability) and is_list(entries) do
    Enum.reduce(entries, %{carried: [], gated: [], empty: []}, fn {id, value}, acc ->
      cond do
        not carries?(id, capability) -> %{acc | gated: acc.gated ++ [to_string(id)]}
        blank_value?(value) -> %{acc | empty: acc.empty ++ [to_string(id)]}
        true -> %{acc | carried: acc.carried ++ [to_string(id)]}
      end
    end)
  end

  defp blank_value?(nil), do: true
  defp blank_value?(""), do: true
  defp blank_value?([]), do: true
  defp blank_value?(value) when is_binary(value), do: String.trim(value) == ""
  defp blank_value?(%{} = value), do: map_size(value) == 0
  defp blank_value?(_value), do: false
end
