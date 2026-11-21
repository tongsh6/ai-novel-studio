defmodule NovelTest.TestProviderPrompt do
  @moduledoc """
  仅测试支持：从 canonical Request IR 或真实非 IR 请求文本读取离线替身需要的材料。

  只读实际请求，不做桥接归一化：

  - `%RequestIR{}`：直接读 canonical `role/provenance/blocks`，提供文本、当前 scope、
    作者原字节与当前操作消息。
  - 普通 binary / Gateway 注入后的真实 system/user message list：只读实际
    `role/content` 文本，不解释旧 `application_base` / `scope_update` 标记，
    不把原生工具历史字符串解析成结构化观察，也不合成 provenance/blocks。

  工具事实由 `NovelCommon.RequestIR.Tools` 读取，本模块不复制工具投影。
  """

  alias NovelCommon.RequestIR
  alias NovelCommon.RequestIR.SystemEnvelope
  alias NovelCommon.SystemIdentity

  @author_section ~r/##\s*作者输入\s*\n(.*?)(?:\n##|\z)/su

  @type prompt :: String.t() | RequestIR.t() | [map()] | %{optional(atom()) => term()}

  @doc "完整请求文本视图；canonical 作者消息保留在末尾的作者输入段。"
  @spec text(prompt()) :: String.t()
  def text(prompt) when is_binary(prompt), do: prompt

  # 完整请求文本视图包含稳定 system 前缀（身份/版本/run 角色规则）与 canonical 消息；
  # 规则进入 system 后（VS-00L §3.2，2026-11-06 裁决 A），断言仍需读到同一请求的实际文本。
  def text(%RequestIR{} = ir) do
    [SystemEnvelope.system_text(ir.system), canonical_text(ir.messages)]
    |> Enum.reject(&(&1 == ""))
    |> Enum.join("\n\n")
  end

  def text(prompt) when is_list(prompt) or is_map(prompt), do: wire_text(prompt)
  def text(_prompt), do: ""

  @doc "当前操作材料；已有模型响应时只取最新 canonical scope。非 IR 请求只有实际文本。"
  @spec operation_text(prompt()) :: String.t()
  def operation_text(prompt) when is_binary(prompt), do: prompt

  def operation_text(%RequestIR{messages: messages}) do
    case last_index(messages, &canonical_scope?/1) do
      nil ->
        canonical_text(messages)

      index ->
        scope = Enum.at(messages, index)
        previous = Enum.take(messages, index)

        if Enum.any?(previous, &(&1.role == "assistant")) do
          canonical_text_of(scope)
        else
          canonical_text(previous ++ [scope])
        end
    end
  end

  def operation_text(prompt) when is_list(prompt) or is_map(prompt), do: wire_text(prompt)
  def operation_text(_prompt), do: ""

  @doc "最新 canonical Scope 的通用文本视图；结构字段以实际 JSON 表示，不重建旧段落协议。"
  @spec latest_scope(prompt()) :: String.t() | nil
  def latest_scope(%RequestIR{messages: messages}) do
    case last_index(messages, &canonical_scope?/1) do
      nil -> nil
      index -> messages |> Enum.at(index) |> canonical_text_of()
    end
  end

  def latest_scope(_prompt), do: nil

  @doc "读取最新 canonical Scope 的原生内容；历史文本和非 IR 请求不升级为结构事实。"
  @spec scope_content(prompt()) :: map() | nil
  def scope_content(%RequestIR{messages: messages}) do
    case messages |> Enum.filter(&canonical_scope?/1) |> List.last() do
      %{blocks: [%{type: "scope", content: content}]} when is_map(content) -> content
      _ -> nil
    end
  end

  def scope_content(_prompt), do: nil

  @doc "最后一个 canonical 作者消息的原始文本字节；非 IR 请求没有 provenance，返回空。"
  @spec author_text(prompt()) :: String.t()
  def author_text(prompt) when is_binary(prompt) do
    case Regex.run(@author_section, prompt) do
      [_, section] -> String.trim(section)
      _ -> ""
    end
  end

  def author_text(%RequestIR{messages: messages}) do
    messages
    |> Enum.filter(&canonical_author?/1)
    |> List.last()
    |> case do
      nil -> ""
      message -> canonical_text_of(message)
    end
  end

  def author_text(_prompt), do: ""

  @doc "按显式来源定位唯一 canonical 作者消息；缺失、重复或非 IR 输入不猜测原文。"
  @spec author_text(prompt(), String.t()) :: String.t()
  def author_text(%RequestIR{messages: messages}, ref) when is_binary(ref) and ref != "" do
    matches =
      Enum.filter(messages, fn message ->
        canonical_author?(message) and
          Enum.any?(Map.get(message, :source_refs, []), fn
            %{ref: ^ref} -> true
            %{"ref" => ^ref} -> true
            ^ref -> true
            _ -> false
          end)
      end)

    case matches do
      [message] -> canonical_text_of(message)
      _ -> ""
    end
  end

  def author_text(_prompt, _ref), do: ""

  @doc "最新 canonical scope 之后的实际消息；非 IR 请求没有 canonical 历史，返回空列表。"
  @spec current_operation_messages(prompt()) :: [map()]
  def current_operation_messages(%RequestIR{messages: messages}) do
    case last_index(messages, &canonical_scope?/1) do
      nil -> []
      index -> Enum.drop(messages, index + 1)
    end
  end

  def current_operation_messages(_prompt), do: []

  @doc "读取当前操作中同名工具调用的失败校验；不从其它调用、旧 scope 或非 IR 文本推断。"
  @spec failed_tool_call_in_current_operation?(prompt(), String.t()) :: boolean()
  def failed_tool_call_in_current_operation?(prompt, tool) do
    blocks =
      prompt
      |> current_operation_messages()
      |> Enum.flat_map(& &1.blocks)

    call_ids =
      for %{type: "tool_call", name: ^tool, call_id: call_id} <- blocks,
          do: call_id

    Enum.any?(blocks, fn
      %{type: "validation_result", status: "failed", call_id: call_id} ->
        call_id in call_ids

      _ ->
        false
    end)
  end

  @doc "本次实际可见 canonical 工具观察叶；沿唯一 Compaction 投影，不从 refs 或文字反推。"
  @spec visible_observations(prompt()) :: [map()]
  def visible_observations(%RequestIR{} = request), do: RequestIR.visible_observations(request)

  def visible_observations(_prompt), do: []

  # ── canonical 分支 ──────────────────────────────────────────────────────

  defp canonical_text(messages) do
    case last_index(messages, &canonical_author?/1) do
      nil ->
        render_canonical(messages)

      index ->
        author = messages |> Enum.at(index) |> canonical_text_of()
        inline = List.delete_at(messages, index)
        render_canonical(inline) <> "\n## 作者输入\n" <> author
    end
  end

  defp render_canonical(messages), do: Enum.map_join(messages, "\n", &render_canonical_message/1)

  defp render_canonical_message(%{role: "application_base"} = message),
    do: "user: 【应用数据 · application_base】\n" <> canonical_text_of(message)

  defp render_canonical_message(%{role: "scope_update"} = message),
    do: "user: 【应用数据 · scope_update】\n" <> canonical_text_of(message)

  defp render_canonical_message(%{role: "application_notice"} = message),
    do: "user: 【应用数据 · application_notice】\n" <> canonical_text_of(message)

  defp render_canonical_message(%{role: "checkpoint"} = message),
    do: "user: 【应用数据 · checkpoint】\n" <> canonical_text_of(message)

  defp render_canonical_message(%{role: "tool"} = message), do: render_canonical_tool(message)
  defp render_canonical_message(message), do: "#{message.role}: #{canonical_text_of(message)}"

  defp render_canonical_tool(message) do
    message.blocks
    |> Enum.with_index(1)
    |> Enum.flat_map(fn
      {%{type: "observation"} = block, index} -> [observation_text(block, index)]
      {%{type: "validation_result"} = block, _index} -> [Jason.encode!(block)]
      {%{type: "text", text: text}, _index} when is_binary(text) -> [text]
      {_block, _index} -> []
    end)
    |> Enum.map_join("\n", &("tool: " <> &1))
  end

  defp observation_text(block, index) do
    content = Map.get(block, :content) || %{}
    coverage = Map.get(block, :coverage) || %{}
    tool = Map.get(content, "tool") || ""
    query = Map.get(content, "query") || ""
    summary = Map.get(content, "summary") || ""

    "## 探索观察（原生 tool 结果）\n### 观察 #{index}（#{tool}「#{query}」）\n#{summary}" <>
      to_string(Map.get(content, "coverage_note") || Map.get(coverage, "coverage_note")) <>
      to_string(Map.get(content, "continuation_hint") || Map.get(coverage, "continuation_hint"))
  end

  defp canonical_text_of(%{blocks: blocks}) do
    blocks
    |> Enum.flat_map(fn
      %{type: "text", text: text} when is_binary(text) -> [text]
      %{type: "scope", content: content} when is_map(content) -> [Jason.encode!(content)]
      _block -> []
    end)
    |> Enum.join("")
  end

  defp canonical_author?(%{role: "user", provenance: "author"}), do: true
  defp canonical_author?(_message), do: false

  defp canonical_scope?(%{role: "scope_update", provenance: "application"}), do: true
  defp canonical_scope?(_message), do: false

  # ── 真实非 IR 文本分支（只读实际 role/content）─────────────────────────────

  defp wire_text(prompt) do
    prompt
    |> wire_messages()
    |> Enum.reject(&(wire_field(&1, :content) == SystemIdentity.content()))
    |> Enum.flat_map(&wire_message_line/1)
    |> Enum.join("\n")
  end

  defp wire_messages(%{messages: messages}) when is_list(messages), do: messages
  defp wire_messages(messages) when is_list(messages), do: messages
  defp wire_messages(_prompt), do: []

  defp wire_message_line(message) do
    case {wire_field(message, :role), wire_field(message, :content)} do
      {role, content} when is_binary(role) and is_binary(content) -> ["#{role}: #{content}"]
      _ -> []
    end
  end

  defp wire_field(message, key) do
    Map.get(message, key) || Map.get(message, to_string(key))
  end

  defp last_index(messages, predicate) do
    messages
    |> Enum.with_index()
    |> Enum.reverse()
    |> Enum.find_value(fn {message, index} ->
      if predicate.(message), do: index
    end)
  end
end
