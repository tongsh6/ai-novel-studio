defmodule NovelDomain.AbsenceDirective do
  @moduledoc """
  缺席守则（VS-00G §2.2）：承重事实缺席时注入的**正向文本**（缺席声明+行为约束），
  防真空被模型想象填补——与 OmissionNote（记录"没带什么"）互补而非替代。

  纯数据 + 纯渲染（domain 纪律）。守则文案是**预定义模板**（机械域，不问模型；
  ADR-0025 边界：模型现场生成守则即出机械域，禁止）；归"系统口径文案"层（ui47 §2.3
  第 3 层），UA01 模型口径库落地前集中于此。

  I-G4（缺席不虚构）：守则只声明缺席与行为约束，不含具体设定内容——有内容即该走
  暂用态或盘点提案通道。
  """

  # directive_key → 守则文案（对齐 06 §5.0 absent 守则化升级）。
  @directives %{
    protagonist_missing:
      "本作品尚未确立主角档案：延续既有视角人物写作，不得另立新主角、不得让新角色接管主线。"
  }

  @doc "单条守则文案（未登记 key 返回 nil）。"
  @spec directive(atom()) :: String.t() | nil
  def directive(key) when is_atom(key), do: Map.get(@directives, key)

  @doc """
  从缺失事实清单渲染缺席守则段（多条守则合并；无可渲染守则返回 ""）。

  只渲染带 `absence_directive` 且已登记文案的缺失（required 缺席且有守则）；
  recommended 或无守则的缺失不产文本（契约：只记录不注入）。
  """
  @spec render([map()]) :: String.t()
  def render(missing_facts) when is_list(missing_facts) do
    lines =
      missing_facts
      |> Enum.map(&Map.get(&1, :absence_directive))
      |> Enum.map(&directive/1)
      |> Enum.reject(&is_nil/1)

    case lines do
      [] -> ""
      lines -> "## 承重事实缺席提示（写作须遵循）\n" <> Enum.map_join(lines, "\n", &("- " <> &1))
    end
  end

  def render(_missing_facts), do: ""
end
