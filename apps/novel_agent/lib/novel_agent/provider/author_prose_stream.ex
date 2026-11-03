defmodule NovelAgent.Provider.AuthorProseStream do
  @moduledoc """
  B71 / 双向审核：从写作类 Provider 流式 JSON 输出中提取**正文文本增量**（provider 层，供 author_content_delta）。

  写作工具的 Provider 输出是 JSON（`[{"item_id","title","body","rationale",...}]`），
  直接流式展示 JSON 对作者无意义。本模块用增量状态机扫描流式 chunk，只输出
  「第一个 `"body"` 字段字符串值」的可见文本增量——作者在生成过程中看到的是
  正文本身，而不是协议字节。

  纯函数、无 IO；对不完整/损坏输入安全降级（放弃该流，不猜内容）。
  """

  @type t :: %{
          phase: :searching | :in_body | :done | :abandoned,
          carry: binary(),
          escape: boolean()
        }

  @spec new() :: t()
  def new, do: %{phase: :searching, carry: "", escape: false}

  @doc """
  输入一个流式 chunk，返回 `{state, delta}`；`delta` 为本次新可展示的正文文本（可能为空）。
  """
  @spec feed(t(), binary()) :: {t(), binary()}
  def feed(%{phase: :done} = state, _chunk), do: {state, ""}
  def feed(%{phase: :abandoned} = state, _chunk), do: {state, ""}

  def feed(%{phase: :searching} = state, chunk) when is_binary(chunk) do
    buffer = state.carry <> chunk

    case find_body_open(buffer) do
      {:ok, rest} ->
        feed(%{state | phase: :in_body, carry: ""}, rest)

      :more ->
        # 保留尾部可能被截断的 key/冒号/引号前缀（`"body": "` 总长 < 24 字节）。
        keep = min(byte_size(buffer), 24)
        carry = binary_part(buffer, byte_size(buffer) - keep, keep)
        {%{state | carry: carry}, ""}

      :missing ->
        {%{state | carry: ""}, ""}
    end
  end

  def feed(%{phase: :in_body} = state, chunk) when is_binary(chunk) do
    scan_body(state, chunk, "")
  end

  def feed(state, _chunk), do: {state, ""}

  # 找第一个 `"body"` 键及其后的字符串起始引号。
  defp find_body_open(buffer) do
    case :binary.match(buffer, "\"body\"") do
      {pos, 6} ->
        rest = binary_part(buffer, pos + 6, byte_size(buffer) - pos - 6)

        case skip_to_string_open(rest) do
          {:ok, after_quote} -> {:ok, after_quote}
          :more -> :more
          :malformed -> :missing
        end

      :nomatch ->
        # 流可能停在 key 的任意前缀上：保留等待下一个 chunk。
        if partial_body_key?(buffer), do: :more, else: :missing
    end
  end

  defp partial_body_key?(buffer) do
    String.contains?(buffer, "\"b") or String.ends_with?(buffer, "\"")
  end

  # `"body"` 之后允许空白与 `:`；找到字符串起始引号即进入正文。
  defp skip_to_string_open(rest) do
    trimmed = String.trim_leading(rest)

    case trimmed do
      "" ->
        :more

      ":" <> after_colon ->
        after_colon
        |> String.trim_leading()
        |> case do
          "" -> :more
          "\"" <> body_start -> {:ok, body_start}
          _ -> :malformed
        end

      _ ->
        :malformed
    end
  end

  # 在正文字符串内扫描：处理转义与结束引号；输出已解转义的可见文本。
  defp scan_body(%{phase: :in_body} = state, chunk, acc) do
    case next_char(chunk) do
      :eof ->
        {%{state | carry: ""}, acc}

      {char, rest} ->
        cond do
          state.escape ->
            scan_body(%{state | escape: false}, rest, acc <> unescape(char))

          char == "\\" ->
            scan_body(%{state | escape: true}, rest, acc)

          char == "\"" ->
            {%{state | phase: :done, carry: ""}, acc}

          true ->
            scan_body(state, rest, acc <> char)
        end
    end
  end

  defp next_char(<<char::utf8, rest::binary>>), do: {<<char::utf8>>, rest}
  defp next_char(<<>>), do: :eof

  defp unescape("\""), do: "\""
  defp unescape("\\"), do: "\\"
  defp unescape("/"), do: "/"
  defp unescape("b"), do: "\b"
  defp unescape("f"), do: "\f"
  defp unescape("n"), do: "\n"
  defp unescape("r"), do: "\r"
  defp unescape("t"), do: "\t"
  defp unescape("u"), do: ""  # \uXXXX 罕见：正文流宁可少显示，不猜编码
  defp unescape(other), do: other
end
