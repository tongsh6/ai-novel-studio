defmodule NovelApplication.ContextPressure do
  @moduledoc """
  B71 上下文压力的只读派生边界（阶段 4 基础设施）。

  只从真实 `ProviderRun` usage 读取最近一次请求的输入 token 规模，按保守模型窗口计算
  压力；不写库、不触发压缩、不向作者展示。自动维护的**触发门控**于 VS-00L §18 变更提案
  评审通过：提案通过前本模块没有生产调用者，只被测试与后续安全点触发消费。

  阈值只决定后续维护的触发时机，不决定丢弃范围（VS-00L §16.2）。窗口配置保守偏小，
  宁早整理不冒险；覆盖通过 `:novel_application, :context_window_overrides` 与
  `:context_pressure` 应用配置，不进入作者界面。
  """

  alias NovelPersistence.ProviderRunLog

  # 保守窗口（token）：真实模型窗口通常更大，这里取低于实际能力的值，让维护更早发生。
  # 测试替身（stub/slice_verify）不是供应商事实，不进入该表：未知 provider 用保守窗口兜底。
  @default_windows %{
    "lmstudio" => 32_000,
    "strata" => 32_000,
    "splash" => 32_000,
    "openai" => 128_000,
    "openai_subscription" => 128_000,
    "anthropic" => 200_000,
    "deepseek" => 64_000
  }
  @conservative_window 32_000
  @default_maintenance_ratio 0.70
  @default_hard_ratio 0.90

  @type signal :: %{
          input_tokens: pos_integer(),
          provider: String.t() | nil,
          model: String.t() | nil
        }

  @type pressure :: %{
          available: boolean(),
          input_tokens: non_neg_integer() | nil,
          provider: String.t() | nil,
          model: String.t() | nil,
          window: pos_integer(),
          ratio: float() | nil,
          maintenance_due?: boolean(),
          hard_due?: boolean()
        }

  @doc """
  最近一次真实 Provider 请求的输入规模（只读）。

  usage 缺失（测试替身、未落库或全部为 0）时返回 `:unavailable`，调用方必须按
  「未知」处理，不得猜测或按消息数估算。
  """
  @spec latest_usage(String.t()) :: {:ok, signal()} | :unavailable
  def latest_usage(run_id) when is_binary(run_id) do
    run_id
    |> ProviderRunLog.list_usage_summaries()
    |> Enum.reverse()
    |> Enum.find_value(:unavailable, fn summary ->
      case input_tokens(summary) do
        nil ->
          nil

        tokens ->
          {:ok,
           %{
             input_tokens: tokens,
             provider: Map.get(summary, :provider_id),
             model: Map.get(summary, :model)
           }}
      end
    end)
  end

  def latest_usage(_run_id), do: :unavailable

  @doc """
  解析运维窗口覆盖配置（产品化配置，非验收专用）。

  环境变量 `NOVEL_CONTEXT_WINDOW_OVERRIDES` 的格式为 `provider:window` 逗号分隔，
  如 `"strata:4096,openai:8192"`；空项/非法项忽略（不猜测），nil 或全部非法返回
  `%{}`。覆盖只影响安全点自动维护的压力阈值判定，不向作者展示。
  """
  @spec parse_window_overrides(String.t() | nil) :: %{optional(String.t()) => pos_integer()}
  def parse_window_overrides(nil), do: %{}

  def parse_window_overrides(text) when is_binary(text) do
    text
    |> String.split(",", trim: true)
    |> Enum.reduce(%{}, fn entry, acc ->
      case parse_window_entry(entry) do
        nil -> acc
        {provider, window} -> Map.put(acc, provider, window)
      end
    end)
  end

  def parse_window_overrides(_other), do: %{}

  # 单条 `provider:window` 解析；非法项返回 nil 由调用方忽略（不猜测）。
  defp parse_window_entry(entry) do
    case String.split(entry, ":", parts: 2) do
      [provider, window] ->
        provider = String.trim(provider)

        with true <- provider != "",
             {value, ""} <- Integer.parse(String.trim(window)),
             true <- value > 0 do
          {provider, value}
        else
          _ -> nil
        end

      _other ->
        nil
    end
  end

  @doc "保守模型窗口（token）；provider 未知时返回保守默认。"
  @spec window(String.t() | nil) :: pos_integer()
  def window(provider) do
    overrides =
      :novel_application
      |> Application.get_env(:context_window_overrides, %{})
      |> config_map()

    Map.get(overrides, provider) ||
      Map.get(@default_windows, provider) ||
      @conservative_window
  end

  @doc """
  派生当前 run 的上下文压力（只读）。

  `maintenance_due?` 只表示「可以进入安全点维护」，不授权压缩本身；真正执行仍由后续
  评审通过的自动维护触发点决定。
  """
  @spec pressure(String.t()) :: pressure()
  def pressure(run_id) when is_binary(run_id) do
    {maintenance_ratio, hard_ratio} = ratios()

    case latest_usage(run_id) do
      :unavailable ->
        %{
          available: false,
          input_tokens: nil,
          provider: nil,
          model: nil,
          window: window(nil),
          ratio: nil,
          maintenance_due?: false,
          hard_due?: false
        }

      {:ok, signal} ->
        model_window = window(signal.provider)
        ratio = signal.input_tokens / model_window

        %{
          available: true,
          input_tokens: signal.input_tokens,
          provider: signal.provider,
          model: signal.model,
          window: model_window,
          ratio: ratio,
          maintenance_due?: ratio >= maintenance_ratio,
          hard_due?: ratio >= hard_ratio
        }
    end
  end

  def pressure(_run_id) do
    %{
      available: false,
      input_tokens: nil,
      provider: nil,
      model: nil,
      window: window(nil),
      ratio: nil,
      maintenance_due?: false,
      hard_due?: false
    }
  end

  @doc "是否到达安全点维护线（只读；不执行压缩）。"
  @spec maintenance_due?(String.t()) :: boolean()
  def maintenance_due?(run_id) when is_binary(run_id), do: pressure(run_id).maintenance_due?
  def maintenance_due?(_run_id), do: false

  defp ratios do
    config =
      :novel_application
      |> Application.get_env(:context_pressure, %{})
      |> config_map()

    {Map.get(config, :maintenance_ratio, @default_maintenance_ratio),
     Map.get(config, :hard_ratio, @default_hard_ratio)}
  end

  defp config_map(value) do
    case value do
      config when is_list(config) -> Map.new(config)
      config when is_map(config) -> config
      _other -> %{}
    end
  end

  defp input_tokens(summary) do
    case Map.get(summary, :usage) do
      usage when is_map(usage) ->
        value = Map.get(usage, :input_tokens) || Map.get(usage, "input_tokens")

        if is_integer(value) and value > 0, do: value, else: nil

      _usage ->
        nil
    end
  end
end
