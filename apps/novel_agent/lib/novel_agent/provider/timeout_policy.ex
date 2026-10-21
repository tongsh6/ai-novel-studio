defmodule NovelAgent.Provider.TimeoutPolicy do
  @moduledoc """
  Provider 请求的存活时限策略（B22，2026-10-22 作者拍板方向）。

  ## 为什么不再用单一 `timeout` 当"总时长"

  作者可能让单次模型调用合法运行 10–60 分钟（写作/思考型任务），本地模型快慢
  差异大（实测 TTFT 27s–195s、吞吐 26–66 tok/s），且整个任务链可能跑数小时。
  用写死的总时长做杀灭条件，会把"仍在稳定出字"的健康长调用误判成超时（实测
  300s 挂钟已误杀 3 次）。

  作者拍板的判定原则：**只要模型还在稳定出字就不杀**；"该停不停"由 token 预算
  （各 provider 的 `max_tokens`）兜住，不靠挂钟。

  ## 三层时钟

  | 时钟 | 语义 | 由谁执行 |
  |---|---|---|
  | `connect_ms` | TCP/TLS 连接 | Req `connect_options` |
  | `response_ms` | 流式请求两次 wire data 之间允许的最长静默（= 等首包/等下一块）。只要还有数据（含 keepalive/思考 delta）就不触发 | Req `receive_timeout` |
  | `non_stream_ms` | 非流式请求（工具调用等无法感知中间进展）等待完整响应的上限 | Req `receive_timeout` |
  | `deadline_ms` | 可选的总挂钟兜底；`nil` = 不启用（默认） | 流式 adapter 应用层判定 |

  总时长兜底默认**关闭**：它只用于运维场景（例如部署方想强制限流），不是产品
  默认行为。需要时经 `NOVEL_<PROVIDER>_DEADLINE_TIMEOUT_MS` 或
  `NOVEL_LOCAL_DEADLINE_TIMEOUT_MS` / `NOVEL_HOSTED_DEADLINE_TIMEOUT_MS` 显式开启。

  ## Profile 默认值

  | profile | response_ms | non_stream_ms | deadline_ms |
  |---|---|---|---|
  | local（`:lmstudio`, `:strata`） | 900_000（15 分钟无任何 wire 数据才判挂死） | 1_800_000（30 分钟） | 不启用 |
  | hosted（其余 provider） | 沿用 legacy `timeout`（默认 300_000） | 沿用 legacy `timeout` | 不启用 |

  本地 response 窗口取 15 分钟 bootstrap：实测本地 TTFT 最大 195s；预填充/后端
  排队可能更长。它是"多久没数据算挂死"的异常检测窗口，不是业务时限，后续可由
  按 `(provider, model, thinking)` 实测 TTFT p99 的自适应校准收紧/放宽。

  ## 解析优先级

  `response_ms`（从高到低）：

  1. provider 配置显式 `response_timeout:`
  2. env `NOVEL_<PROVIDER>_RESPONSE_TIMEOUT_MS`
  3. env `NOVEL_LOCAL_RESPONSE_TIMEOUT_MS` / `NOVEL_HOSTED_RESPONSE_TIMEOUT_MS`
  4. env `NOVEL_<PROVIDER>_TIMEOUT_MS`（legacy）
  5. provider 配置 legacy `timeout:`
  6. profile 默认（local 900s；hosted 300s）

  `non_stream_ms` 同理（`NOVEL_*_NON_STREAM_TIMEOUT_MS` → legacy → profile 默认）。
  `deadline_ms` 只有显式配置/环境变量才存在；`0` / `"off"` / `"disabled"` 视为关闭。
  `connect_ms` 默认 15s，可由 `NOVEL_<PROVIDER>_CONNECT_TIMEOUT_MS` 覆盖。

  本模块只做纯解析，不做 I/O 判定；env 通过 `opts[:env]` 注入以便测试。
  """

  @type profile :: :local | :hosted
  @type t :: %__MODULE__{
          provider: atom(),
          profile: profile(),
          connect_ms: pos_integer(),
          response_ms: pos_integer(),
          non_stream_ms: pos_integer(),
          deadline_ms: pos_integer() | nil
        }

  defstruct [:provider, :profile, :connect_ms, :response_ms, :non_stream_ms, :deadline_ms]

  @local_providers [:lmstudio, :strata]

  @connect_ms 15_000
  @probe_ms 15_000

  @local_response_ms 900_000
  @local_non_stream_ms 1_800_000

  @hosted_response_ms 300_000
  @hosted_non_stream_ms 300_000

  @doc "解析一次 provider 调用的存活时限。"
  @spec resolve(atom() | String.t(), keyword() | map(), keyword()) :: t()
  def resolve(provider, config \\ [], opts \\ []) do
    provider = normalize_provider(provider)
    config = normalize_config(config)
    env = Keyword.get(opts, :env)
    profile = profile(provider)

    %__MODULE__{
      provider: provider,
      profile: profile,
      connect_ms: resolve_connect(provider, config, env),
      response_ms: resolve_response(provider, profile, config, env),
      non_stream_ms: resolve_non_stream(provider, profile, config, env),
      deadline_ms: resolve_deadline(provider, config, env)
    }
  end

  @doc "该 provider 是否走本地推理 profile。"
  @spec local?(atom() | String.t()) :: boolean()
  def local?(provider), do: profile(provider) == :local

  @doc "provider 的 profile（:local / :hosted）。"
  @spec profile(atom() | String.t()) :: profile()
  def profile(provider) do
    if normalize_provider(provider) in @local_providers, do: :local, else: :hosted
  end

  @doc "健康检查 / 模型列表等轻量探测的响应上限（固定短窗，避免长 timeout 拖住 UI）。"
  @spec probe_timeout() :: pos_integer()
  def probe_timeout, do: @probe_ms

  @doc "计算探测超时：legacy 值更短时尊重 legacy（测试注入短超时的场景）。"
  @spec probe_timeout(pos_integer() | nil) :: pos_integer()
  def probe_timeout(fallback) when is_integer(fallback) and fallback > 0,
    do: min(fallback, @probe_ms)

  def probe_timeout(_fallback), do: @probe_ms

  # ── resolution ──────────────────────────────

  defp resolve_response(provider, :local, config, env) do
    [
      positive(Map.get(config, :response_timeout)),
      positive(env_get(env, provider_env(provider, "RESPONSE_TIMEOUT_MS"))),
      positive(env_get(env, "NOVEL_LOCAL_RESPONSE_TIMEOUT_MS")),
      positive(env_get(env, provider_env(provider, "TIMEOUT_MS"))),
      positive(Map.get(config, :timeout)),
      @local_response_ms
    ]
    |> Enum.find(&is_integer/1)
  end

  defp resolve_response(provider, :hosted, config, env) do
    [
      positive(Map.get(config, :response_timeout)),
      positive(env_get(env, provider_env(provider, "RESPONSE_TIMEOUT_MS"))),
      positive(env_get(env, "NOVEL_HOSTED_RESPONSE_TIMEOUT_MS")),
      positive(env_get(env, provider_env(provider, "TIMEOUT_MS"))),
      positive(Map.get(config, :timeout)),
      @hosted_response_ms
    ]
    |> Enum.find(&is_integer/1)
  end

  defp resolve_non_stream(provider, :local, config, env) do
    [
      positive(Map.get(config, :non_stream_timeout)),
      positive(env_get(env, provider_env(provider, "NON_STREAM_TIMEOUT_MS"))),
      positive(env_get(env, "NOVEL_LOCAL_NON_STREAM_TIMEOUT_MS")),
      positive(env_get(env, provider_env(provider, "TIMEOUT_MS"))),
      positive(Map.get(config, :timeout)),
      @local_non_stream_ms
    ]
    |> Enum.find(&is_integer/1)
  end

  defp resolve_non_stream(provider, :hosted, config, env) do
    [
      positive(Map.get(config, :non_stream_timeout)),
      positive(env_get(env, provider_env(provider, "NON_STREAM_TIMEOUT_MS"))),
      positive(env_get(env, "NOVEL_HOSTED_NON_STREAM_TIMEOUT_MS")),
      positive(env_get(env, provider_env(provider, "TIMEOUT_MS"))),
      positive(Map.get(config, :timeout)),
      @hosted_non_stream_ms
    ]
    |> Enum.find(&is_integer/1)
  end

  # 总时长兜底：默认不启用；只有显式配置/环境变量才存在。
  defp resolve_deadline(provider, config, env) do
    [
      Map.get(config, :deadline_timeout),
      env_get(env, provider_env(provider, "DEADLINE_TIMEOUT_MS")),
      env_get(env, "NOVEL_LOCAL_DEADLINE_TIMEOUT_MS"),
      env_get(env, "NOVEL_HOSTED_DEADLINE_TIMEOUT_MS")
    ]
    |> Enum.find_value(&positive/1)
  end

  defp resolve_connect(provider, config, env) do
    positive(Map.get(config, :connect_timeout)) ||
      positive(env_get(env, provider_env(provider, "CONNECT_TIMEOUT_MS"))) ||
      @connect_ms
  end

  # ── helpers ─────────────────────────────────

  defp normalize_provider(provider) when is_atom(provider), do: provider

  defp normalize_provider(provider) when is_binary(provider) do
    String.to_existing_atom(provider)
  rescue
    ArgumentError -> :other
  end

  defp normalize_provider(_provider), do: :other

  defp normalize_config(config) when is_map(config), do: config
  defp normalize_config(config) when is_list(config), do: Map.new(config)
  defp normalize_config(_config), do: %{}

  defp provider_env(provider, suffix) do
    prefix = provider |> Atom.to_string() |> String.upcase()
    "NOVEL_#{prefix}_#{suffix}"
  end

  defp env_get(nil, key), do: System.get_env(key)
  defp env_get(env, key) when is_function(env, 1), do: env.(key)
  defp env_get(env, key) when is_map(env), do: Map.get(env, key)
  defp env_get(_env, _key), do: nil

  defp positive(value) when is_integer(value) and value > 0, do: value

  defp positive(value) when is_binary(value) do
    case Integer.parse(String.trim(value)) do
      {int, ""} when int > 0 -> int
      _ -> nil
    end
  end

  defp positive(_value), do: nil
end
