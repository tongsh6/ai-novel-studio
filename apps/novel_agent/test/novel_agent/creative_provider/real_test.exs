defmodule NovelAgent.CreativeProvider.RealTest do
  use ExUnit.Case, async: true

  alias NovelAgent.CreativeProvider.Real
  alias NovelAgent.Provider.Execution
  alias NovelAgent.Provider.Result, as: ProviderResult
  alias NovelCommon.Contracts.CreativeRequest

  @request %CreativeRequest{
    request_id: "req-1",
    tool_name: "prose_writing",
    artifact_type: "prose_fragment",
    creative_brief: "写第一章开篇",
    source_turn_ref: "turn-1",
    context_text: "赛博修仙",
    provider_hints: %{}
  }

  @good_json Jason.encode!([
               %{item_id: "i1", title: "开篇", body: "夜色压在账单上。", rationale: nil}
             ])

  # 字符串值内裸换行 → 非法 JSON（gpt-oss-120b 长上下文下的真实坏法，M2 长跑
  # 实测 10/12 次正文起草解析失败均属此类）。2026-07-20 起 parse_content 在
  # Jason.decode 前先过 NovelAgent.Provider.repair_unescaped_control_chars/1，
  # 这类 fixture 现在**首次调用即修复成功，不再需要重试**——见下方
  # "repairs unescaped newline" 测试。retry 机制仍保留给这类修复覆盖不到的
  # 非法 JSON（如结构性错误、非受控字符导致的坏法），用 @unrepairable_bad_json
  # 覆盖。
  @bad_json ~s([{"item_id": "i1", "title": "开篇", "body": "第一行\n第二行", "rationale": null}])

  # 结构性非法 JSON（多余逗号），不是裸控制字符问题，repair_unescaped_control_chars
  # 修不了——仍应触发既有的重试/诚实失败路径。
  @unrepairable_bad_json ~s([{"item_id": "i1", "title": "开篇", "body": "b",}])

  defp provider_execution(result_fn), do: %Execution{result_fn: result_fn}

  test "repairs unescaped newline in string value without needing a retry" do
    {:ok, agent} = Agent.start_link(fn -> 0 end)

    result_fn = fn _prompt ->
      Agent.update(agent, &(&1 + 1))
      {:ok, %{content: @bad_json}}
    end

    result = Real.generate(@request, provider_execution(result_fn))

    assert result.status == :ok
    assert [%{body: "第一行\n第二行"}] = result.items
    assert Agent.get(agent, & &1) == 1
  end

  test "retries once with a correction prompt when provider returns structurally invalid JSON" do
    {:ok, agent} = Agent.start_link(fn -> [] end)

    result_fn = fn prompt ->
      calls = Agent.get_and_update(agent, &{&1, &1 ++ [prompt]})

      if calls == [] do
        {:ok, %{content: @unrepairable_bad_json}}
      else
        {:ok, %{content: @good_json}}
      end
    end

    result = Real.generate(@request, provider_execution(result_fn))

    assert result.status == :ok
    assert [%{body: "夜色压在账单上。"}] = result.items

    [_first, correction] = Agent.get(agent, & &1)
    # 重试 prompt 携带纠错指令与原任务（含三锚点，stub 解析兼容）。
    assert correction =~ "不是合法 JSON"
    assert correction =~ "用户创作简述："
    assert correction =~ "重要："
  end

  test "fails honestly when retry also returns structurally invalid JSON" do
    result_fn = fn _prompt -> {:ok, %{content: @unrepairable_bad_json}} end

    result = Real.generate(@request, provider_execution(result_fn))

    assert result.status == :error
    assert [%{code: "provider_response_invalid"} | _] = result.errors
  end

  test "valid JSON passes through without retry" do
    {:ok, agent} = Agent.start_link(fn -> 0 end)

    result_fn = fn _prompt ->
      Agent.update(agent, &(&1 + 1))
      {:ok, %{content: @good_json}}
    end

    result = Real.generate(@request, provider_execution(result_fn))

    assert result.status == :ok
    assert Agent.get(agent, & &1) == 1
  end

  test "preserves provider_call_ref from unified provider execution result" do
    result =
      Real.generate(
        @request,
        provider_execution(fn _prompt ->
          {:ok, %ProviderResult{content: @good_json, provider_call_ref: "pcall-writer-execution"}}
        end)
      )

    assert result.status == :ok
    assert result.provider_call_ref == "pcall-writer-execution"
    assert [%{provider_call_ref: "pcall-writer-execution"}] = result.items
  end

  test "accepts provider execution dependency" do
    provider_execution = %Execution{
      result_fn: fn _prompt ->
        {:ok,
         %ProviderResult{
           content: @good_json,
           provider_call_ref: "pcall-writer-dependency"
         }}
      end
    }

    result = Real.generate(@request, provider_execution)

    assert result.status == :ok
    assert result.provider_call_ref == "pcall-writer-dependency"
    assert [%{provider_call_ref: "pcall-writer-dependency"}] = result.items
  end

  test "accepts top-level items with creative output self report" do
    content =
      Jason.encode!(%{
        items: [
          %{item_id: "i1", title: "开篇", body: "夜色压在账单上。", rationale: nil}
        ],
        self_report: %{
          assumptions: ["按章计划处理"],
          intended_reader_effect: "紧张、期待",
          used_context_refs: ["reader_effect_brief"],
          risk_flags: ["章尾钩子需作者确认"]
        }
      })

    result =
      Real.generate(@request, provider_execution(fn _prompt -> {:ok, %{content: content}} end))

    assert result.status == :ok
    assert [%{item_id: "i1"}] = result.items
    assert result.self_report.intended_reader_effect == "紧张、期待"
    assert result.self_report.quality_action == :confirm
  end

  test "prose writing keeps four allowed companion seed families on the same provider call" do
    content =
      Jason.encode!(%{
        items: [
          %{item_id: "prose-1", title: "灯禁", body: "岑雾吹灭了第三盏灯。", rationale: nil}
        ],
        companion_artifacts: [
          %{
            artifact_type: "character_seed",
            item_id: "char-cenwu",
            title: "岑雾",
            body: "巡夜人",
            rationale: "正文首次出场",
            narrative_role: "SUPPORTING"
          },
          %{
            artifact_type: "foreshadowing_seed",
            item_id: "foreshadow-third-lamp",
            title: "第三盏灯",
            body: "第三盏灯熄灭后留下蓝灰",
            rationale: "正文新埋线索"
          },
          %{
            artifact_type: "world_rule_seed",
            item_id: "rule-night-light",
            title: "夜间灯禁",
            body: "日落后点灯会招来巡夜人",
            rationale: "正文建立持续规则"
          },
          %{
            artifact_type: "constraint_seed",
            item_id: "constraint-no-reveal",
            title: "暂不揭示灯禁源头",
            body: "前三章不解释灯禁来源",
            rationale: "作者明确要求"
          }
        ],
        self_report: %{assumptions: [], used_context_refs: [], risk_flags: []}
      })

    result =
      Real.generate(
        @request,
        provider_execution(fn _prompt ->
          {:ok, %ProviderResult{content: content, provider_call_ref: "pcall-companions"}}
        end)
      )

    assert result.status == :ok
    assert Enum.map(result.companion_artifacts, & &1.artifact_type) == [
             :character_seed,
             :foreshadowing_seed,
             :world_rule_seed,
             :constraint_seed
           ]

    assert Enum.all?(
             result.items ++ result.companion_artifacts,
             &(&1.provider_call_ref == "pcall-companions")
           )
  end

  test "rejects duplicate ids and companions on non-prose capabilities" do
    duplicate =
      Jason.encode!(%{
        items: [%{item_id: "same", title: "正文", body: "正文", rationale: nil}],
        companion_artifacts: [
          %{
            artifact_type: "world_rule_seed",
            item_id: "same",
            title: "规则",
            body: "规则",
            rationale: nil
          }
        ]
      })

    assert %{status: :error, errors: [%{code: "duplicate_item_id"}]} =
             Real.generate(@request, provider_execution(fn _ -> {:ok, %{content: duplicate}} end))

    non_prose = %{@request | tool_name: "character_design", artifact_type: :character_seed}

    assert %{status: :error, errors: [%{code: "unexpected_companion_artifacts"}]} =
             Real.generate(
               non_prose,
               provider_execution(fn _ ->
                 {:ok,
                  %{
                    content:
                      Jason.encode!(%{
                        items: [
                          %{item_id: "char-1", title: "角色", body: "角色", rationale: nil}
                        ],
                        companion_artifacts: [
                          %{
                            artifact_type: "world_rule_seed",
                            item_id: "rule-1",
                            title: "规则",
                            body: "规则",
                            rationale: nil
                          }
                        ]
                      })
                  }}
               end)
             )
  end

  test "prose writing prompt asks for ReaderEffect self report without losing anchors" do
    {:ok, agent} = Agent.start_link(fn -> nil end)

    result_fn = fn prompt ->
      Agent.update(agent, fn _ -> prompt end)
      {:ok, %{content: @good_json}}
    end

    assert %{status: :ok} = Real.generate(@request, provider_execution(result_fn))

    prompt = Agent.get(agent, & &1)
    assert prompt =~ "self_report"
    assert prompt =~ "companion_artifacts"
    assert prompt =~ "character_seed"
    assert prompt =~ "foreshadowing_seed"
    assert prompt =~ "world_rule_seed"
    assert prompt =~ "constraint_seed"
    assert prompt =~ "risk_flags"
    assert prompt =~ "body 内不得出现独立的结构/状态元标签"
    assert prompt =~ "场景 2"
    assert prompt =~ "待采纳草稿"
    assert prompt =~ "用户创作简述："
    assert prompt =~ "上下文："
    assert prompt =~ "重要："
  end

  test "character design prompt 走专用分支：骨架维度 + 开放框架 + 上下文 grounding + 保留三锚点" do
    {:ok, agent} = Agent.start_link(fn -> nil end)

    result_fn = fn prompt ->
      Agent.update(agent, fn _ -> prompt end)

      {:ok,
       %{content: Jason.encode!([%{item_id: "c1", title: "沈砚", body: "定位：主角", rationale: nil}])}}
    end

    request = %CreativeRequest{
      request_id: "req-char",
      tool_name: "character_design",
      artifact_type: "character_seed",
      creative_brief: "设计一个稽查官 NONCE7Q",
      source_turn_ref: "turn-char",
      context_text: "## 现有角色\n- 白露（对手）：黑市掮客",
      provider_hints: %{}
    }

    assert %{status: :ok} = Real.generate(request, provider_execution(result_fn))

    prompt = Agent.get(agent, & &1)
    # 角色对象模型核心骨架维度（21 §7.2）
    assert prompt =~ "定位："
    assert prompt =~ "动机："
    assert prompt =~ "语言风格："
    assert prompt =~ "能力体系绑定："
    # 开放框架（I-g）：可据作品自行推断补充维度
    assert prompt =~ "自行推断补充本作特有的维度"
    # 上下文 grounding：看得见现有角色、不凭空
    assert prompt =~ "基于上下文中的作品背景、世界观、设定与现有角色"
    assert prompt =~ "## 现有角色"
    # 三锚点 + I3 nonce 指令保留
    assert prompt =~ "用户创作简述："
    assert prompt =~ "上下文："
    assert prompt =~ "重要："
    assert prompt =~ "原样保留"
  end

  test "world building prompt 按 foreshadowing_seed 输出伏笔结构 + 上下文 grounding + 保留三锚点" do
    {:ok, agent} = Agent.start_link(fn -> nil end)

    result_fn = fn prompt ->
      Agent.update(agent, fn _ -> prompt end)

      {:ok,
       %{
         content:
           Jason.encode!([
             %{
               item_id: "w1",
               title: "伏笔：矿区旧账",
               body: "伏笔线索：旧账编号",
               rationale: nil
             }
           ])
       }}
    end

    request = %CreativeRequest{
      request_id: "req-world",
      tool_name: "world_building",
      artifact_type: "foreshadowing_seed",
      creative_brief: "设计一个伏笔线索 RULE9Q8",
      source_turn_ref: "turn-world",
      context_text: "## 已确认设定\n- 灵源矿区吞掉过失踪者",
      provider_hints: %{}
    }

    assert %{status: :ok} = Real.generate(request, provider_execution(result_fn))

    prompt = Agent.get(agent, & &1)
    assert prompt =~ "本次草稿类型：foreshadowing_seed"
    assert prompt =~ "伏笔标题"
    assert prompt =~ "伏笔线索 / 首次出现位置 / 推进方式 / 回收方式 / 风险与禁忌"
    assert prompt =~ "基于上下文中的作品背景、世界观、设定、角色和已采纳内容"
    assert prompt =~ "## 已确认设定"
    assert prompt =~ "用户创作简述："
    assert prompt =~ "上下文："
    assert prompt =~ "重要："
    assert prompt =~ "原样保留"
  end
end
