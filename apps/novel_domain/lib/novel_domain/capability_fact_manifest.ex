defmodule NovelDomain.CapabilityFactManifest do
  @moduledoc """
  承重事实清单（VS-00G §2.1）：每个创作能力声明其承重事实——08 要素模型在执行层的
  投影视图。纯数据 + 纯判定函数（domain 纪律：无 I/O、无 provider）。

  与 NEM-GAP 表切分：NEM-GAP 是文档级静态负债登记，本清单是运行时逐作品动态判定。
  判定接受"现状快照"（application 机械准备读端口拼装），返回缺失事实清单，供
  `AbsenceDirective` 生成守则文本、`MissingPolicyResult` 归口严重度（design_missing 档）。

  CP1 范围：prose_writing / plot_outline 两能力，主角（E07）一条 required 事实先行；
  其余事实（阵容/骨架/题材锚）随 CP2-CP3 逐条补入 @manifest，不改判定框架。
  """

  @type tier :: :required | :recommended
  @type fact :: %{
          element: atom(),
          element_ref: String.t(),
          tier: tier(),
          absence_directive: atom() | nil
        }
  @type snapshot :: %{optional(:roster) => [map()], optional(atom()) => any()}
  @type missing :: %{element: atom(), element_ref: String.t(), tier: tier(), absence_directive: atom() | nil}

  # 能力 → 承重事实清单。absence_directive=nil 表示该事实缺席只记录不注入守则（契约：
  # required 缺席且有守则才注入；recommended 缺席只记录）。
  @manifest %{
    "prose_writing" => [
      %{element: :protagonist, element_ref: "E07", tier: :required, absence_directive: :protagonist_missing}
    ],
    "plot_outline" => [
      %{element: :protagonist, element_ref: "E07", tier: :required, absence_directive: :protagonist_missing}
    ]
  }

  @doc "能力的承重事实清单（未登记能力返回空）。"
  @spec facts(String.t()) :: [fact()]
  def facts(capability) when is_binary(capability), do: Map.get(@manifest, capability, [])
  def facts(_capability), do: []

  @doc """
  按现状快照评估能力的承重事实缺失。返回缺失事实清单（在场的不返回）。

  纯判定：presence 逐要素机械查现状快照，不问模型（ADR-0025 机械准备判据）。
  """
  @spec evaluate_presence(String.t(), snapshot()) :: [missing()]
  def evaluate_presence(capability, snapshot) when is_binary(capability) and is_map(snapshot) do
    capability
    |> facts()
    |> Enum.reject(&present?(&1.element, snapshot))
    |> Enum.map(&Map.take(&1, [:element, :element_ref, :tier, :absence_directive]))
  end

  def evaluate_presence(_capability, _snapshot), do: []

  # 各要素的在场判定（机械查现状快照）。
  defp present?(:protagonist, %{roster: roster}) when is_list(roster) do
    Enum.any?(roster, fn c -> to_role(c) == "PROTAGONIST" end)
  end

  # 快照缺该要素的数据来源 → 视为无法确认在场 → 缺失（诚实缺席，不假定在场）。
  defp present?(_element, _snapshot), do: false

  defp to_role(character) when is_map(character) do
    character
    |> Map.get(:narrative_role, Map.get(character, "narrative_role"))
    |> case do
      role when is_binary(role) -> role
      _ -> nil
    end
  end

  defp to_role(_character), do: nil
end
