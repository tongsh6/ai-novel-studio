defmodule NovelCommon.AuthorVisible.Text do
  @moduledoc """
  作者可见文本的唯一数据形状。

  作者可见字段（assistant_message、通知、卡片标题/正文、状态文案等）只应携带
  本 struct；内部 code 先经 `NovelCommon.AuthorVisible.Display` 转成 display 文本，
  再构造 `%Text{}`。这样「拼作者文案」集中在一个可 review 的边界，而不是散落在
  各模块的字符串模板里。

  本模块不提供任何「原样返回内部 code」的构造路径：`new/1` 只接受已经
  display 化的字符串，`from_display/2` 是推荐入口。
  """

  alias NovelCommon.AuthorVisible.Display

  @enforce_keys [:text]
  defstruct [:text]

  @type t :: %__MODULE__{text: String.t()}

  @doc "从已 display 化的字符串构造作者可见文本（空串不合法）。"
  @spec new(String.t()) :: t()
  def new(text) when is_binary(text) and text != "", do: %__MODULE__{text: text}

  def new(text) when is_binary(text) do
    raise ArgumentError, "author-visible text must not be empty"
  end

  @doc "从 display 域 code 构造（未登记 code 走作者安全兜底）。"
  @spec from_display(atom() | String.t(), term()) :: t()
  def from_display(kind, code), do: new(Display.label(kind, code))

  @doc "拼接多个作者可见文本（顿号分隔）；空列表返回中性的「无」。"
  @spec join([t() | String.t()]) :: t()
  def join([]), do: new("无")

  def join(texts) when is_list(texts) do
    texts
    |> Enum.map(&text/1)
    |> Enum.reject(&(&1 == ""))
    |> Enum.join("、")
    |> new()
  end

  @doc "返回作者可见文本的原文（写 wire / 展示时使用）。"
  @spec text(t() | String.t()) :: String.t()
  def text(%__MODULE__{text: text}), do: text
  def text(value) when is_binary(value), do: value
end
