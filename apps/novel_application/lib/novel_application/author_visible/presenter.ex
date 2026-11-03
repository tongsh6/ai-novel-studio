defmodule NovelApplication.AuthorVisible.Presenter do
  @moduledoc """
  作者可见字段的唯一投影出口（VS-00L / 47 §2.2–§2.3）。

  作者可见面（TurnResult.assistant_message、通知、确认/取消文案、工作过程
  summary、Why 面板、状态行）只允许经由本模块把内部事实投影成作者可读文本。
  内部 code（tool/capability/provider/model/status/reason）由
  `NovelCommon.AuthorVisible.Display` 统一映射；未登记 code 返回作者安全兜底文案，
  **绝不把内部 code 直接展示给作者**。

  新增作者可见输出时优先扩展本模块，而不是在调用点拼字符串模板。
  """

  alias NovelCommon.AuthorVisible.Display
  alias NovelCommon.AuthorVisible.Text

  @doc """
  目标 ref / tool code / capability code → 作者可读操作名。

  优先按 tool 域映射，其次 capability 域；未登记（如 artifact ref）返回兜底文案。
  """
  @spec operation_label(term()) :: Text.t()
  def operation_label(ref) when is_binary(ref) and ref != "" do
    cond do
      Display.known?(:tool, ref) -> Text.from_display(:tool, ref)
      Display.known?(:capability, ref) -> Text.from_display(:capability, ref)
      true -> Text.new(Display.fallback(:tool))
    end
  end

  def operation_label(_ref), do: Text.new("本轮操作")

  @doc "`operation_label/1` 的字符串形式（写 wire 时使用）。"
  @spec operation_label_text(term()) :: String.t()
  def operation_label_text(ref), do: ref |> operation_label() |> Text.text()

  @doc """
  provider/model → 作者可读状态字段（additive）。

  调用方保留内部 `provider`/`model` 字段给日志与诊断；作者可见面只消费
  `provider_display_name` / `model_display_name`。
  """
  @spec provider_status(term(), term()) :: %{
          provider_display_name: String.t(),
          model_display_name: String.t()
        }
  def provider_status(provider, model) do
    %{
      provider_display_name: Display.label(:provider, provider),
      model_display_name: model_display_name(model)
    }
  end

  @doc "reason code → 作者可读的一行（Why 面板）。"
  @spec why_line(term()) :: String.t()
  def why_line(reason_code), do: Text.text(Text.from_display(:reason_code, reason_code))

  @doc "frame_type / decision 等枚举 → 作者可读标签。"
  @spec frame_label(term()) :: String.t()
  def frame_label(frame_type), do: Text.text(Text.from_display(:frame_type, frame_type))

  defp model_display_name(model) do
    if Display.known?(:model, model) do
      Display.label(:model, model)
    else
      Display.fallback(:model)
    end
  end
end
