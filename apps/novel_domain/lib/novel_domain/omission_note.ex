defmodule NovelDomain.OmissionNote do
  @moduledoc """
  省略说明（VS-00C §3.3 / `06-memory-context-and-trace.md` §5.3 §5.5 / `domain/26` §25）。

  v3 不变量"Context 不是全量 dump，**省略必须可解释**"（`00c` #13 / `06` §18）的载体：
  凡是"存在但未进入上下文"的材料，必有一条 OmissionNote 说明被省了什么、为什么、有无替代物。

  `reason` 取 `06` §5.5 枚举子集（CP1 先实现 `:budget_limited`，其余随后续 CP 启用）。
  `replacement` 为 nil 表示无替代（CP1 阶段尚无 chapter_summary 兜底）；CP2 起填摘要替代物。
  """

  @type reason :: :budget_limited | :irrelevant | :stale

  @type t :: %__MODULE__{
          source: String.t(),
          reason: reason(),
          replacement: String.t() | nil
        }

  @enforce_keys [:source, :reason]
  defstruct source: nil, reason: nil, replacement: nil

  @doc "构造一条省略说明。"
  @spec new(String.t(), reason(), String.t() | nil) :: t()
  def new(source, reason, replacement \\ nil)
      when is_binary(source) and reason in [:budget_limited, :irrelevant, :stale] do
    %__MODULE__{source: source, reason: reason, replacement: replacement}
  end

  @doc "作者可见的安全摘要（不暴露原文/敏感信息），供 trace why 面板展示。"
  @spec author_safe_summary(t()) :: String.t()
  def author_safe_summary(%__MODULE__{source: source, reason: reason, replacement: replacement}) do
    base =
      case reason do
        :budget_limited -> "#{source}：超出本轮上下文预算，已省略"
        :irrelevant -> "#{source}：与本轮无关，已省略"
        :stale -> "#{source}：可能过期，已省略"
      end

    if replacement, do: base <> "（以 #{replacement} 替代）", else: base
  end
end
