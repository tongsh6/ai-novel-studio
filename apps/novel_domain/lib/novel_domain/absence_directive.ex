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
  #
  # MBC 判例（M5 狗粮，2026-08-25）：protagonist_missing 的「不得另立新主角」是为爱凭空
  # 造角的旧模型族（gpt-oss，M2/M4b 实锤）建的防线；对守指令的模型族（qwen3.8）它在
  # 档案真空时成为死锁令——无名可用又被禁止取名，模型把「主角」当人称写进正文
  # （M3 标本 166 章 0 处 vs M5 41 处）。换模型族后，为旧失败模式建的防线须复验。
  # 真空态（roster 显式为空）换 protagonist_missing_vacuum：翻转为取名指令+事后收账。
  @directives %{
    protagonist_missing:
      "本作品尚未确立主角档案：延续既有视角人物写作，不得另立新主角、不得让新角色接管主线。",
    protagonist_missing_vacuum:
      "本作品尚无任何角色档案：请为出场人物取用稳定的具体名字并全文保持一致，" <>
        "不得用「主角」「反派」这类叙事标签指称人物；人物档案将在写作后提请作者确认。"
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
