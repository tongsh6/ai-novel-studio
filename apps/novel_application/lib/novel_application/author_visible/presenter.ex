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
  `provider_display_name` / `model_display_name`（模型名不可证时为 nil）。
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

  @doc """
  作者确认动作文案（确认卡 / 对话动作回执）。

  目标显示名经 operation_label/1（SSOT tool/capability 域）；未登记目标走兜底，
  不回显内部 ref/tool code。
  """
  @spec confirmed_action_message(term()) :: String.t()
  def confirmed_action_message(target_ref) do
    "已确认「#{operation_label_text(target_ref)}」操作，正在作为新的作者动作运行处理；" <>
      "确认本身不表示工具或目标已经成功。"
  end

  @doc "作者取消等待文案（无目标时用中性「这项操作」）。"
  @spec cancelled_action_message(term()) :: String.t()
  def cancelled_action_message(nil),
    do: "已取消等待；这项操作不会执行，也没有写入作品事实。"

  def cancelled_action_message(""),
    do: "已取消等待；这项操作不会执行，也没有写入作品事实。"

  def cancelled_action_message(target_ref) do
    "已取消等待；「#{operation_label_text(target_ref)}」不会执行，也没有写入作品事实。"
  end

  @doc """
  确认卡「确认对象」显示名。

  已登记 tool/capability 返回作者显示名；未知/缺失 ref 用中性文案，
  绝不回显内部 ref。
  """
  @spec confirmation_target(term()) :: String.t()
  def confirmation_target(ref) when is_binary(ref) and ref != "" do
    if Display.known?(:tool, ref) or Display.known?(:capability, ref) do
      operation_label_text(ref)
    else
      "本轮待确认操作"
    end
  end

  def confirmation_target(_ref), do: "本轮待确认操作"

  @doc """
  provider health metadata → 追加作者可见 display 字段（additive）。

  内部 provider/model 字段保留给日志与诊断；作者面只消费 display 字段。
  """
  @spec provider_health_metadata(map()) :: map()
  def provider_health_metadata(metadata) when is_map(metadata) do
    Map.merge(metadata, provider_status(Map.get(metadata, :provider), Map.get(metadata, :model)))
  end

  @doc "provider options → 每个 provider 追加作者可读 display_name。"
  @spec provider_options(map()) :: map()
  def provider_options(%{providers: providers} = options) do
    providers =
      Enum.map(providers, fn provider ->
        Map.put(provider, :display_name, Display.label(:provider, Map.get(provider, :id)))
      end)

    %{options | providers: providers}
  end

  @doc "工具/能力 code → 作者可读名（作者可见阶段 summary 等使用）。"
  @spec tool_label(term()) :: String.t()
  def tool_label(code), do: operation_label_text(code)

  @doc "Orchestrator decision_type → 作者可读名。"
  @spec decision_label(term()) :: String.t()
  def decision_label(decision_type),
    do: Text.text(Text.from_display(:decision, decision_type))

  @doc "计划步骤被系统裁决阻止时的作者摘要（工作过程面板）。"
  @spec blocked_summary(term(), term()) :: String.t()
  def blocked_summary(tool_code, decision_type) do
    "系统未允许执行「#{tool_label(tool_code)}」：#{decision_label(decision_type)}。"
  end

  @doc "工具执行失败后的作者摘要。"
  @spec tool_failure_summary(term()) :: String.t()
  def tool_failure_summary(tool_code) do
    "「#{tool_label(tool_code)}」执行失败，先修订计划再决定后续动作。"
  end

  @doc "被阻止步骤的作者目标说明。"
  @spec blocked_step_goal(term()) :: String.t()
  def blocked_step_goal(tool_code), do: "系统裁决未允许执行「#{tool_label(tool_code)}」"

  @doc "计划步骤开始时的作者摘要。"
  @spec plan_step_summary(term()) :: String.t()
  def plan_step_summary(tool_code), do: "正在执行计划步骤：#{tool_label(tool_code)}。"

  @doc """
  错误码 → 作者可读提示（SSOT error_code 域；未登记码走兜底，不回显内部 code）。
  """
  @spec error_label(term()) :: String.t()
  def error_label(error_code), do: Text.text(Text.from_display(:error_code, error_code))

  @doc "reason code → 作者可读的一行（Why 面板）。"
  @spec why_line(term()) :: String.t()
  def why_line(reason_code), do: Text.text(Text.from_display(:reason_code, reason_code))

  @doc "frame_type / decision 等枚举 → 作者可读标签。"
  @spec frame_label(term()) :: String.t()
  def frame_label(frame_type), do: Text.text(Text.from_display(:frame_type, frame_type))

  # 未登记/缺失模型名返回 nil：作者面由前端决定显示一次中性的「当前模型」，
  # 避免「当前模型：当前模型」这类拼接重复。
  defp model_display_name(model) do
    if Display.known?(:model, model), do: Display.label(:model, model), else: nil
  end
end
