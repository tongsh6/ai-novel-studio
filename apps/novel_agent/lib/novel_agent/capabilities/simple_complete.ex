defmodule NovelAgent.Capabilities.SimpleComplete do
  @moduledoc """
  第一个 capability：调用 LLM 返回文本，无业务逻辑。

  Phase 0 Week 3 的交付目标——验证 Provider Gateway → Capability → 结果的链路可通。
  """

  alias NovelAgent.AuthorityGate
  alias NovelAgent.BudgetMeter
  alias NovelAgent.Provider

  @doc """
  执行 simple_complete capability。

  Authority Gate 拒绝时返回 `{:error, :unauthorized}`。
  """
  @spec execute(module(), term(), Provider.prompt()) :: Provider.result()
  def execute(provider_mod, provider_state, prompt) when is_binary(prompt) do
    case AuthorityGate.authorize(:simple_complete) do
      :allowed ->
        BudgetMeter.record(:simple_complete)

        :telemetry.execute(
          [:novel_agent, :capability, :invoke],
          %{},
          %{capability: :simple_complete, prompt: prompt}
        )

        provider_mod.complete(provider_state, "default", prompt)

      :denied ->
        {:error, :unauthorized}
    end
  end
end
