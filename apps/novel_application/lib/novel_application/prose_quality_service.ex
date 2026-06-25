defmodule NovelApplication.ProseQualityService do
  @moduledoc """
  正文生成后的独立质量评估服务（VS-00E CP2）。

  与正文 writer **逻辑分离**：writer 写正文，本服务只读地评估正文是否实现目标，产出
  `QualityFinding` 并汇总 `ProseQualityPolicy`。不修改 artifact / 作品事实（ADR-0020 I2）。

  两类 validator：
  - 确定性（非 LLM）：`ProseQualityValidators`，总是运行。
  - 语义（独立 evaluator，LLM）：通过可注入 `semantic_fn` 解耦——
    `semantic_fn.(prose_text, ctx) :: {:ok, [finding_map]} | {:error, reason}`。
    失败时 `review_status: :unavailable`，**绝不伪造通过**（I3）；确定性发现仍保留。
  无 `semantic_fn` 时为确定性评估，`review_status: :completed`。
  """

  alias NovelApplication.ProseQualityPolicy
  alias NovelApplication.ProseQualityValidators
  alias NovelDomain.QualityFinding

  @type result :: %{
          findings: [QualityFinding.t()],
          review_status: :completed | :unavailable,
          policy: ProseQualityPolicy.t()
        }

  @doc """
  评估正文文本。`ctx`：`%{source_ref, source_turn_ref, source_type}`。
  `opts[:semantic_fn]`：可选语义 evaluator。
  """
  @spec evaluate(String.t() | nil, map(), keyword()) :: result()
  def evaluate(prose_text, ctx \\ %{}, opts \\ []) do
    deterministic = ProseQualityValidators.evaluate(prose_text, ctx)
    {semantic, review_status} = run_semantic(Keyword.get(opts, :semantic_fn), prose_text, ctx)

    findings = deterministic ++ semantic
    policy = ProseQualityPolicy.decide(findings, review_status: review_status)

    %{findings: findings, review_status: review_status, policy: policy}
  end

  defp run_semantic(nil, _text, _ctx), do: {[], :completed}

  defp run_semantic(fun, text, ctx) when is_function(fun, 2) do
    case safe_call(fun, text, ctx) do
      {:ok, finding_maps} when is_list(finding_maps) ->
        findings =
          finding_maps
          |> Enum.map(fn map -> QualityFinding.new(decorate(map, ctx)) end)
          |> Enum.reject(&is_nil/1)

        {findings, :completed}

      _ ->
        # evaluator 失败/非法返回 → 质量复核未完成，不伪造通过
        {[], :unavailable}
    end
  end

  defp run_semantic(_fun, _text, _ctx), do: {[], :completed}

  defp safe_call(fun, text, ctx) do
    fun.(text, ctx)
  rescue
    _ -> {:error, :evaluator_raised}
  catch
    _, _ -> {:error, :evaluator_threw}
  end

  # 语义 evaluator 只给质量判断，溯源字段由服务用 ctx 补齐。
  defp decorate(map, ctx) when is_map(map) do
    map
    |> Map.put_new("source_ref", Map.get(ctx, :source_ref))
    |> Map.put_new("source_turn_ref", Map.get(ctx, :source_turn_ref))
    |> Map.put_new("source_type", Map.get(ctx, :source_type, :prose_fragment))
  end

  defp decorate(map, _ctx), do: map
end
