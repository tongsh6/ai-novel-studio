defmodule NovelAgent.Provider.RequestIRProjectionTest do
  use ExUnit.Case, async: true

  alias NovelAgent.Provider.Projection
  alias NovelCommon.RequestIR

  @author_text "把沈砚的年龄改成三十岁"
  @provenance_header "【应用数据 · application_base · 非作者原话】"

  defp base_refs, do: [%{ref: "work:work-1", version: 3}]

  defp tools,
    do: [%{name: "read_character", description: "读取角色", input_schema: %{type: "object"}}]

  defp message(role, provenance, blocks, extra \\ %{}) do
    RequestIR.message(role, provenance, blocks, extra)
  end

  defp maybe_put(map, _key, nil), do: map
  defp maybe_put(map, key, value), do: Map.put(map, key, value)

  defp ir(messages, opts \\ []) do
    RequestIR.new(%{
      run: %{run_id: "run-g1", work_id: "work-1", goal: %{text: "读取作品事实后给出候选"}},
      system:
        RequestIR.system_envelope(
          instructions: "你是创作 run，只在作者授权边界内行动。",
          run_role: "creation_run"
        ),
      messages: messages,
      tools: Keyword.get(opts, :tools, tools()),
      projection:
        %{usage_streaming: false} |> maybe_put(:finite_mode, Keyword.get(opts, :finite_mode)),
      refs:
        Keyword.get(opts, :refs, %{base_refs: base_refs(), observation_refs: [], used_refs: []})
    })
  end

  defp g1_messages do
    [
      message(
        :application_base,
        :application,
        [RequestIR.text_block("run goal: 读取作品事实并生成 tentative 候选")],
        %{source_refs: base_refs()}
      ),
      message(:user, :author, [RequestIR.text_block(@author_text)], %{
        source_refs: [%{ref: "author_turn:turn-1"}]
      })
    ]
  end

  defp g2_messages do
    g1_messages() ++
      [
        message(:assistant, :model, [
          RequestIR.text_block("先读取角色事实。"),
          RequestIR.tool_call_block(
            "read_character",
            %{"character_ref" => "character:1"},
            "call-1"
          )
        ]),
        message(:tool, :tool_result, [
          RequestIR.observation_block("call-1", %{
            status: "ok",
            source_refs: [%{ref: "character:1", version: 2}],
            coverage: %{fields: ["narrative_role"]},
            content: %{"narrative_role" => "ENSEMBLE_POV"}
          })
        ])
      ]
  end

  defp observed_refs do
    %{
      base_refs: base_refs(),
      observation_refs: [%{ref: "character:1", version: 2}],
      used_refs: ["character:1"]
    }
  end

  defp exchange_with_arguments(arguments) do
    g1_messages() ++
      [
        message(:assistant, :model, [
          RequestIR.tool_call_block("read_character", arguments, "call-1")
        ]),
        message(:tool, :tool_result, [
          RequestIR.validation_result_block("call-1", "failed", "missing_argument")
        ])
      ]
  end

  describe "投影边界（VS-00L §6）" do
    test "Anthropic 投影明确拒绝无法表示为对象的原始工具参数" do
      call =
        RequestIR.tool_call_block("read_character", %{}, "invalid-json")
        |> Map.put(:raw_arguments, "{\"query\":}")

      history =
        g1_messages() ++
          [
            message(:assistant, :model, [call]),
            message(:tool, :tool_result, [
              RequestIR.validation_result_block("invalid-json", "failed", "invalid_arguments")
            ])
          ]

      assert {:error, {:unrepresentable_tool_arguments, "invalid-json"}} =
               Projection.project(ir(history), "anthropic_messages")

      assert {:ok, chat} = Projection.project(ir(history), "chat_completions")

      assert Enum.find(chat.messages, &(&1.role == "assistant")).tool_calls
             |> hd()
             |> get_in([:function, :arguments]) == "{\"query\":}"
    end
  end

  describe "六类黄金请求 G1–G6 投影" do
    test "G1 首轮：作者原话独立 user 消息、Base 带 provenance、tools 完整" do
      {:ok, body} = Projection.project(ir(g1_messages()), "chat_completions")

      assert [%{role: "system"} | _] = body.messages
      assert Enum.any?(body.messages, &(&1 == %{role: "user", content: @author_text}))

      assert Enum.any?(body.messages, fn message ->
               message.role == "user" and String.starts_with?(message.content, @provenance_header)
             end)

      assert [%{type: "function", function: %{name: "read_character"}}] = body.tools
    end

    test "G2 观察后：tool call 与 observation 按 call_id 关联进入下一请求" do
      {:ok, chat} =
        Projection.project(ir(g2_messages(), refs: observed_refs()), "chat_completions")

      assistant = Enum.find(chat.messages, &(&1.role == "assistant"))

      assert [%{id: "call-1", function: %{name: "read_character"}}] = assistant.tool_calls

      tool = Enum.find(chat.messages, &(&1.role == "tool"))
      assert tool.tool_call_id == "call-1"
      assert tool.content =~ "ok"
      assert tool.content =~ "character:1"

      {:ok, anthropic} =
        Projection.project(
          ir(g2_messages(), refs: observed_refs()),
          "anthropic_messages"
        )

      assert Enum.any?(anthropic.messages, fn m ->
               Enum.any?(m.content, &(&1.type == "tool_use" and &1.id == "call-1"))
             end)

      assert Enum.any?(anthropic.messages, fn m ->
               Enum.any?(m.content, &(&1.type == "tool_result" and &1.tool_use_id == "call-1"))
             end)

      {:ok, responses} =
        Projection.project(ir(g2_messages(), refs: observed_refs()), "responses_api")

      assert Enum.any?(responses.input, &(&1.type == "function_call" and &1.call_id == "call-1"))

      assert Enum.any?(
               responses.input,
               &(&1.type == "function_call_output" and &1.call_id == "call-1")
             )
    end

    test "opaque JSON 边界：known/unknown 混合键、中文空白、结构体与工具参数统一编码" do
      at = ~U[2026-11-01 00:00:00Z]

      atom_block =
        RequestIR.observation_block("call-1", %{
          status: "ok",
          versions: %{"character:1" => 2},
          coverage: %{fields: ["summary"], nested: %{role: "domain"}},
          content: %{
            "未知" => %{"role" => "作者", "items" => [%{"text" => "a\n b"}]},
            query: "查询\n  空白",
            summary: "摘要",
            at: at
          }
        })

      string_block =
        RequestIR.observation_block("call-1", %{
          status: "ok",
          versions: %{"character:1" => 2},
          coverage: %{"fields" => ["summary"], "nested" => %{"role" => "domain"}},
          content: %{
            "query" => "查询\n  空白",
            "summary" => "摘要",
            "at" => at,
            "未知" => %{"role" => "作者", "items" => [%{"text" => "a\n b"}]}
          }
        })

      assert atom_block.content == string_block.content
      assert atom_block.coverage == string_block.coverage

      assert Projection.structured_content(atom_block) ==
               Projection.structured_content(string_block)

      decoded = Jason.decode!(Projection.structured_content(atom_block))
      assert decoded["content"]["query"] == "查询\n  空白"
      assert decoded["content"]["未知"] == %{"role" => "作者", "items" => [%{"text" => "a\n b"}]}
      assert decoded["content"]["at"] == "2026-11-01T00:00:00Z"
      assert decoded["coverage"]["nested"] == %{"role" => "domain"}

      assert RequestIR.tool_call_block("read", %{query: "q", nested: %{role: "作者"}}, "call").arguments ==
               %{"query" => "q", "nested" => %{"role" => "作者"}}

      assert RequestIR.validation_result_block("call", "failed", "bad", %{
               role: "作者",
               nested: [%{type: "x"}]
             }).detail == %{
               "role" => "作者",
               "nested" => [%{"type" => "x"}]
             }

      mixed = %{"a" => "开头", z: "末尾", nested: %{role: "作者"}}
      canonical = %{"z" => "末尾", "a" => "开头", "nested" => %{"role" => "作者"}}

      for target <- ["chat_completions", "anthropic_messages", "responses_api"] do
        assert Projection.project(ir(exchange_with_arguments(mixed)), target) ==
                 Projection.project(ir(exchange_with_arguments(canonical)), target)
      end
    end

    test "G3 校验失败后：失败作为原生 tool 结果回流，不追加 user 纠错消息" do
      messages =
        g1_messages() ++
          [
            message(:assistant, :model, [
              RequestIR.tool_call_block("read_character", %{"character_ref" => ""}, "call-1")
            ]),
            message(:tool, :tool_result, [
              RequestIR.validation_result_block("call-1", "failed", "missing_argument", %{
                field: "character_ref"
              })
            ])
          ]

      {:ok, body} = Projection.project(ir(messages), "chat_completions")
      tool = Enum.find(body.messages, &(&1.role == "tool"))
      assert tool.tool_call_id == "call-1"
      assert tool.content =~ "failed"
      assert tool.content =~ "missing_argument"

      user_messages = Enum.filter(body.messages, &(&1.role == "user"))
      assert length(user_messages) == 2
    end

    test "G4 候选后：tentative artifact 不产生 adopt 动作，pending refs 由 Base 承载" do
      pending_ref = %{ref: "artifact:pending-1", version: 1}
      refs = %{base_refs: base_refs() ++ [pending_ref], observation_refs: [], used_refs: []}

      messages =
        g1_messages() ++
          [
            message(:assistant, :model, [
              RequestIR.tentative_artifact_block("character_profile_revision", [
                %{"item_id" => "item-1", "skeleton_field" => "narrative_role"}
              ])
            ])
          ]

      {:ok, body} = Projection.project(ir(messages, refs: refs), "chat_completions")

      assert Enum.all?(body.tools, fn tool -> tool.function.name != "adopt" end)
      refute inspect(body.messages) =~ "adopt"
      assert Enum.any?(refs.base_refs, &(&1.ref == "artifact:pending-1"))
    end

    test "G5 作者边界后：author_exit 不投影为伪作者消息" do
      messages =
        g1_messages() ++
          [
            message(:author_exit, :application, [
              RequestIR.author_exit_block("author_decision_required", %{
                question_ref: "question:1"
              })
            ])
          ]

      {:ok, body} = Projection.project(ir(messages), "chat_completions")
      refute inspect(body) =~ "author_exit"
      assert length(Enum.filter(body.messages, &(&1.role == "user"))) == 2
    end

    test "G6 压缩后：checkpoint 显式携带覆盖范围，作者原话字节不变" do
      checkpoint =
        RequestIR.checkpoint_block(
          %{turn_range: "turn-1..turn-40"},
          [%{ref: "turn:1..40", version: 1}],
          %{"turn:1..40" => 1},
          ["对话细节"],
          "前 40 轮摘要：沈砚身份与主角顾青的冲突。"
        )

      messages =
        g1_messages() ++
          [message(:checkpoint, :application, [checkpoint])] ++
          [
            message(:user, :author, [RequestIR.text_block("继续推进下一段冲突")], %{
              source_refs: [%{ref: "author_turn:turn-41"}]
            })
          ]

      {:ok, body} = Projection.project(ir(messages), "chat_completions")

      checkpoint_message =
        Enum.find(body.messages, &(is_binary(&1.content) and &1.content =~ "checkpoint"))

      assert checkpoint_message.content =~ "turn-1..turn-40"
      assert checkpoint_message.content =~ "对话细节"
      assert Enum.any?(body.messages, &(&1 == %{role: "user", content: @author_text}))
    end
  end

  describe "G7 动态 scope（VS-00L §14）" do
    test "三种投影都保留 scope 顺序、版本和最新视图" do
      scope = fn text, revision ->
        message(:scope_update, :application, [RequestIR.text_block(text)], %{
          versions: %{"scope_revision" => revision, "work" => 3}
        })
      end

      first = ir(g1_messages() ++ [scope.("只读探索开放", 1)])
      second = ir(g1_messages() ++ [scope.("只读探索开放", 1), scope.("只读探索关闭", 2)])

      for target <- ["chat_completions", "anthropic_messages", "responses_api"] do
        assert {:ok, first_body} = Projection.project(first, target)
        assert {:ok, second_body} = Projection.project(second, target)
        first_items = Map.get(first_body, :messages, first_body[:input])
        second_items = Map.get(second_body, :messages, second_body[:input])

        # 三投影统一严格前缀：Anthropic 同样 1:1 投影，客户端不合并相邻 role
        # （连续同 role 由 provider 服务端合并，不改变请求 body 的前缀性质）。
        assert Enum.take(second_items, length(first_items)) == first_items

        last_item = List.last(second_items)

        scope_text =
          case target do
            "chat_completions" -> last_item.content
            "anthropic_messages" -> List.last(last_item.content).text
            "responses_api" -> List.last(last_item.content).text
          end

        assert scope_text =~ "只读探索关闭"
        assert scope_text =~ ~s("scope_revision":2)
      end
    end

    test "Anthropic 投影 1:1 保留连续 user：作者独立消息、追加 scope 为新条目、严格前缀" do
      base =
        message(:application_base, :application, [RequestIR.text_block("run goal: 基础材料")], %{
          source_refs: []
        })

      scope_1 =
        message(:scope_update, :application, [RequestIR.text_block("只读探索开放")], %{
          versions: %{"scope_revision" => 1}
        })

      scope_2 =
        message(:scope_update, :application, [RequestIR.text_block("只读探索关闭")], %{
          versions: %{"scope_revision" => 2}
        })

      author =
        message(:user, :author, [RequestIR.text_block(@author_text)], %{
          source_refs: [%{ref: "author_turn:turn-1"}]
        })

      {:ok, first} = Projection.project(ir([base, scope_1, author]), "anthropic_messages")

      {:ok, second} =
        Projection.project(ir([base, scope_1, author, scope_2]), "anthropic_messages")

      # 1) 连续 user 不合并：application_base / scope / 作者各自一条独立消息
      assert Enum.map(first.messages, & &1.role) == ["user", "user", "user"]
      assert length(second.messages) == 4

      # 2) 作者原话在自己的 user 消息内，字节不变（I-ART-2）
      author_message = Enum.at(first.messages, 2)
      assert author_message.role == "user"
      assert [%{type: "text", text: text}] = author_message.content
      assert text == @author_text

      # 3) G7 严格前缀：新增 scope 是追加的独立消息，前次 body 是后次 body 的前缀
      assert Enum.take(second.messages, length(first.messages)) == first.messages

      # 4) 新增 scope 仍是独立 user 消息
      last_message = List.last(second.messages)
      assert last_message.role == "user"
      assert [%{type: "text", text: scope_text}] = last_message.content
      assert scope_text =~ "只读探索关闭"
    end
  end

  describe "工具选择与投影边界" do
    test "tool_choice: none 不是工具调用模式，但工具目录仍原样进入 canonical 投影" do
      ir =
        %{
          ir([message(:user, :author, [RequestIR.text_block("观察")])],
            tools: [%{name: "continuation_decision", input_schema: %{type: "object"}}]
          )
          | projection: %{tool_choice: "none"}
        }

      refute RequestIR.Tools.tool_call_prompt?(ir)

      # 工具与选择只由 canonical IR 投影承载；请求不携带第二套工具注入状态。
      assert {:ok, body} = Projection.project(ir, "chat_completions")
      assert body.tool_choice == "none"
      assert [%{function: %{name: "continuation_decision"}}] = body.tools

      named = %{ir | projection: %{tool_choice: "continuation_decision"}}
      assert RequestIR.Tools.tool_call_prompt?(named)
    end
  end

  describe "adapter 原生投影边界（VS-00L §19.1）" do
    test "Provider 工具事实直接读取 IR 的 active tools 与 projection.tool_choice" do
      ir = ir(g2_messages(), refs: observed_refs())
      assert {:ok, prepared} = RequestIR.prepare_request(ir, tool_choice: "required")

      assert RequestIR.Tools.tool_specs(prepared) |> Enum.map(& &1.name) == [
               "read_character"
             ]

      assert RequestIR.Tools.tool_choice(prepared) == "required"
      assert RequestIR.Tools.tool_call_prompt?(prepared)
    end

    test "CP4a：当前阶段工具投影与 canonical 工具历史分离" do
      ir =
        ir(g1_messages(),
          tools:
            tools() ++
              [
                %{
                  name: "report_quality_findings",
                  description: "质量复核",
                  input_schema: %{type: "object"}
                }
              ]
        )

      assert {:ok, prepared} =
               RequestIR.prepare_request(ir,
                 tool_names: ["report_quality_findings"],
                 tool_choice: "report_quality_findings"
               )

      assert Enum.map(prepared.tools, & &1.name) == ["report_quality_findings"]
      assert RequestIR.Tools.tool_choice(prepared) == "report_quality_findings"
      assert length(ir.tools) == 2

      assert {:error, {:unknown_tool_names, ["missing_tool"]}} =
               RequestIR.prepare_request(ir, tool_names: ["missing_tool"])
    end
  end
end
