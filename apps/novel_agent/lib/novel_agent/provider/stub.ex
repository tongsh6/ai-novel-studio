defmodule NovelAgent.Provider.Stub do
  @moduledoc """
  Stub provider — 离线/骨架验证用的合法 fixture provider。

  根据 08-provider-abstraction.md §2.4，stub 是正式 provider 实现，用于：
  - greenfield 开发期间离线验证
  - 契约测试（contract test）
  - Provider Gateway 骨架调试

  ## 响应策略

  stub 不调用任何外部 LLM。它根据 prompt 中显式声明的"输出格式契约"识别
  请求类型（frame / plan / creative items），返回对应的最小合法 JSON。
  识别失败时回退为 echo 响应。

  creative items prompt 的响应同时满足：
  - **I3 种子贯通**：保留 user 输入文本中的随机标识符，让它们自然出现在 artifact
  - **I2 输入差异**：`item_id` 从 user input 派生 fingerprint，保证不同输入产生
    不同 id（两两不相交）

  此处持有的 JSON 字面量是 schema 的最小契约样本（contract skeleton，
  不是作品内容），属于 `docs/engineering/scenario-invariants.md` §4 允许
  的字符串字面量。
  """

  @behaviour NovelAgent.Provider

  alias NovelAgent.Provider.Result

  defstruct []

  @type t :: %__MODULE__{}

  @impl true
  def complete(_state, _model, prompt, _params) do
    text = prompt_text(prompt)
    {:ok, Result.new(infer_response(text))}
  end

  @impl true
  def name, do: "stub"

  @impl true
  def health_check(_state), do: :ok

  # ── prompt 识别 ──

  defp infer_response(text) do
    cond do
      creative_items_prompt?(text) -> creative_items_json(text)
      plan_prompt?(text) -> plan_json()
      frame_prompt?(text) -> frame_json(text)
      true -> "[stub] echo: " <> text
    end
  end

  defp creative_items_prompt?(text) do
    String.contains?(text, "JSON 数组") and String.contains?(text, "artifact_type：")
  end

  defp plan_prompt?(text) do
    String.contains?(text, "plan_goal_summary") and String.contains?(text, "proposed_actions")
  end

  defp frame_prompt?(text) do
    String.contains?(text, "frame_type") and String.contains?(text, "assistant_message")
  end

  # ── 最小合法响应 ──

  # creative items：生成产品形态的最小 fixture 内容，并保留 user 输入中的
  # 随机标识符（nonce），避免离线 provider 在 UI 中泄漏 prompt/context heading。
  # item_id 从 user input 派生 fingerprint，保证不同输入产生不同 id
  # （I2 不变量：N 个语义独立输入的 item_id 集合两两不相交）。
  defp creative_items_json(prompt_text) do
    {brief, context} = extract_creative_parts(prompt_text)
    user_excerpt = [brief, context] |> Enum.reject(&(&1 == "")) |> Enum.join("\n")
    fp = input_fingerprint(user_excerpt)

    Jason.encode!([
      %{
        "item_id" => "stub_item_" <> fp <> "_1",
        "title" => stub_creative_title(brief, fp),
        "body" => stub_creative_body(brief, context),
        "rationale" => "离线 fixture provider 生成的待保存草稿，未写入作品事实。"
      }
    ])
  end

  defp input_fingerprint(text) do
    text |> :erlang.phash2() |> Integer.to_string(36)
  end

  defp plan_json do
    Jason.encode!(%{
      "plan_goal_summary" => "[stub] 调用 character_design 推进",
      "risk_hint" => "low",
      "requires_confirmation_hint" => false,
      "proposed_actions" => [
        %{
          "action_id" => "act-stub-1",
          "action_type" => "capability_invocation",
          "summary" => "[stub] 调用 character_design",
          "target_ref" => "character_design",
          "write_intent" => "tentative",
          "risk_hint" => "low"
        }
      ],
      "state_changes_requested" => [],
      "required_capabilities" => ["character_design"],
      "fallback_message" => "[stub] 无可调度行动"
    })
  end

  # frame 默认 reply-only（needs_tool=false）以兼容 reply-only 主链测试。
  # driver 通过 generate_micro_plan: true 显式强制走 plan/tool 路径。
  defp frame_json(prompt_text) do
    user_excerpt = extract_user_text(prompt_text)

    Jason.encode!(%{
      "frame_type" => "casual_reply",
      "dialogue_goal_summary" => "[stub] 收到用户输入",
      "needs_tool" => false,
      "no_tool_reason" => "no_tool_needed",
      "execution_readiness" => "not_applicable",
      "assistant_message" => "[stub] 已收到。原文：" <> user_excerpt,
      "candidate_directions" => [],
      "context_used" => context_provided?(prompt_text),
      "uncertainty" => []
    })
  end

  # 当 prompt 中 "当前作品上下文" 段落不是空标记时，认为 context 已提供。
  # 注：此处标记字符串与 plan prompt 模板隐式耦合 —
  # 如果 Planner 改了"当前作品上下文"段落或空标记文案，stub 也要同步更新。
  # 这种耦合是 fixture provider 与真实 prompt template 之间合理的契约链接。
  defp context_provided?(prompt_text) do
    String.contains?(prompt_text, "当前作品上下文") and
      not String.contains?(prompt_text, "（无——这是新对话或尚未创建作品）")
  end

  # 从 normalized prompt 中提取 user role 部分（含 nonce 等用户随机内容）
  defp extract_user_text(prompt_text) do
    case Regex.run(~r/用户创作简述：(.+?)\n\s*上下文：(.+?)\n\s*重要：/su, prompt_text) do
      [_, brief, context] ->
        [String.trim(brief), String.trim(context)]
        |> Enum.reject(&(&1 == ""))
        |> Enum.join("\n")

      _ ->
        extract_role_user_text(prompt_text)
    end
  end

  defp extract_creative_parts(prompt_text) do
    case Regex.run(~r/用户创作简述：(.+?)\n\s*上下文：(.+?)\n\s*重要：/su, prompt_text) do
      [_, brief, context] -> {String.trim(brief), String.trim(context)}
      _ -> {extract_role_user_text(prompt_text), ""}
    end
  end

  defp stub_creative_title(brief, fp) do
    case Regex.run(~r/第\d+章[：:]\s*([^。\n]+?)(?:正文草稿|$)/u, brief) do
      [_, chapter_title] -> String.trim(chapter_title) <> " 草稿"
      _ -> "离线待确认素材 " <> fp
    end
  end

  defp stub_creative_body(brief, context) do
    nonce_text =
      context
      |> random_identifier_tokens()
      |> Enum.take(3)
      |> Enum.join("、")

    nonce_sentence = if nonce_text == "", do: "", else: "校验标识 #{nonce_text} 被刻在旧终端的边框上。"

    [
      "离线草稿从作者请求出发：#{String.slice(brief, 0, 80)}。",
      "主角站在灵气账单闪烁的巷口，意识到这次欠费不是普通催缴，而是有人借系统规则逼他现身。",
      nonce_sentence,
      "他收起最后一张护身符，沿着停电的楼梯向下走，准备在巡检车抵达前找到账单背后的漏洞。"
    ]
    |> Enum.reject(&(&1 == ""))
    |> Enum.join("\n")
  end

  defp random_identifier_tokens(text) do
    ~r/\b(?=[A-Za-z0-9]*\d)(?=[A-Za-z0-9]*[A-Za-z])[A-Za-z0-9]{6,}\b/u
    |> Regex.scan(text)
    |> Enum.map(fn [token] -> token end)
    |> Enum.uniq()
  end

  defp extract_role_user_text(prompt_text) do
    case Regex.run(~r/user:\s*(.+?)(?:\n[a-z_]+:|\z)/su, prompt_text) do
      [_, text] -> String.trim(text)
      _ -> prompt_text |> String.slice(-200, 200) |> String.trim()
    end
  end

  # ── prompt 归一化 ──

  defp prompt_text(prompt) when is_binary(prompt), do: prompt

  defp prompt_text(prompt) when is_list(prompt) do
    prompt
    |> NovelAgent.Provider.normalize_messages()
    |> Enum.map_join("\n", fn message -> "#{message.role}: #{message.content}" end)
  end
end
