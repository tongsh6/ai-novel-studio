defmodule NovelApplication.ChapterSummaryGenerator do
  @moduledoc """
  章摘要默认生成器（VS-00C CP2.1 / contract §6.3；B27 CP3c 迁移）。

  消费 `NovelCommon.Contracts.AuthoringTask`（kind `:chapter_summary`）：

  - 材料范围/版本/完整度由 application 在 `task.materials` 中如实标注（片段 vs 整章）；
  - 规则文本唯一真源为 `NovelCommon.AuthoringSemantics`（shared/operation/output + dynamic）；
  - 四栏领域标签仍取 `NovelDomain.ChapterSummary`（单一真源，渲染/解析同源）；
  - 这是独立摘要 prompt，不复用、不触碰 prose_writing 的 real.ex 三锚点模板（契约 §6 边界）。

  失败一律返回 `{:error, reason}`，由 maintenance 降级，不抛错。解析不出四栏标签时
  诚实失败，不把整段模型输出或整章原文塞进摘要栏（B27 CP3c / C1 P0）。
  """

  alias NovelAgent.Provider.Execution
  alias NovelCommon.AuthoringSemantics
  alias NovelCommon.Contracts.AuthoringTask
  alias NovelCommon.LogContext
  alias NovelDomain.ChapterSummary

  @doc "从 maintenance 输入生成四栏摘要 map；失败返回 `{:error, reason}`。"
  @spec generate(map()) :: {:ok, map()} | {:error, term()}
  def generate(input) when is_map(input), do: generate(input, nil)

  @doc false
  @spec generate(map(), NovelAgent.Provider.Execution.dependency() | nil) ::
          {:ok, map()} | {:error, term()}
  def generate(input, provider_execution) when is_map(input) do
    prose = input |> Map.get(:prose_text) |> normalize()

    cond do
      prose == "" ->
        {:error, :empty_prose}

      not match?(%AuthoringTask{}, Map.get(input, :task)) ->
        {:error, :authoring_task_missing}

      true ->
        task = Map.fetch!(input, :task)
        prompt = build_prompt(task, prose)

        LogContext.with_step("chapter_summary", fn ->
          prompt
          |> complete(provider_execution)
          |> handle_completion()
        end)
    end
  end

  # 生产走统一 provider execution（purpose :narration）；测试可注入 execution 捕获
  # 真实构造的 prompt（不改变生产路径）。
  defp complete(prompt, nil), do: Execution.complete(prompt, purpose: :narration)

  defp complete(prompt, provider_execution) do
    case Execution.result_fn(provider_execution) do
      result_fn when is_function(result_fn, 1) -> result_fn.(prompt)
      _ -> {:error, :provider_execution_missing}
    end
  end

  # Provider execution 的完成形态只有 `{:ok, %Result{}}` / `{:error, map()}`
  # （Execution.complete/2 契约）。
  defp handle_completion({:ok, %{content: text}}) when is_binary(text),
    do: parse_sections(text)

  defp handle_completion({:error, reason}), do: {:error, reason}

  defp build_prompt(%AuthoringTask{} = task, prose) do
    labels = ChapterSummary.section_labels()

    sections_spec =
      Enum.map_join(ChapterSummary.section_order(), "\n", fn key ->
        "【#{labels[key]}】<这一栏的内容>"
      end)

    """
    本次你承担连续性维护助手的角色。

    #{AuthoringSemantics.render(task)}

    ## 角色输出格式
    严格按以下四栏输出，每栏一行，保留方括号标签；摘要不是全文，不要输出正文原句、
    不要加额外说明。目标 200~400 字。
    #{sections_spec}

    ## 本次材料正文
    已采纳正文：
    #{prose}
    """
    |> String.trim()
  end

  # 按四栏标签解析模型输出；部分栏缺失时保留已解析栏（render 时补「（无）」）。
  # 完全没有任何四栏标签 → 诚实失败，绝不把整段输出/整章原文当摘要。
  defp parse_sections(text) do
    case ChapterSummary.parse_sections(text) do
      sections when map_size(sections) == 0 ->
        {:error, :summary_sections_unparseable}

      sections ->
        if any_section_label?(text),
          do: {:ok, sections},
          else: {:error, :summary_sections_unparseable}
    end
  end

  defp any_section_label?(text) do
    ChapterSummary.section_labels()
    |> Map.values()
    |> Enum.any?(&String.contains?(text, "【#{&1}】"))
  end

  defp normalize(value) when is_binary(value), do: String.trim(value)
  defp normalize(_), do: ""
end
