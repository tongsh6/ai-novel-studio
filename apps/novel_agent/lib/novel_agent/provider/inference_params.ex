defmodule NovelAgent.Provider.InferenceParams do
  @moduledoc """
  跨 Provider 的通用推理参数。各 adapter 在构建请求体时映射为自己的 API 字段名。

  ## max_tokens 的定位（缺陷九/十，2026-07-20 教训）

  这里**不再**为 `max_tokens` 放一个跨 provider 通用的字面量默认值——早先放过
  6000/8000/24000 三版数字，全部现场实测证伪：真实 `purpose: :writer` 调用会
  暴露"某个具体模型的推理链/输出 verbosity"，那是模型自身的属性，换一个模型
  这个数字就失效，写死在这个跨 provider 通用模块里本身就是错误定位。

  正确定位：
  - `max_tokens` 的安全下限现在归属**各 provider 自己的配置**（`config :novel_agent,
    NovelAgent.Provider.LMStudio, max_tokens: ...` 等，env 可覆盖），由该 provider
    的 adapter 在构建请求体时自己兜底（参考 Anthropic 已有的 `max_tokens: 4096`
    基础值模式）——换模型 = 改配置，不是改代码。
  - 真正**模型无关**的止血阀是挂钟时长（`OpenAICompatibleStream`/`AnthropicStream`
    的 deadline 判定，复用各 provider 自己配置的 `timeout`），因为"这次调用花了
    多久"对任何模型都是同一把尺子，token 数不是。
  - 内容层再加一道`NovelAgent.Provider.degenerate_content?/1`（缺陷十：采样
    退化时 HTTP 200 正常返回但内容是低熵重复，不是任何 token 上限能挡住的）。

  三道防线分工不同、互不替代：provider 级 max_tokens 挡"预算超支"，挂钟挡
  "不管什么原因、这次就是拖太久了"，内容层挡"看起来完整但其实是垃圾"。

  nil 值表示调用方未表达偏好，交给 provider 自己的配置兜底（不是"不传给服务端"
  ——各 adapter 会先用自己的配置值做基础值，caller 传显式值时才覆盖）。
  """

  defstruct [:temperature, :max_tokens, :top_p, :stop]

  @type t :: %__MODULE__{
          temperature: float() | nil,
          max_tokens: pos_integer() | nil,
          top_p: float() | nil,
          stop: [String.t()] | nil
        }

  @doc "使用默认值创建（temperature 0.7，其余 nil——nil 语义见 moduledoc）。可通过 keyword 覆盖。"
  @spec new(keyword()) :: t()
  def new(overrides \\ []) do
    defaults = [temperature: 0.7, max_tokens: nil, top_p: nil, stop: nil]
    struct!(%__MODULE__{}, Keyword.merge(defaults, overrides))
  end
end
