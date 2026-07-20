defmodule NovelAgent.Provider do
  @moduledoc """
  Provider behaviour — LLM 能力提供者的统一抽象。

  Adapter 统一接入 provider execution stream。底层供应商即使只提供 final
  response，也必须在 adapter execution boundary 物化为同一套 ProviderRun /
  ProviderEvent / ProviderOutput 事实。兼容 `complete/3` 只能消费 stream 的
  final Result；应用层不应直接把 adapter callback 当作第二套执行体系。
  """

  alias NovelAgent.Provider.AdapterExecution
  alias NovelAgent.Provider.InferenceParams
  alias NovelAgent.Provider.Result

  @type message :: %{required(:role) => String.t(), required(:content) => String.t()}
  @type tool_spec :: %{
          required(:name) => String.t(),
          required(:input_schema) => map(),
          optional(:description) => String.t()
        }
  @type tool_call :: %{
          required(:name) => String.t(),
          required(:arguments) => map(),
          optional(:id) => String.t()
        }
  @type structured_prompt :: %{
          required(:messages) => [message()],
          optional(:tools) => [tool_spec()],
          optional(:tool_choice) => String.t()
        }
  @type prompt :: String.t() | [message()] | structured_prompt()
  @type model :: String.t()
  @type model_option :: %{
          required(:id) => String.t(),
          optional(:label) => String.t(),
          optional(:owned_by) => String.t()
        }

  @type result :: {:ok, Result.t()} | {:error, reason :: term()}

  @doc """
  一次性请求并返回完整结果。

  params 为跨 provider 通用的推理参数，各 adapter 负责映射为自身 API 字段。
  该回调是 final-only adapter 的底层实现细节，不是应用层 provider 执行入口。
  """
  @callback complete(
              state :: term(),
              model :: model(),
              prompt :: prompt(),
              params :: InferenceParams.t()
            ) :: result()

  @doc """
  通过 provider execution stream 执行一次 provider 调用。

  支持底层分段事件的 adapter 可以实现该回调；final-only adapter 不实现时，
  Gateway 会通过 `NovelAgent.Provider.AdapterExecution.execute/6` 将 `complete/4`
  的终态结果投影进同一 execution stream。
  """
  @callback execute(
              state :: term(),
              model :: model() | nil,
              prompt :: prompt(),
              params :: InferenceParams.t(),
              ctx :: AdapterExecution.context()
            ) :: AdapterExecution.execution_result()

  @doc """
  轻量健康检查——不调用 LLM，不消耗 token。

  LM Studio: GET /v1/models
  Anthropic: 仅检查 API key 是否配置
  Stub: 始终 :ok
  """
  @callback health_check(state :: term()) :: :ok | {:error, term()}

  @doc """
  返回 provider 当前可用模型列表。

  云端 provider 必须实时调用供应商模型列表 API；本地 provider 调本地服务
  可见模型列表。该回调不应返回硬编码模型名。
  """
  @callback list_models(state :: term()) :: {:ok, [model_option()]} | {:error, term()}

  @doc """
  返回 provider 名称（用于日志和 audit）。
  """
  @callback name() :: String.t()

  @optional_callbacks list_models: 1, execute: 5

  @doc """
  Normalize legacy string prompts and chat prompts into OpenAI-compatible
  message maps.
  """
  @spec normalize_messages(prompt()) :: [message()]
  def normalize_messages(prompt) when is_binary(prompt), do: [%{role: "user", content: prompt}]

  def normalize_messages(%{messages: messages}), do: normalize_messages(messages)
  def normalize_messages(%{"messages" => messages}), do: normalize_messages(messages)

  def normalize_messages(messages) when is_list(messages) do
    Enum.map(messages, fn message ->
      role = Map.get(message, :role) || Map.get(message, "role")
      content = Map.get(message, :content) || Map.get(message, "content")

      %{role: to_string(role || "user"), content: to_string(content || "")}
    end)
  end

  @spec supported_prompt?(term()) :: boolean()
  def supported_prompt?(prompt) when is_binary(prompt) or is_list(prompt), do: true
  def supported_prompt?(%{messages: messages}) when is_list(messages), do: true
  def supported_prompt?(%{"messages" => messages}) when is_list(messages), do: true
  def supported_prompt?(_prompt), do: false

  @spec tool_call_prompt?(prompt()) :: boolean()
  def tool_call_prompt?(prompt), do: tool_specs(prompt) != []

  @spec tool_specs(prompt()) :: [tool_spec()]
  def tool_specs(prompt) do
    prompt
    |> map_get(:tools)
    |> normalize_tool_specs()
  end

  @spec tool_choice(prompt()) :: String.t() | nil
  def tool_choice(prompt) do
    case map_get(prompt, :tool_choice) do
      value when is_binary(value) and value != "" -> value
      %{name: value} when is_binary(value) and value != "" -> value
      %{"name" => value} when is_binary(value) and value != "" -> value
      _ -> nil
    end
  end

  @spec put_openai_tools(map(), prompt()) :: map()
  def put_openai_tools(body, prompt) when is_map(body) do
    tools = Enum.map(tool_specs(prompt), &openai_tool_spec/1)

    body
    |> maybe_put(:tools, tools)
    |> maybe_put(:tool_choice, openai_tool_choice(tool_choice(prompt)))
  end

  @spec put_anthropic_tools(map(), prompt()) :: map()
  def put_anthropic_tools(body, prompt) when is_map(body) do
    tools = Enum.map(tool_specs(prompt), &anthropic_tool_spec/1)

    body
    |> maybe_put(:tools, tools)
    |> maybe_put(:tool_choice, anthropic_tool_choice(tool_choice(prompt)))
  end

  @spec extract_openai_tool_calls(map()) :: [tool_call()]
  def extract_openai_tool_calls(%{"tool_calls" => calls}) when is_list(calls) do
    Enum.flat_map(calls, &openai_tool_call/1)
  end

  def extract_openai_tool_calls(_message), do: []

  @spec extract_anthropic_tool_calls(map()) :: [tool_call()]
  def extract_anthropic_tool_calls(%{"content" => blocks}) when is_list(blocks) do
    Enum.flat_map(blocks, &anthropic_tool_call/1)
  end

  def extract_anthropic_tool_calls(_response), do: []

  # 缺陷十（2026-07-20，与缺陷九同批发现但成因独立）：写作调用现场实测抓到
  # gpt-oss-120b 采样退化——2000 token 上限内全部 1999 字符输出就是同一个字符
  # 重复（"@" 连续刷满），HTTP 200 正常返回，下游只是因为凑巧不是合法 JSON 才
  # 暴露。这与 max_tokens 无关：预算再大也只是刷更多同一个字符，任何一个
  # provider/model 都可能在退化采样下产出这种低熵内容，是内容有效性问题不是
  # 时长/预算问题，因此判定放在跨 adapter 共享层，和"内容为空"判定同一位置、
  # 同一优先级。
  @degenerate_min_length 40
  @degenerate_unique_ratio_threshold 0.05

  @spec degenerate_content?(String.t()) :: boolean()
  def degenerate_content?(content) when is_binary(content) do
    length = String.length(content)

    length >= @degenerate_min_length and
      unique_char_ratio(content, length) < @degenerate_unique_ratio_threshold
  end

  def degenerate_content?(_content), do: false

  defp unique_char_ratio(content, length) do
    unique_count =
      content
      |> String.graphemes()
      |> MapSet.new()
      |> MapSet.size()

    unique_count / length
  end

  defp normalize_tool_specs(specs) when is_list(specs) do
    Enum.flat_map(specs, fn spec ->
      name = map_get(spec, :name)
      schema = map_get(spec, :input_schema) || map_get(spec, :parameters)

      if is_binary(name) and name != "" and is_map(schema) do
        [
          %{
            name: name,
            description: to_string(map_get(spec, :description) || ""),
            input_schema: schema
          }
        ]
      else
        []
      end
    end)
  end

  defp normalize_tool_specs(_specs), do: []

  defp openai_tool_spec(%{name: name, description: description, input_schema: schema}) do
    %{
      type: "function",
      function: %{
        name: name,
        description: description,
        parameters: schema
      }
    }
  end

  defp anthropic_tool_spec(%{name: name, description: description, input_schema: schema}) do
    %{
      name: name,
      description: description,
      input_schema: schema
    }
  end

  defp openai_tool_choice(nil), do: nil

  defp openai_tool_choice(name),
    do: %{type: "function", function: %{name: name}}

  defp anthropic_tool_choice(nil), do: nil
  defp anthropic_tool_choice(name), do: %{type: "tool", name: name}

  defp openai_tool_call(%{"id" => id, "function" => %{"name" => name, "arguments" => args}})
       when is_binary(name) do
    [%{"id" => id, "name" => name, "arguments" => decode_arguments(args)}]
  end

  defp openai_tool_call(%{"function" => %{"name" => name, "arguments" => args}})
       when is_binary(name) do
    [%{"name" => name, "arguments" => decode_arguments(args)}]
  end

  defp openai_tool_call(_call), do: []

  defp anthropic_tool_call(%{"type" => "tool_use", "id" => id, "name" => name, "input" => input})
       when is_binary(name) and is_map(input) do
    [%{"id" => id, "name" => name, "arguments" => input}]
  end

  defp anthropic_tool_call(_block), do: []

  defp decode_arguments(args) when is_map(args), do: args

  defp decode_arguments(args) when is_binary(args) do
    case Jason.decode(args) do
      {:ok, decoded} when is_map(decoded) -> decoded
      _ -> %{}
    end
  end

  defp decode_arguments(_args), do: %{}

  defp map_get(map, key) when is_map(map) and is_atom(key) do
    Map.get(map, key) || Map.get(map, Atom.to_string(key))
  end

  defp map_get(_map, _key), do: nil

  defp maybe_put(map, _key, []), do: map
  defp maybe_put(map, _key, nil), do: map
  defp maybe_put(map, key, value), do: Map.put(map, key, value)

  # M2 长跑实测（2026-07-20）：正文起草 10/12 次 JSON 解析失败的具体成因——模型把
  # 多段正文塞进 JSON 字符串值时，偶发漏转义段落换行（裸 0x0A 字节），JSON 语法
  # 要求字符串内换行必须写成 \n，出现裸字节即解析失败。creative_provider/real.ex
  # 与 prose_quality_evaluator.ex 都要求模型产出"含长文本字段的 JSON"，同一风险面，
  # 收口到这里共享，而不是各自重试一次 LLM 调用（重试要多烧 60-90s 一次生成）。
  #
  # 只处理"字符串值内部的裸控制字符"：跟踪引号开合状态（尊重已有转义），只在
  # 字符串内部把裸 \n \r \t 转成合法转义序列；字符串外部的结构空白（JSON 语法本身
  # 允许 token 间换行）原样不动。对已经合法的 JSON 是纯粹的 no-op（合法 JSON 的
  # 字符串内本来就没有裸控制字符——已经是 \n 两字符序列会被转义状态机原样放行）。
  @spec repair_unescaped_control_chars(String.t()) :: String.t()
  def repair_unescaped_control_chars(content) when is_binary(content) do
    content
    |> String.graphemes()
    |> Enum.reduce({[], false, false}, &repair_char/2)
    |> elem(0)
    |> Enum.reverse()
    |> IO.iodata_to_binary()
  end

  # 已被上一个字符的反斜杠标记为"转义中"：不管这个字符是什么，原样放行，
  # 消费掉这一次转义（下一个字符恢复非转义状态）。
  defp repair_char(char, {acc, in_string?, true}), do: {[char | acc], in_string?, false}

  defp repair_char("\\", {acc, true = in_string?, false}), do: {["\\" | acc], in_string?, true}

  defp repair_char("\"", {acc, in_string?, false}), do: {["\"" | acc], not in_string?, false}

  defp repair_char("\n", {acc, true = in_string?, false}), do: {["\\n" | acc], in_string?, false}
  defp repair_char("\r", {acc, true = in_string?, false}), do: {["\\r" | acc], in_string?, false}
  defp repair_char("\t", {acc, true = in_string?, false}), do: {["\\t" | acc], in_string?, false}

  defp repair_char(char, {acc, in_string?, false}), do: {[char | acc], in_string?, false}
end
