defmodule NovelAgent.Provider.AuthorProseStreamTest do
  use ExUnit.Case, async: true

  alias NovelAgent.Provider.AuthorProseStream

  defp collect(chunks) do
    {state, deltas} =
      Enum.reduce(chunks, {AuthorProseStream.new(), []}, fn chunk, {state, deltas} ->
        {next_state, delta} = AuthorProseStream.feed(state, chunk)
        {next_state, [delta | deltas]}
      end)

    {state, deltas |> Enum.reverse() |> Enum.join()}
  end

  test "extracts the first body string from a complete JSON array" do
    json = ~s([{"item_id":"a1","title":"开篇","body":"雨夜里，灯楼忽明忽暗。","rationale":"契合氛围"}])

    assert {%{phase: :done}, "雨夜里，灯楼忽明忽暗。"} = collect([json])
  end

  test "reassembles body text split across arbitrary chunk boundaries" do
    json = ~s([{"body":"第一段。第二段。","title":"x"}])
    chunks = String.graphemes(json)

    assert {_, "第一段。第二段。"} = collect(chunks)
  end

  test "emits visible deltas while streaming (prefix grows)" do
    {state, delta} = AuthorProseStream.feed(AuthorProseStream.new(), ~s([{"body":"hello ))
    assert delta == "hello "

    {state, delta} = AuthorProseStream.feed(state, "world\"}")
    assert delta == "world"
    assert state.phase == :done
  end

  test "handles escaped quotes and newlines" do
    json = ~s([{"body":"他说：\\"别动。\\"\\n然后转身。","title":"x"}])
    assert {_, "他说：\"别动。\"\n然后转身。"} = collect([json])
  end

  test "stops at body end and ignores trailing fields" do
    json = ~s([{"body":"正文","rationale":"包含 body 字样也不该混入"}])
    assert {_, "正文"} = collect([json])
  end

  test "ignores the word body outside a key (no false open)" do
    json = ~s([{"title":"body 不是键","rationale":"x"}])
    assert {%{phase: :searching}, _} = collect([json])
  end

  test "decodes JSON \\uXXXX escapes to real characters (never hex residue)" do
    json = ~s([{"body":"\\u4e2d\\u6587预览"}])
    assert {_, "中文预览"} = collect([json])
  end

  test "decodes \\uXXXX split across chunk boundaries" do
    json = ~s([{"body":"\\u4e2d\\u6587"}])
    chunks = String.graphemes(json)
    assert {_, "中文"} = collect(chunks)
  end

  test "surrogate-pair code units never leak hex residue" do
    json = ~s([{"body":"A\\ud83d\\ude00B"}])
    assert {_, "AB"} = collect([json])
  end
end
