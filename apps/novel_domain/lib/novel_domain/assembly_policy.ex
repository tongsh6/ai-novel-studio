defmodule NovelDomain.AssemblyPolicy do
  @moduledoc """
  上下文组装策略（VS-00C §3.2 / `06-memory-context-and-trace.md` §5.3 §5.4 / `domain/26` §14）。

  **分层结构与挤压顺序模型无关、对所有 profile 一致；预算数值按 provider profile 参数化**
  ——裁切线随 provider 档位移动，结构不动（VS00C-I7 / SU-I4 的上下文层投影）。

  预算不是实现内 magic number，而是 envelope 一等字段（`06` §5.3 把 `token_budget` /
  `assembly_policy_ref` 列为 DialogueContext envelope 必填项）。本对象由 application 在
  组装上下文时按当前 provider 解析，挂到 `DialogueContext` 上，供创作执行读取。
  """

  @type tier :: :floor | :standard | :large
  @type consumer :: :tool | :planner

  @type t :: %__MODULE__{
          policy_id: String.t(),
          consumer: consumer(),
          excerpt_budget_chars: pos_integer(),
          summary_window: non_neg_integer(),
          context_budget_chars: pos_integer() | nil
        }

  defstruct policy_id: "prose_writing/floor_v2",
            consumer: :tool,
            excerpt_budget_chars: 2000,
            summary_window: 15,
            context_budget_chars: nil

  # profile 矩阵（VS-00C §3.2）。floor 的 2000 与历史 @prior_prose_max_chars 一致，
  # 保证地板档 excerpt 行为不变；CP2.2 L3a 摘要窗口统一由策略给出。
  @profiles %{
    floor: %{excerpt_budget_chars: 2000, summary_window: 15},
    standard: %{excerpt_budget_chars: 8000, summary_window: 15},
    large: %{excerpt_budget_chars: 200_000, summary_window: 15}
  }

  # provider → 档位。地板档：本地小窗口与确定性替身；大窗口档：云端大模型。
  @provider_tier %{
    lmstudio: :floor,
    stub: :floor,
    slice_verify: :floor,
    deepseek: :large,
    anthropic: :large
  }

  @doc "地板档默认策略（provider 未知时的安全档）。"
  @spec default() :: t()
  def default, do: for_tier(:floor)

  @doc """
  按 provider 名解析创作执行（`:tool` / prose_writing）的组装策略。
  接受 atom 或 string（配置里可能是字符串）；未知 provider → 地板档。
  """
  @spec for_provider(atom() | String.t() | nil) :: t()
  def for_provider(provider) do
    provider
    |> normalize_provider()
    |> then(&Map.get(@provider_tier, &1, :floor))
    |> for_tier()
  end

  @doc "按档位构建策略。"
  @spec for_tier(tier()) :: t()
  def for_tier(tier) when is_map_key(@profiles, tier) do
    p = Map.fetch!(@profiles, tier)

    %__MODULE__{
      policy_id: "prose_writing/#{tier}_v2",
      consumer: :tool,
      excerpt_budget_chars: p.excerpt_budget_chars,
      summary_window: p.summary_window,
      context_budget_chars: nil
    }
  end

  defp normalize_provider(p) when is_atom(p) and not is_nil(p), do: p

  defp normalize_provider(p) when is_binary(p) do
    String.to_existing_atom(p)
  rescue
    ArgumentError -> :__unknown__
  end

  defp normalize_provider(_), do: :__unknown__
end
