defmodule NovelApplication.Toolbox do
  @moduledoc """
  工具执行运行时。接收已批准的 ToolRequest，执行工具，返回 ToolResult。

  工具执行运行时。接收已批准的 ToolRequest，执行工具，返回 ToolResult。
  不与 production state 交互。
  """

  require NovelCommon.LogEmit, as: LogEmit

  alias NovelApplication.CapabilityRegistry
  alias NovelCommon.LogContext
  alias NovelDomain.ToolRequest
  alias NovelDomain.ToolResult

  @doc """
  执行一个 ToolRequest，返回 ToolResult。

  执行前验证：registry 中存在、状态可 dispatch、grants 合法。
  """
  @spec execute(ToolRequest.t()) :: ToolResult.t()
  def execute(%ToolRequest{} = req) do
    result_id = "tr_#{System.unique_integer([:positive, :monotonic])}"
    now = DateTime.utc_now()

    t0 = System.monotonic_time(:millisecond)
    LogContext.put_tool_request(req.tool_request_id)

    LogEmit.emit(:toolbox, :execute, :start, %{
      tool_name: req.tool_name,
      tool_request_id: req.tool_request_id
    })

    result =
      cond do
        is_nil(CapabilityRegistry.get(req.tool_name)) ->
          %ToolResult{
            tool_result_id: result_id,
            tool_request_ref: req.tool_request_id,
            tool_name: req.tool_name,
            status: :failed,
            errors: [%{code: "unknown_tool", message: "tool not found in registry"}],
            completed_at: now
          }

        not CapabilityRegistry.dispatchable?(req.tool_name) ->
          %ToolResult{
            tool_result_id: result_id,
            tool_request_ref: req.tool_request_id,
            tool_name: req.tool_name,
            status: :failed,
            errors: [%{code: "tool_not_dispatchable", message: "tool is disabled or deprecated"}],
            completed_at: now
          }

        not CapabilityRegistry.grants_valid?(
          req.tool_name,
          req.read_scope_grants,
          req.write_scope_grants
        ) ->
          %ToolResult{
            tool_result_id: result_id,
            tool_request_ref: req.tool_request_id,
            tool_name: req.tool_name,
            status: :failed,
            errors: [
              %{code: "grant_scope_violation", message: "requested grants exceed registry scopes"}
            ],
            completed_at: now
          }

        true ->
          dispatch(req, result_id, now)
      end

    duration = System.monotonic_time(:millisecond) - t0

    if result.status == :succeeded do
      LogEmit.emit(:toolbox, :execute, :done, %{
        tool_name: req.tool_name,
        tool_outcome: :succeeded,
        duration_ms: duration
      })
    else
      error_code = (result.errors |> hd()).code

      LogEmit.emit(:toolbox, :execute, :error, %{
        tool_name: req.tool_name,
        tool_outcome: result.status,
        reason_code: error_code,
        duration_ms: duration
      })
    end

    result
  end

  defp dispatch(%ToolRequest{tool_name: "text_analysis"} = req, result_id, now) do
    text = Map.get(req.input, "text", "")
    genre = Map.get(req.input, "genre", "")

    analysis = %{
      word_count: count_words(text),
      estimated_reading_time_minutes: estimate_reading_time(text),
      genre_match:
        genre != "" and String.contains?(String.downcase(text), String.downcase(genre)),
      tone_suggestion: suggest_tone(text)
    }

    %ToolResult{
      tool_result_id: result_id,
      tool_request_ref: req.tool_request_id,
      tool_name: "text_analysis",
      status: :succeeded,
      output: analysis,
      state_delta: [%{type: :observation, key: "text_analysis", value: analysis}],
      usage: %{duration_ms: 0, tool: "text_analysis", version: "1.0.0"},
      trace_refs: ["tool_trace:#{result_id}"],
      completed_at: now
    }
  end

  defp dispatch(%ToolRequest{tool_name: "creative_generation"} = req, result_id, now) do
    direction = Map.get(req.input, "direction", "character_seed")
    context_text = Map.get(req.input, "context_text", "")

    items = generate_creative_items(direction, context_text)

    %ToolResult{
      tool_result_id: result_id,
      tool_request_ref: req.tool_request_id,
      tool_name: "creative_generation",
      status: :succeeded,
      output: %{artifact_type: direction, item_count: length(items), items: items},
      state_delta: [
        %{type: :tentative_artifact, key: "creative_generation", artifact_type: direction}
      ],
      artifact_refs: Enum.map(items, & &1.item_id),
      usage: %{duration_ms: 0, tool: "creative_generation", version: "1.0.0"},
      trace_refs: ["tool_trace:#{result_id}"],
      completed_at: now
    }
  end

  defp dispatch(%ToolRequest{tool_name: "world_building"} = req, result_id, now) do
    creative_dispatch(req, result_id, now, "world_setting")
  end

  defp dispatch(%ToolRequest{tool_name: "character_design"} = req, result_id, now) do
    creative_dispatch(req, result_id, now, "character_seed")
  end

  defp dispatch(%ToolRequest{tool_name: "plot_outline"} = req, result_id, now) do
    creative_dispatch(req, result_id, now, "outline_draft")
  end

  defp dispatch(%ToolRequest{tool_name: "prose_writing"} = req, result_id, now) do
    creative_dispatch(req, result_id, now, "prose_fragment")
  end

  defp dispatch(_req, result_id, now) do
    %ToolResult{
      tool_result_id: result_id,
      tool_request_ref: "unknown",
      tool_name: "unknown",
      status: :failed,
      errors: [%{code: "no_handler", message: "no dispatch handler for this tool"}],
      completed_at: now
    }
  end

  defp creative_dispatch(%ToolRequest{} = req, result_id, now, direction) do
    context_text = Map.get(req.input, "context_text", "")
    items = generate_creative_items(direction, context_text)
    artifact_type = String.to_atom(direction)

    %ToolResult{
      tool_result_id: result_id,
      tool_request_ref: req.tool_request_id,
      tool_name: req.tool_name,
      status: :succeeded,
      output: %{artifact_type: artifact_type, item_count: length(items), items: items},
      state_delta: [
        %{type: :tentative_artifact, key: req.tool_name, artifact_type: artifact_type}
      ],
      artifact_refs: Enum.map(items, & &1.item_id),
      usage: %{duration_ms: 0, tool: req.tool_name, version: "1.0.0"},
      trace_refs: ["tool_trace:#{result_id}"],
      completed_at: now
    }
  end

  defp generate_creative_items("character_seed", _context) do
    [
      %{
        item_id: "item_#{System.unique_integer([:positive, :monotonic])}",
        title: "主角草案A",
        body: "底层出身，被系统低估但拥有隐藏天赋的角色。",
        rationale: "适合赛博修仙的平民视角"
      },
      %{
        item_id: "item_#{System.unique_integer([:positive, :monotonic])}",
        title: "主角草案B",
        body: "中层执行者，在体制内发现黑暗真相。",
        rationale: "适合揭发公司和体制冲突的故事线"
      },
      %{
        item_id: "item_#{System.unique_integer([:positive, :monotonic])}",
        title: "主角草案C",
        body: "外来闯入者，带着外部视角颠覆现有秩序。",
        rationale: "适合挑战修仙垄断的反叛者叙事"
      }
    ]
  end

  defp generate_creative_items("plot_direction", _context) do
    [
      %{
        item_id: "item_#{System.unique_integer([:positive, :monotonic])}",
        title: "复仇主线",
        body: "主角发现灵气垄断背后的真相，踏上推翻体系的道路。",
        rationale: nil
      },
      %{
        item_id: "item_#{System.unique_integer([:positive, :monotonic])}",
        title: "生存主线",
        body: "主角在霓虹地牢中觉醒能力，先活下去，再图改变。",
        rationale: nil
      }
    ]
  end

  defp generate_creative_items("world_setting", _context) do
    [
      %{
        item_id: "item_#{System.unique_integer([:positive, :monotonic])}",
        title: "赛博公司垄断流",
        body: "顶级大厂垄断了灵气带宽，底层散修只能用二手的“延迟灵气”。",
        rationale: "契合社会批判主题"
      }
    ]
  end

  defp generate_creative_items("outline_draft", _context) do
    [
      {"第01章：底层灵气账单", "主角在欠费停灵的夜晚发现灵气带宽被公司暗中抽走。"},
      {"第02章：旧服务器里的残诀", "主角从废弃服务器中找到残缺功法，并第一次突破底层限制。"},
      {"第03章：黑市调频师", "主角结识能改写灵气频段的调频师，获得追查垄断链路的入口。"},
      {"第04章：巡检队的诱捕", "公司巡检队发现异常波动，主角被迫在贫民区展开第一次逃亡。"},
      {"第05章：霓虹地牢试炼", "主角进入地下算力矿井，确认灵气剥削与失踪散修有关。"},
      {"第06章：中层执行者的裂缝", "一名公司执行者透露内部清洗计划，主角开始区分敌人与可争取对象。"},
      {"第07章：断网之城", "公司切断整片街区灵气网络，主角组织底层散修维持基本生存。"},
      {"第08章：核心模块的代价", "主角夺得核心灵气模块，却发现它会吞噬使用者的记忆。"},
      {"第09章：伪仙直播夜", "公司用公开演示掩盖事故，主角借直播揭露部分真相。"},
      {"第10章：反向筑基协议", "主角把残诀、调频术和核心模块重组为能共享给底层的协议。"},
      {"第11章：天台上的背叛", "关键盟友被公司胁迫出卖坐标，团队遭遇最严重溃败。"},
      {"第12章：第一卷终局：灵气回流", "主角牺牲个人突破机会，让被垄断的灵气第一次回流到整座街区。"}
    ]
    |> Enum.map(fn {title, body} ->
      %{
        item_id: "item_#{System.unique_integer([:positive, :monotonic])}",
        title: title,
        body: body,
        rationale: "P1 10 万字最小长篇章节路线图"
      }
    end)
  end

  defp generate_creative_items("prose_fragment", _context) do
    [
      %{
        item_id: "item_#{System.unique_integer([:positive, :monotonic])}",
        title: "开场描写",
        body: "霓虹灯闪烁在积水的街面，灵气泵的轰鸣声像垂死者的喘息。",
        rationale: nil
      }
    ]
  end

  defp generate_creative_items(_, _context) do
    [
      %{
        item_id: "item_#{System.unique_integer([:positive, :monotonic])}",
        title: "创作草稿",
        body: "AI 生成的内容草案。",
        rationale: nil
      }
    ]
  end

  defp count_words(text), do: text |> String.split(~r/\s+/, trim: true) |> length()
  defp estimate_reading_time(text), do: max(1, round(count_words(text) / 250))
  defp suggest_tone(text), do: if(String.length(text) > 100, do: "narrative", else: "fragment")
end
