defmodule NovelCommon.CapabilityProfile do
  @moduledoc """
  Provider 传输能力事实（VS-00L §6.4 / §10；ADR-0033 §2.6）。

  本模块是「一次请求实际具备哪些传输能力」的唯一派生边界：

  - 事实来源是 adapter 自身声明的可证能力（Provider behaviour 的 `capabilities/1`），
    按实际选定 route（provider + state/model）派生；provider descriptor 只描述
    配置/UI 属性，不能代替传输能力。
  - 未声明或声明为假的能力一律视为不可证，不默认置 true（禁止假声明）。
  - 必备能力清单只来自 `RequestIR.required_capabilities/0`，此处不复制清单。
  - 缺必备能力时调用方必须显式 `finite_mode` 或拒绝路由并给出作者可见原因，
    不得静默丢字段后仍宣称完整 AgentRun。
  """

  alias NovelCommon.RequestIR
  alias NovelFoundation.UpstreamError

  @type t :: %{required(atom()) => boolean()}

  @doc "完整 AgentRun 的必备能力清单（唯一来源：RequestIR）。"
  @spec required() :: [atom()]
  def required, do: RequestIR.required_capabilities()

  @doc """
  从 adapter 模块派生能力事实。

  adapter 可在自己的 `capabilities/1` 中按 `state.model`/wire 配置做 model 级或
  route 级覆盖（例如 Responses wire 的真实流式能力），本模块不做猜测。
  未实现 `capabilities/1` 的模块得到全部 false 的保守事实。
  """
  @spec from_adapter(module(), term()) :: t()
  def from_adapter(module, state) when is_atom(module) do
    declared = declared_capabilities(module, state)

    Map.new(required(), fn capability -> {capability, Map.get(declared, capability) == true} end)
  end

  def from_adapter(_module, _state), do: empty()

  @doc "全部能力均不可证的保守事实。"
  @spec empty() :: t()
  def empty, do: Map.new(required(), &{&1, false})

  @doc "按 required/0 的顺序返回缺失的必备能力。"
  @spec missing(t()) :: [atom()]
  def missing(profile) when is_map(profile) do
    Enum.reject(required(), &(Map.get(profile, &1) == true))
  end

  def missing(_profile), do: required()

  @doc "能力事实是否完整（无缺失）。"
  @spec complete?(t()) :: boolean()
  def complete?(profile), do: missing(profile) == []

  @doc """
  作者安全的必备能力展示名（中文，不含内部 atom）。

  内部 capability atom 只用于 reason/details 诊断与门槛，不得直接出现在作者文案。
  """
  @spec label(atom()) :: String.t()
  def label(:native_multi_turn), do: "原生多轮"
  def label(:tool_calls), do: "原生工具调用"
  def label(:tool_results), do: "原生工具结果"
  def label(:streaming), do: "流式解析"
  def label(:structured_output), do: "结构化输出"
  def label(:usage), do: "用量回收"
  def label(capability), do: to_string(capability)

  @doc "按 required/0 顺序拼接缺失能力的作者安全展示名。"
  @spec labels([atom()]) :: String.t()
  def labels(missing) when is_list(missing), do: Enum.map_join(missing, "、", &label/1)
  def labels(_missing), do: ""

  @doc """
  显式 `finite_mode` 是否真的覆盖了缺失的必备能力（VS-00L §6.4）。

  有限模式必须声明它限制了哪些能力：按 `name` 映射到已知受限集合（no_tools /
  single_turn / no_streaming / no_structured_output / no_usage / legacy 全量），
  或显式给出 `not_supported` 列表。未覆盖缺失项时不是有限模式，必须拒绝路由，
  不允许「加个 finite_mode」成为万能绕过。
  """
  @spec finite_mode_covers?(map() | nil, [atom()]) :: boolean()
  def finite_mode_covers?(_mode, []), do: true

  def finite_mode_covers?(mode, missing) when is_map(mode) and is_list(missing) do
    declared = declared_limitations(mode)
    Enum.all?(missing, &(&1 in declared))
  end

  def finite_mode_covers?(_mode, _missing), do: false

  defp declared_limitations(mode) do
    explicit =
      mode
      |> fetch_mode_field(:not_supported)
      |> List.wrap()
      |> Enum.map(&normalize_capability/1)
      |> Enum.reject(&is_nil/1)

    Enum.uniq(explicit ++ named_limitations(fetch_mode_field(mode, :name)))
  end

  defp named_limitations("no_tools"), do: [:tool_calls, :tool_results]
  defp named_limitations("single_turn"), do: [:native_multi_turn]
  defp named_limitations("no_streaming"), do: [:streaming]
  defp named_limitations("no_structured_output"), do: [:structured_output]
  defp named_limitations("no_usage"), do: [:usage]
  defp named_limitations(_name), do: []

  defp fetch_mode_field(mode, key) do
    Map.get(mode, key) || Map.get(mode, to_string(key))
  end

  defp normalize_capability(capability) when is_atom(capability) do
    if capability in required(), do: capability
  end

  defp normalize_capability(capability) when is_binary(capability) do
    Enum.find(required(), &(to_string(&1) == capability))
  end

  defp normalize_capability(_capability), do: nil

  @default_projection_target "chat_completions"
  @projection_targets ["chat_completions", "anthropic_messages", "responses_api"]

  @doc """
  按实际选定 route 派生能力事实（Gateway 与诊断共用同一入口）。

  `route` 为 `%{module: adapter, state: adapter_state, model_name: model}`；route 无法
  解析（`nil`/错误）时返回全部不可证的保守事实且 `model: nil`，不猜测。
  """
  @spec facts(atom() | String.t(), map() | nil) :: map()
  def facts(provider, %{module: module} = route) do
    profile = from_adapter(module, Map.get(route, :state))

    %{
      provider: provider,
      model: normalize_model(Map.get(route, :model_name)),
      profile: profile,
      missing: missing(profile),
      projection_target: projection_target(module, Map.get(route, :state))
    }
  end

  def facts(provider, _route) do
    %{
      provider: provider,
      model: nil,
      profile: empty(),
      missing: required(),
      projection_target: @default_projection_target
    }
  end

  @doc "本次 route 的真实 wire 投影目标；adapter 未声明时回落 chat_completions。"
  @spec projection_target(module(), term()) :: String.t()
  def projection_target(module, state) do
    if Code.ensure_loaded?(module) and function_exported?(module, :projection_target, 1) do
      case module.projection_target(state) do
        target when target in @projection_targets -> target
        _other -> @default_projection_target
      end
    else
      @default_projection_target
    end
  end

  @doc "能力拒绝的作者安全错误：作者文案只含中文能力名，内部 atom 仅在 details 诊断。"
  @spec rejection(module(), [atom()]) :: map()
  def rejection(module, missing) do
    error =
      UpstreamError.new(
        :invalid_request,
        "当前模型路由缺少完整运行所需的传输能力（#{labels(missing)}），已拒绝本次请求。",
        provider_label(module),
        %{missing_capabilities: missing}
      )

    %{
      type: error.type,
      message: error.message,
      provider: error.provider,
      retryable: error.retryable,
      details: error.details
    }
  end

  defp provider_label(module) do
    if Code.ensure_loaded?(module) and function_exported?(module, :name, 0) do
      module.name()
    else
      inspect(module)
    end
  end

  defp normalize_model(model) when is_binary(model) and model != "", do: model
  defp normalize_model(_model), do: nil

  defp declared_capabilities(module, state) do
    if Code.ensure_loaded?(module) and function_exported?(module, :capabilities, 1) do
      case module.capabilities(state) do
        %{} = capabilities -> capabilities
        _other -> %{}
      end
    else
      %{}
    end
  end
end
