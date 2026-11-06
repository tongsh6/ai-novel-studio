defmodule NovelTest.TestRequestIR do
  @moduledoc """
  仅测试支持：构造 canonical Request IR 测试夹具，不经过 Chat 投影。

  测试需要直接断言 `role/provenance/blocks` 的可读构造器；生产代码不得依赖。
  依赖只有 canonical 契约（`NovelCommon.RequestIR`），不依赖任何生产 app 运行时。
  """

  alias NovelCommon.RequestIR

  @type message :: map()

  @spec base(String.t()) :: message()
  def base(text) when is_binary(text) do
    RequestIR.message(:application_base, :application, [RequestIR.text_block(text)])
  end

  @spec system(String.t()) :: message()
  def system(text) when is_binary(text) do
    RequestIR.message(:system, :application, [RequestIR.text_block(text)])
  end

  @spec scope(String.t(), map()) :: message()
  def scope(text, versions \\ %{}) when is_binary(text) do
    RequestIR.message(:scope_update, :application, [RequestIR.text_block(text)], %{
      versions: versions
    })
  end

  @spec author(String.t(), String.t()) :: message()
  def author(text, ref \\ "author_turn:current") when is_binary(text) do
    RequestIR.message(:user, :author, [RequestIR.text_block(text)], %{
      source_refs: [%{ref: ref}]
    })
  end

  @spec assistant(String.t(), [map()]) :: message()
  def assistant(text, tool_calls \\ []) when is_binary(text) do
    blocks =
      case {text, tool_calls} do
        {"", []} -> []
        {"", calls} -> calls
        {value, calls} -> [RequestIR.text_block(value) | calls]
      end

    RequestIR.message(:assistant, :model, blocks)
  end

  @spec notice(String.t()) :: message()
  def notice(text) when is_binary(text) do
    RequestIR.message(:application_notice, :application, [RequestIR.text_block(text)])
  end

  @spec tool_call(String.t(), map(), String.t()) :: map()
  def tool_call(name, arguments \\ %{}, call_id) do
    RequestIR.tool_call_block(name, arguments, call_id)
  end

  @spec observation(String.t(), map()) :: message()
  def observation(call_id, payload) when is_binary(call_id) and is_map(payload) do
    RequestIR.message(:tool, :tool_result, [RequestIR.observation_block(call_id, payload)])
  end

  @spec validation(String.t(), String.t(), String.t(), map()) :: message()
  def validation(call_id, status, reason_code, detail \\ %{}) do
    RequestIR.message(
      :tool,
      :tool_result,
      [RequestIR.validation_result_block(call_id, status, reason_code, detail)]
    )
  end

  @spec tool(String.t(), map()) :: map()
  def tool(name, input_schema \\ %{type: "object"}) when is_binary(name) do
    %{name: name, description: "", input_schema: input_schema}
  end

  @spec ir([message()], keyword()) :: RequestIR.t()
  def ir(messages, opts \\ []) do
    RequestIR.new(%{
      run: Keyword.get(opts, :run, %{run_id: "test-run"}),
      system: Keyword.get(opts, :system, RequestIR.system_envelope()),
      messages: messages,
      tools: Keyword.get(opts, :tools, []),
      projection: Keyword.get(opts, :projection, %{}),
      refs: Keyword.get(opts, :refs, %{})
    })
  end

  @doc "在指定消息的文本块追加内容，保留其余 canonical 字段。"
  @spec append_message_text(RequestIR.t(), non_neg_integer(), String.t()) :: RequestIR.t()
  def append_message_text(%RequestIR{messages: messages} = ir, index, suffix)
      when is_integer(index) and is_binary(suffix) do
    messages =
      List.update_at(messages, index, fn message ->
        %{
          message
          | blocks:
              Enum.map(message.blocks, fn
                %{type: "text", text: text} = block -> %{block | text: text <> suffix}
                block -> block
              end)
        }
      end)

    %{ir | messages: messages}
  end

  @doc "替换指定消息的文本块内容，保留其余 canonical 字段。"
  @spec put_message_text(RequestIR.t(), non_neg_integer(), String.t()) :: RequestIR.t()
  def put_message_text(%RequestIR{messages: messages} = ir, index, text)
      when is_integer(index) and is_binary(text) do
    messages =
      List.update_at(messages, index, fn message ->
        blocks =
          Enum.map(message.blocks, fn
            %{type: "text"} = block -> %{block | text: text}
            block -> block
          end)

        %{message | blocks: blocks}
      end)

    %{ir | messages: messages}
  end
end
