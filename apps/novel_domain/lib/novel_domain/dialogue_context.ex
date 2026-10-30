defmodule NovelDomain.DialogueContext do
  @moduledoc """
  组装好的对话上下文。Planner 只能接收已组装好的 DialogueContext，不能直接访问 Repo。

  规格见 docs/design/contracts/VS-00B-dialogue-context-grounding-contract-pack.md §2。
  """

  alias NovelDomain.AssemblyPolicy
  alias NovelDomain.ContextSourceRef
  alias NovelDomain.OmissionNote

  @type t :: %__MODULE__{
          workspace_id: String.t(),
          current_work_snapshot: map() | nil,
          conversation_summary: String.t() | nil,
          memory_summary: String.t() | nil,
          open_behavior_summary: String.t() | nil,
          interaction_state: map(),
          current_chapters: [String.t()],
          structured_chapters: [map()],
          context_refs: [ContextSourceRef.t()],
          # AU03-CONTEXT：逐来源可用性（:ok | :empty | :unknown | :unavailable）。
          # 兼容旧构造：缺省为空 map，渲染按既有语义（不得把缺失状态误当读取失败）。
          source_status: %{atom() => atom()},
          # 组装策略（CP1，VS-00C §3.4 / `06` §5.3 assembly_policy_ref）：预算是 envelope
          # 一等字段，由 application 按当前 provider 解析后挂上，供创作执行读取。
          assembly_policy: AssemblyPolicy.t() | nil,
          # 省略说明（CP1，VS-00C §3.4 / `06` §5.3 omission_notes）：组装期被省略材料的留痕。
          omission_notes: [OmissionNote.t()],
          assembled_at: String.t()
        }

  defstruct [
    :workspace_id,
    current_work_snapshot: nil,
    conversation_summary: nil,
    memory_summary: nil,
    open_behavior_summary: nil,
    interaction_state: %{},
    current_chapters: [],
    structured_chapters: [],
    context_refs: [],
    source_status: %{},
    assembly_policy: nil,
    omission_notes: [],
    assembled_at: nil
  ]

  defp source_status(%__MODULE__{source_status: status}, key) when is_map(status) do
    Map.get(status, key) || Map.get(status, to_string(key))
  end

  defp source_status(_ctx, _key), do: nil

  defp source_unavailable?(ctx, key) do
    source_status(ctx, key) in [:unavailable, :unknown] or
      source_status(ctx, key) in ["unavailable", "unknown"]
  end

  defp source_label(ctx, key) do
    case source_status(ctx, key) do
      value when value in [:unavailable, "unavailable"] -> "读取失败"
      _ -> "未取得/未知"
    end
  end

  @doc """
  AU03-CONTEXT：author-safe 来源可用性摘要（trace/观测用；只含安全类别，不含原始异常）。

  返回 `%{sources: %{"work" => "unavailable", ...}, unavailable_sources: [...], unknown_sources: [...]}`。
  """
  @spec source_status_summary(t()) :: map()
  def source_status_summary(%__MODULE__{source_status: status}) when is_map(status) do
    sources = Enum.into(status, %{}, fn {key, value} -> {to_string(key), to_string(value)} end)

    %{
      sources: sources,
      unavailable_sources: for({key, value} <- sources, value == "unavailable", do: key),
      unknown_sources: for({key, value} <- sources, value == "unknown", do: key)
    }
  end

  def source_status_summary(_context),
    do: %{sources: %{}, unavailable_sources: [], unknown_sources: []}

  @doc "本上下文生效的组装策略；未挂载时回落地板档默认（保证 floor 行为不变）。"
  @spec policy(t() | nil) :: AssemblyPolicy.t()
  def policy(%__MODULE__{assembly_policy: %AssemblyPolicy{} = p}), do: p
  def policy(_), do: AssemblyPolicy.default()

  @doc """
  返回简明文本摘要，用于 Planner prompt。
  """
  @spec to_prompt_text(t()) :: String.t()
  def to_prompt_text(%__MODULE__{} = ctx) do
    [
      work_prompt_section(ctx),
      conversation_prompt_section(ctx),
      memory_prompt_section(ctx),
      behavior_prompt_section(ctx),
      chapters_prompt_section(ctx)
    ]
    |> Enum.reject(&is_nil/1)
    |> Enum.join("\n\n")
  end

  defp work_prompt_section(ctx) do
    cond do
      source_unavailable?(ctx, :work) ->
        "## 当前作品上下文\n（#{source_label(ctx, :work)}：当前作品事实未知，不得当作无作品或新对话）"

      ctx.current_work_snapshot ->
        "## 当前作品上下文\n" <>
          Enum.map_join(ctx.current_work_snapshot, "\n", fn {k, v} -> "- #{k}: #{v}" end)

      true ->
        "## 当前作品上下文\n（无——这是新对话或尚未创建作品）"
    end
  end

  defp conversation_prompt_section(ctx) do
    cond do
      ctx.conversation_summary ->
        "## 最近对话\n#{ctx.conversation_summary}"

      source_unavailable?(ctx, :conversation) ->
        "## 最近对话\n（#{source_label(ctx, :conversation)}：会话历史未知，不得声称刚才没有讨论）"

      true ->
        nil
    end
  end

  defp memory_prompt_section(ctx) do
    cond do
      ctx.memory_summary ->
        "## 相关记忆\n#{ctx.memory_summary}"

      source_unavailable?(ctx, :memory) ->
        "## 相关记忆\n（#{source_label(ctx, :memory)}：记忆事实未知，不得声称没有记忆）"

      true ->
        nil
    end
  end

  defp behavior_prompt_section(%__MODULE__{open_behavior_summary: value})
       when is_binary(value) and value != "",
       do: "## 当前待处理动作\n#{value}"

  defp behavior_prompt_section(_ctx), do: nil

  defp chapters_prompt_section(%__MODULE__{current_chapters: [_ | _] = chapters}) do
    "## 已采纳章节\n" <> Enum.map_join(chapters, "\n", &"- #{&1}")
  end

  defp chapters_prompt_section(_ctx), do: nil

  @doc """
  是否有任何上下文。
  """
  @spec has_context?(t()) :: boolean()
  def has_context?(%__MODULE__{} = ctx) do
    ctx.current_work_snapshot != nil or
      ctx.conversation_summary != nil or
      ctx.memory_summary != nil or
      ctx.open_behavior_summary != nil
  end
end
