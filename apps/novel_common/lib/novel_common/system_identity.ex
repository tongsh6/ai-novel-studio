defmodule NovelCommon.SystemIdentity do
  @moduledoc """
  VS-00H 系统身份消息的唯一代码真源。

  每一次经 Provider Gateway 执行的推理请求，模型首先看到的
  一条固定 `system` 消息由本模块产出。文本只包含随任务不变的产品事实：

  - 产品是什么、服务谁；
  - 作者是唯一裁决者，模型不批准执行/写入/采纳；
  - 模型产出都是待确认材料；
  - 作品事实只来自后续消息给出的材料，缺失时诚实说明；
  - 本次角色与任务由后续消息给出。

  这里**不**放输出格式、输出语言、具体角色名、作品级或轮级内容；那些属于各调用点
  与 VS-00D 三层信封。身份文本不是作者可见文案，不进 `copy.ts`。

  文本变更必须递增 `@version`；`content_hash/0` 由文本机械派生，供 ProviderRun
  metadata / trace 引用，不落原文。注入与幂等由 Gateway 负责；本模块只回答
  “身份消息是什么”与“这条消息是不是身份消息”。
  """

  @version "sys-identity-v1"

  @content """
  你在 AI Novel Studio 中工作，这是一个长篇小说创作工作台，服务于正在创作的作者。
  作者是唯一裁决者：执行、写入、采纳都由作者与系统决定，你不批准任何一项。
  你产出的一切都是待确认材料，未经作者采纳不构成作品事实。
  当前作品的事实只来自后续消息给出的材料；材料缺失时如实说明，不要编造。
  你本次承担的角色与任务由后续消息给出。
  """

  @content_hash :crypto.hash(:sha256, @content) |> Base.encode16(case: :lower)

  @doc "身份文本唯一真源。"
  @spec content() :: String.t()
  def content, do: @content

  @doc "身份版本；文本变更时递增。"
  @spec version() :: String.t()
  def version, do: @version

  @doc "身份文本的稳定哈希（sha256 hex）。"
  @spec content_hash() :: String.t()
  def content_hash, do: @content_hash

  @doc "ProviderRun / trace 可引用的身份事实；不包含原文。"
  @spec identity_ref() :: %{version: String.t(), content_hash: String.t()}
  def identity_ref, do: %{version: @version, content_hash: @content_hash}
end
