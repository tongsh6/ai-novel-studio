defmodule NovelCommon.AuthorVisible.Text do
  @moduledoc """
  作者可见文本的唯一数据形状。

  作者可见字段（assistant_message、通知、卡片标题/正文、状态文案等）只应携带
  本 struct；内部 code 先经 `NovelCommon.AuthorVisible.Display` 转成 display 文本，
  再构造 `%Text{}`。这样「拼作者文案」集中在一个可 review 的边界，而不是散落在
  各模块的字符串模板里。

  本模块不提供任何「原样返回内部 code」的构造路径：`new/1` 只接受已经
  display 化的字符串，`from_display/2` 是推荐入口。

  作者可见投影（机制，不是事后校验）：`new/1` 在构造时统一把内部标识
  （`chapter:<uuid>` / `mem:<uuid>` / `call_*` / `run_*` / `prun_*` / `ctx_*`）
  替换为作者可读占位。原因：真实模型会复述其材料里的内部引用（如章索引行的
  `[chapter_ref=chapter:<uuid>]`）到作者可见正文；内部事实记录保留原样，**所有
  作者可见出口**统一经本形状投影，不允许把内部标识泄漏给作者。
  """

  alias NovelCommon.AuthorVisible.Display

  @enforce_keys [:text]
  defstruct [:text]

  @type t :: %__MODULE__{text: String.t()}

  @chapter_ref ~r/chapter:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/u
  @memory_ref ~r/mem:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/u
  @call_ref ~r/\bcall_[0-9A-Za-z_]+/u
  @run_ref ~r/\brun_[0-9A-Za-z_]+/u
  @provider_run_ref ~r/\bprun_[0-9A-Za-z_]+/u
  @context_ref ~r/\bctx_[0-9A-Za-z_]+/u

  @ref_patterns [
    {@chapter_ref, "（指定章节）"},
    {@memory_ref, "（相关记忆中）"},
    {@call_ref, "（操作记录）"},
    {@run_ref, "（任务记录）"},
    {@provider_run_ref, "（模型调用记录）"},
    {@context_ref, "（上下文引用）"}
  ]

  @doc "从已 display 化的字符串构造作者可见文本（空串不合法）；内部标识会被投影为可读占位。"
  @spec new(String.t()) :: t()
  def new(text) when is_binary(text) and text != "",
    do: %__MODULE__{text: redact_internal_refs(text)}

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

  @doc "作者可见投影：把内部标识替换为作者可读占位；非二进制原样返回（不猜测）。"
  @spec redact_internal_refs(term()) :: term()
  def redact_internal_refs(value) when is_binary(value) do
    Enum.reduce(@ref_patterns, value, fn {pattern, replacement}, acc ->
      Regex.replace(pattern, acc, replacement)
    end)
  end

  def redact_internal_refs(value), do: value

  @doc "文本是否含内部标识（作者可见出口的断言/诊断用）。"
  @spec contains_internal_ref?(term()) :: boolean()
  def contains_internal_ref?(value) when is_binary(value) do
    Enum.any?(@ref_patterns, fn {pattern, _replacement} -> Regex.match?(pattern, value) end)
  end

  def contains_internal_ref?(_value), do: false
end
