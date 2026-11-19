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

  @doc "同批已绑定角色事实 → 候选卡标题与中文差异；不改写采纳 payload。"
  @spec character_profile_candidate(map(), map(), [map()]) ::
          {:ok, %{title: String.t(), body: String.t()}} | {:error, atom()}
  def character_profile_candidate(
        %{
          character_ref: ref,
          character_name: name,
          base_fingerprint: fingerprint,
          changes: [%{field: "narrative_role", old: old, new: new}],
          other_character_changes: [],
          suggested_other_character_changes: suggestions
        },
        %{character_ref: ref, name: name, base_fingerprint: fingerprint, narrative_role: old} =
          target,
        roster
      )
      when is_list(roster) and is_list(suggestions) do
    with {:ok, label} <- character_label(target, roster),
         {:ok, old_label} <- narrative_role_label(old),
         {:ok, new_label} <- narrative_role_label(new),
         {:ok, others} <- other_character_labels(suggestions, roster) do
      body = "- 叙事身份：#{old_label} → #{new_label}\n\n候选尚未采纳，角色档案尚未修改。"

      body =
        if others == [],
          do: body,
          else: body <> "\n\n其它角色（需作者逐项裁决，未默认应用）：\n" <> Enum.join(others, "\n")

      {:ok, %{title: "#{label} · 叙事身份修订", body: body}}
    end
  end

  def character_profile_candidate(_payload, _target, _roster), do: {:error, :stale_base}

  @doc "已绑定的无变化事实 → 独立系统通告；模型说明由原调用方保留。"
  @spec character_profile_no_change(map(), map(), [map()]) ::
          {:ok, String.t()} | {:error, atom()}
  def character_profile_no_change(
        %{character_ref: ref, character_name: name, old_role: role, desired_role: role},
        %{character_ref: ref, name: name, narrative_role: role} = target,
        roster
      )
      when is_list(roster) do
    with {:ok, label} <- character_label(target, roster),
         {:ok, role_label} <- narrative_role_label(role) do
      {:ok, "#{label} 当前已是#{role_label}，本次无需修改；角色档案未发生变更。"}
    end
  end

  def character_profile_no_change(_facts, _target, _roster), do: {:error, :stale_base}

  defp character_label(target, roster) do
    with {:ok, ^target} <- roster_target(target.character_ref, roster),
         {:ok, label} <- character_identity(target) do
      if Enum.count(roster, &(character_identity(&1) == {:ok, label})) == 1,
        do: {:ok, label},
        else: {:error, :display_identity_ambiguous}
    else
      {:ok, _changed_target} -> {:error, :stale_base}
      {:error, _} = error -> error
    end
  end

  defp roster_target(ref, roster) do
    case Enum.filter(roster, &(Map.get(&1, :character_ref) == ref)) do
      [target] -> {:ok, target}
      [] -> {:error, :display_target_missing}
      _ -> {:error, :display_identity_ambiguous}
    end
  end

  defp character_identity(%{
         name: name,
         aliases: aliases,
         role: role,
         narrative_role: narrative_role
       })
       when is_binary(name) and name != "" and is_list(aliases) do
    with true <- Enum.all?(aliases, &is_binary/1),
         name when name != "" <- character_identity_text(name),
         {:ok, role_label} <- narrative_role_label(narrative_role) do
      aliases =
        aliases
        |> Enum.map(&character_identity_text/1)
        |> Enum.reject(&(&1 == ""))
        |> Enum.uniq()
        |> Enum.sort()
        |> Enum.join("、")

      details =
        optional_character_detail("别名", aliases) ++
          optional_character_detail("身份", role) ++ ["当前：#{role_label}"]

      {:ok, "#{name}（#{Enum.join(details, "；")}）"}
    else
      invalid when invalid in [false, ""] -> {:error, :display_target_missing}
      {:error, _} = error -> error
    end
  end

  defp character_identity(_target), do: {:error, :display_target_missing}

  # 身份在卡片中按 HTML normal 显示；资格判定必须比较同一可见投影。
  # 仅折叠 ASCII 可折叠空白，不改写事实或不换行空格等可见身份材料。
  defp character_identity_text(text) do
    text |> String.replace(~r/[ \t\n\r\f]+/, " ") |> String.trim(" ")
  end

  defp optional_character_detail(_title, nil), do: []

  defp optional_character_detail(title, value) when is_binary(value) do
    case character_identity_text(value) do
      "" -> []
      text -> ["#{title}：#{text}"]
    end
  end

  defp narrative_role_label(nil), do: {:ok, "未设置"}

  defp narrative_role_label(role) do
    if Display.known?(:narrative_role, role),
      do: {:ok, Display.label(:narrative_role, role)},
      else: {:error, :invalid_character_role}
  end

  defp other_character_labels(suggestions, roster) do
    Enum.reduce_while(suggestions, {:ok, []}, fn suggestion, {:ok, labels} ->
      with {:ok, character} <- roster_target(suggestion.character_ref, roster),
           true <-
             character.name == suggestion.character_name and
               character.narrative_role == suggestion.current_narrative_role,
           {:ok, label} <- character_label(character, roster) do
        {:cont, {:ok, ["- #{label}；未自动修改" | labels]}}
      else
        false -> {:halt, {:error, :stale_base}}
        {:error, _} = error -> {:halt, error}
      end
    end)
    |> case do
      {:ok, labels} -> {:ok, Enum.reverse(labels)}
      {:error, _} = error -> error
    end
  end

  # 未登记/缺失模型名返回 nil：作者面由前端决定显示一次中性的「当前模型」，
  # 避免「当前模型：当前模型」这类拼接重复。
  defp model_display_name(model) do
    if Display.known?(:model, model), do: Display.label(:model, model), else: nil
  end
end
