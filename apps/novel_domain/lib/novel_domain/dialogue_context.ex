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
          current_chapters: [String.t()],
          context_refs: [ContextSourceRef.t()],
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
    current_chapters: [],
    context_refs: [],
    assembly_policy: nil,
    omission_notes: [],
    assembled_at: nil
  ]

  @doc "本上下文生效的组装策略；未挂载时回落地板档默认（保证 floor 行为不变）。"
  @spec policy(t() | nil) :: AssemblyPolicy.t()
  def policy(%__MODULE__{assembly_policy: %AssemblyPolicy{} = p}), do: p
  def policy(_), do: AssemblyPolicy.default()

  @doc """
  返回简明文本摘要，用于 Planner prompt。
  """
  @spec to_prompt_text(t()) :: String.t()
  def to_prompt_text(%__MODULE__{} = ctx) do
    parts = []

    parts =
      if ctx.current_work_snapshot do
        ws = ctx.current_work_snapshot

        snap =
          "## 当前作品上下文\n" <>
            Enum.map_join(ws, "\n", fn {k, v} -> "- #{k}: #{v}" end)

        [snap | parts]
      else
        ["## 当前作品上下文\n（无——这是新对话或尚未创建作品）" | parts]
      end

    parts =
      if ctx.conversation_summary do
        ["## 最近对话\n#{ctx.conversation_summary}" | parts]
      else
        parts
      end

    parts =
      if ctx.memory_summary do
        ["## 相关记忆\n#{ctx.memory_summary}" | parts]
      else
        parts
      end

    parts =
      case ctx.current_chapters do
        [_ | _] = chapters ->
          listed = Enum.map_join(chapters, "\n", &"- #{&1}")
          ["## 已采纳章节\n#{listed}" | parts]

        _ ->
          parts
      end

    parts
    |> Enum.reverse()
    |> Enum.join("\n\n")
  end

  @doc """
  是否有任何上下文。
  """
  @spec has_context?(t()) :: boolean()
  def has_context?(%__MODULE__{} = ctx) do
    ctx.current_work_snapshot != nil or
      ctx.conversation_summary != nil or
      ctx.memory_summary != nil
  end
end
