defmodule NovelAgent.Provider.Result do
  @moduledoc """
  Provider 调用统一结果。

  所有 adapter 必须返回此 struct。Provider execution boundary 会把终态
  ProviderRun / ProviderOutput / ProviderEvent refs 附回本结果，供仍在迁移期的
  final-result caller 关联同一 execution stream。
  """

  alias NovelAgent.Provider.Usage
  alias NovelCommon.Contracts.ProviderEvent
  alias NovelCommon.Contracts.ProviderOutput
  alias NovelCommon.Contracts.ProviderRun

  defstruct [
    :content,
    :usage,
    tool_calls: [],
    provider_call_ref: nil,
    provider_run_ref: nil,
    provider_output: nil,
    provider_events: []
  ]

  @type t :: %__MODULE__{
          content: String.t(),
          usage: Usage.t() | nil,
          tool_calls: [map()],
          provider_call_ref: String.t() | nil,
          provider_run_ref: String.t() | nil,
          provider_output: ProviderOutput.t() | nil,
          provider_events: [ProviderEvent.t()]
        }

  @doc "创建一个 Result。"
  @spec new(String.t(), Usage.t() | nil, keyword()) :: t()
  def new(content, usage \\ nil, opts \\ []) do
    %__MODULE__{
      content: content,
      usage: usage,
      tool_calls: normalize_tool_calls(Keyword.get(opts, :tool_calls, []))
    }
  end

  @doc """
  Attach unified provider execution facts to a final result.

  This keeps compatibility callers on the same provider execution stream while
  CP4 migrates them away from ad-hoc completion-only shapes.
  """
  @spec with_execution(t(), map()) :: t()
  def with_execution(
        %__MODULE__{} = result,
        %{provider_run: %ProviderRun{} = run, output: %ProviderOutput{} = output} = execution
      ) do
    %{
      result
      | provider_call_ref: output.provider_call_ref || run.provider_call_ref,
        provider_run_ref: output.provider_run_ref || run.provider_run_id,
        provider_output: output,
        provider_events: Map.get(execution, :events, [])
    }
  end

  def with_execution(%__MODULE__{} = result, _execution), do: result

  defp normalize_tool_calls(calls) when is_list(calls) do
    Enum.filter(calls, &is_map/1)
  end

  defp normalize_tool_calls(_calls), do: []
end
