defmodule NovelAgent.Provider.InferenceParams do
  @moduledoc """
  跨 Provider 的通用推理参数。各 adapter 在构建请求体时映射为自己的 API 字段名。

  nil 值表示不传入请求体，让服务端使用默认值。
  """

  defstruct [:temperature, :max_tokens, :top_p, :stop]

  @type t :: %__MODULE__{
          temperature: float() | nil,
          max_tokens: pos_integer() | nil,
          top_p: float() | nil,
          stop: [String.t()] | nil
        }

  @doc "使用默认值创建（temperature 0.7，其余 nil）。可通过 keyword 覆盖。"
  @spec new(keyword()) :: t()
  def new(overrides \\ []) do
    # M2 缺陷九（2026-07-20 实锤）：无界生成——地板级模型不吐停止符时单调用跑出
    # 18.3 万 token（53 分钟），拖垮其上所有层（run 占框/runner 盲等/探针假挂）。
    # 全局硬兜底：任何调用不得无界；用途方需要更紧上限用 overrides 收窄。
    defaults = [temperature: 0.7, max_tokens: 6_000, top_p: nil, stop: nil]
    struct!(%__MODULE__{}, Keyword.merge(defaults, overrides))
  end
end
