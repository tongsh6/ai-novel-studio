defmodule NovelApplication.ChapterMissionService do
  @moduledoc """
  写前推理（WR01 / VS-00E §16）：携带材料 → 模型一次 native tool-call → `ChapterMission`。

  - 机械半边在 `NovelDomain.ChapterMissionInputs`（选取与 ref 列名），本模块只负责
    prompt、一次 `chapter_mission` 工具调用、解析、依据绑定（I-M1）与叙事绑定（I-M3）。
  - 坏结构（无工具调用 / 参数不合法 / 依据全部越界）携带原因重试一次，与计划起草器同模式。
  - 叙事优先取 content 字节；LM Studio 强制 tool_choice 下 content 为空时回退
    `arguments.author_reasoning`（`provider_output_tool_narrative` 绑定）。叙事绑定失败
    不作废使命（使命仍进简报），只是不产生作者可见叙事事件——由 flow 按 meta 决定。
  - 失败返回 `{:error, reason, meta}`，meta 带真实 `provider_call_count` 供预算核算；
    flow 按用户拍板「降级继续写」处理，本模块不做任何权威层写入（I-M2）。
  """

  alias NovelAgent.Provider.Execution
  alias NovelApplication.AgentNarrativeSource
  alias NovelDomain.ChapterMission
  alias NovelDomain.ChapterMissionInputs

  # kind（WR02）：:prose 写某章前 / :planning 规划下一批章前——两类调用点（prompt 目录
  # SSOT），工具名与锚点独立，值对象与绑定机制复用。
  @tool_names %{prose: "chapter_mission", planning: "planning_mission"}
  @prompt_anchors %{prose: "写前推理器", planning: "规划前推理器"}

  @type meta :: %{
          required(:provider_call_count) => non_neg_integer(),
          optional(:narrative) => String.t() | nil,
          optional(:narrative_source) => map() | nil,
          optional(:provider_call_ref) => String.t() | nil
        }

  @spec tool_name(:prose | :planning) :: String.t()
  def tool_name(kind \\ :prose), do: Map.fetch!(@tool_names, kind)

  @doc "prompt 锚点（测试替身按此识别推理调用；与 slice id/验收无关的真实产品语义）。"
  @spec prompt_anchor(:prose | :planning) :: String.t()
  def prompt_anchor(kind \\ :prose), do: Map.fetch!(@prompt_anchors, kind)

  @doc """
  推导本章使命。`opts[:author_text]` 为作者本轮原话（进 prompt，让使命对齐作者请求）。
  """
  @spec derive(ChapterMissionInputs.t(), Execution.dependency() | nil, keyword()) ::
          {:ok, ChapterMission.t(), meta()} | {:error, term(), meta()}
  def derive(%ChapterMissionInputs{} = inputs, provider_execution, opts \\ []) do
    kind = if Keyword.get(opts, :kind) == :planning, do: :planning, else: :prose

    case Execution.result_fn(provider_execution) do
      result_fn when is_function(result_fn, 1) ->
        prompt = mission_prompt(inputs, Keyword.get(opts, :author_text), kind)

        request(prompt, %{
          result_fn: result_fn,
          inputs: inputs,
          prompt: prompt,
          tool_name: tool_name(kind),
          attempt: 1,
          retry?: true
        })

      _ ->
        {:error, :provider_execution_missing, %{provider_call_count: 0}}
    end
  end

  @doc false
  @spec mission_prompt(ChapterMissionInputs.t(), String.t() | nil, :prose | :planning) :: map()
  def mission_prompt(%ChapterMissionInputs{} = inputs, author_text, kind \\ :prose) do
    material = ChapterMissionInputs.to_prompt_section(inputs)

    author_line =
      case clean(author_text) do
        nil -> ""
        text -> "\n作者本轮请求：#{text}\n"
      end

    content = """
    #{intro_line(kind)}

    材料（每条以 [ref] 开头，方括号内的 ref 是唯一可引用的依据标识）：

    #{material}
    #{author_line}
    要求：
    #{requirement_lines(kind)}
    - author_reasoning：对作者说的一段话（第一人称，120 字以内）：核清了什么、判断是什么、
      只动哪里。
    - 不要写正文；不要发明材料里没有的事实；不要引用材料之外的 ref。

    调用 #{tool_name(kind)} 工具返回结构，只调用这一个工具。
    """

    %{
      messages: [%{role: "user", content: content}],
      tools: [mission_tool(kind)],
      tool_choice: tool_name(kind)
    }
  end

  defp intro_line(:prose) do
    """
    你是长篇小说写作台的#{prompt_anchor(:prose)}。正文尚未开始写，请只根据下面列出的材料，
    推导「本章使命」：这一章现在必须推进什么、不得做什么。
    """
    |> String.trim()
  end

  defp intro_line(:planning) do
    """
    你是长篇小说写作台的#{prompt_anchor(:planning)}。下一批章节大纲尚未起草，请只根据下面
    列出的材料，推导「本轮规划使命」：接下来要规划的章节必须安排什么、不得安排什么。
    """
    |> String.trim()
  end

  defp requirement_lines(:prose) do
    """
    - statement：一两句话说清这一章现在该干什么。优先处理已超期或本章到期的伏笔、停滞的
      弧光、沉寂的主线、偏离的题材承诺；没有这些压力就按本章计划推进。
    - must_advance：1 到 4 条，每条 text 具体可执行，basis_ref 必须精确复制材料中方括号内
      的 ref；找不到依据的不要写。
    - must_avoid：0 到 3 条，后续章计划信息的保密与全书进度守则优先，basis_ref 同上。
    """
    |> String.trim()
  end

  defp requirement_lines(:planning) do
    """
    - statement：一两句话说清这批章要完成什么。优先给已超期或临近的伏笔安排回收、给停滞
      角色安排回归、让沉寂主线重新推进、守住题材承诺；并按全书进度控制节奏。
    - must_advance：1 到 4 条「这批章必须安排的事」，每条 text 具体可排进章计划，basis_ref
      必须精确复制材料中方括号内的 ref；找不到依据的不要写。
    - must_avoid：0 到 3 条「这批章不得安排的事」（距目标尚远不得提前收官、不得另立主导
      角色、不得提前揭示保密的计划信息等），basis_ref 同上。
    """
    |> String.trim()
  end

  @doc false
  @spec mission_tool(:prose | :planning) :: map()
  def mission_tool(kind \\ :prose) do
    item_schema = %{
      type: "object",
      required: ["text", "basis_ref"],
      additionalProperties: false,
      properties: %{
        text: %{type: "string", minLength: 1},
        basis_ref: %{type: "string", minLength: 1}
      }
    }

    %{
      name: tool_name(kind),
      description: "Return the mission derived only from the listed materials.",
      input_schema: %{
        type: "object",
        required: ["author_reasoning", "statement", "must_advance", "must_avoid", "confidence"],
        additionalProperties: false,
        properties: %{
          author_reasoning: %{type: "string", minLength: 1},
          statement: %{type: "string", minLength: 1},
          must_advance: %{type: "array", items: item_schema},
          must_avoid: %{type: "array", items: item_schema},
          confidence: %{type: "number", minimum: 0, maximum: 1}
        }
      }
    }
  end

  # ── 调用与解析 ───────────────────────────────────────

  defp request(prompt, ctx) do
    case ctx.result_fn.(prompt) do
      {:ok, provider_result} when is_map(provider_result) ->
        provider_result
        |> tool_arguments(ctx.tool_name)
        |> build_mission(provider_result, ctx)

      {:ok, content} when is_binary(content) ->
        retry_or_error(:native_tool_call_required, %{content: content}, ctx)

      {:error, reason} ->
        {:error, reason, %{provider_call_count: ctx.attempt}}

      other ->
        {:error, {:invalid_mission_result, other}, %{provider_call_count: ctx.attempt}}
    end
  end

  defp build_mission({:ok, args}, provider_result, ctx) do
    mission =
      args
      |> ChapterMission.new()
      |> Map.put(:mission_id, NovelFoundation.ID.unique("cm"))
      |> Map.put(:provider_call_ref, provider_call_ref(provider_result))
      |> ChapterMission.bind(
        ChapterMissionInputs.refs(ctx.inputs),
        &ChapterMissionInputs.label(ctx.inputs, &1)
      )

    cond do
      mission.degraded ->
        retry_or_error(:mission_unbound, provider_result, ctx)

      is_nil(mission.statement) ->
        retry_or_error(:mission_statement_required, provider_result, ctx)

      true ->
        {narrative, source} = narrative(provider_result, args, ctx.tool_name)

        {:ok, mission,
         %{
           provider_call_count: ctx.attempt,
           narrative: narrative,
           narrative_source: source,
           provider_call_ref: mission.provider_call_ref
         }}
    end
  end

  defp build_mission({:error, reason}, provider_result, ctx),
    do: retry_or_error(reason, provider_result, ctx)

  defp retry_or_error(reason, provider_result, %{retry?: true} = ctx) do
    corrected =
      correction_prompt(ctx.prompt, map_get(provider_result, :content), reason, ctx.tool_name)

    request(corrected, %{ctx | attempt: ctx.attempt + 1, retry?: false, prompt: corrected})
  end

  defp retry_or_error(reason, _provider_result, ctx),
    do: {:error, reason, %{provider_call_count: ctx.attempt}}

  defp correction_prompt(%{messages: messages} = prompt, previous_content, reason, tool_name) do
    note = """
    上一次输出无法使用（#{inspect(reason)}）。请重新调用 #{tool_name} 工具，且只调用这一个工具：
    - statement 必填；
    - must_advance / must_avoid 每条的 basis_ref 只能精确复制材料中方括号内列出的 ref，
      不得引用材料之外的标识；
    - 不要输出正文或解释性文字。
    上一次输出片段：#{previous_content |> to_string() |> String.slice(0, 400)}
    """

    %{prompt | messages: messages ++ [%{role: "user", content: note}]}
  end

  defp tool_arguments(provider_result, tool_name) do
    case map_get(provider_result, :tool_calls) do
      calls when is_list(calls) ->
        calls
        |> Enum.filter(&(map_get(&1, :name) == tool_name))
        |> case do
          [call] -> decode_arguments(map_get(call, :arguments), tool_name)
          [] -> {:error, {:native_tool_call_required, tool_name}}
          many -> {:error, {:native_tool_call_count_invalid, length(many)}}
        end

      _ ->
        {:error, :native_tool_call_required}
    end
  end

  defp decode_arguments(args, tool_name) when is_map(args),
    do: {:ok, unwrap_envelope(args, tool_name)}

  defp decode_arguments(args, tool_name) when is_binary(args) do
    case Jason.decode(args) do
      {:ok, %{} = decoded} -> {:ok, unwrap_envelope(decoded, tool_name)}
      _ -> {:error, :native_tool_call_arguments_invalid}
    end
  end

  defp decode_arguments(_args, _tool_name), do: {:error, :native_tool_call_arguments_required}

  # 与计划起草器同款：弱模型偶发把工具调用信封复制进 arguments，精确同名时解套。
  defp unwrap_envelope(args, tool_name) do
    inner = map_get(args, :arguments)
    if map_get(args, :name) == tool_name and is_map(inner), do: inner, else: args
  end

  # 叙事绑定（N-NARR）：content 字节优先；空 content 回退 arguments.author_reasoning。
  # 两者都绑不上 → {nil, nil}（使命仍有效，只是不产作者可见叙事事件）。
  defp narrative(provider_result, args, tool_name) do
    content = provider_result |> map_get(:content) |> to_string() |> String.trim()
    reasoning = args |> map_get(:author_reasoning) |> to_string() |> String.trim()

    cond do
      content != "" and
          match?({:ok, _}, AgentNarrativeSource.from_provider_result(provider_result, content)) ->
        {:ok, source} = AgentNarrativeSource.from_provider_result(provider_result, content)
        {content, source}

      reasoning != "" ->
        case AgentNarrativeSource.from_tool_call_narrative(provider_result, tool_name, reasoning) do
          {:ok, source} -> {reasoning, source}
          {:error, _reason} -> {nil, nil}
        end

      true ->
        {nil, nil}
    end
  end

  defp provider_call_ref(provider_result) do
    case map_get(provider_result, :provider_call_ref) ||
           map_get(provider_result, :provider_call_id) do
      ref when is_binary(ref) and ref != "" -> ref
      _ -> nil
    end
  end

  defp map_get(map, key) when is_map(map),
    do: Map.get(map, key) || Map.get(map, Atom.to_string(key))

  defp map_get(_map, _key), do: nil

  defp clean(value) when is_binary(value) do
    case String.trim(value) do
      "" -> nil
      trimmed -> trimmed
    end
  end

  defp clean(_), do: nil
end
