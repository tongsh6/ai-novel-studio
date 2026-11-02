defmodule NovelAgent.Provider.RequestIRTest do
  use ExUnit.Case, async: true

  alias NovelAgent.Provider.RequestIR
  alias NovelAgent.Provider.RequestIR.Projection

  @author_text "把沈砚的年龄改成三十岁"
  @provenance_header "【应用数据 · application_base · 非作者原话】"

  defp full_caps, do: Map.new(RequestIR.required_capabilities(), &{&1, true})

  defp base_refs, do: [%{ref: "work:work-1", version: 3}]

  defp tools,
    do: [%{name: "read_character", description: "读取角色", input_schema: %{type: "object"}}]

  defp message(role, provenance, blocks, extra \\ %{}) do
    RequestIR.message(role, provenance, blocks, extra)
  end

  defp ir(messages, opts \\ []) do
    RequestIR.new(%{
      run: %{run_id: "run-g1", work_id: "work-1", goal: %{text: "读取作品事实后给出候选"}},
      system: %{
        identity_ref: "identity:authoring/v1",
        instructions: "你是创作 run，只在作者授权边界内行动。",
        run_role: "creation_run"
      },
      messages: messages,
      tools: Keyword.get(opts, :tools, tools()),
      projection: %{
        target: Keyword.get(opts, :target, "chat_completions"),
        capability_profile: Keyword.get(opts, :capabilities, full_caps()),
        finite_mode: Keyword.get(opts, :finite_mode),
        usage_streaming: false
      },
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

  describe "IR v1 数据边界校验" do
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
               Projection.project(ir(history, target: "anthropic_messages"))

      assert {:ok, chat} = Projection.project(ir(history))

      assert Enum.find(chat.messages, &(&1.role == "assistant")).tool_calls
             |> hd()
             |> get_in([:function, :arguments]) == "{\"query\":}"
    end

    test "生产请求桥拒绝未声明的能力缺口并保留显式有限模式" do
      incomplete = ir(g1_messages(), capabilities: %{})
      assert {:error, {:unsupported_capability, _}} = RequestIR.to_provider_prompt(incomplete)

      finite = ir(g1_messages(), capabilities: %{}, finite_mode: %{name: "legacy_json_content"})

      assert {:ok, %{finite_mode: %{name: "legacy_json_content"}}} =
               RequestIR.to_provider_prompt(finite)
    end

    test "canonical 可记录待处理调用但不能把未闭合交换发送到下一请求" do
      pending =
        ir(
          g1_messages() ++
            [
              message(:assistant, :model, [
                RequestIR.tool_call_block("read_character", %{}, "pending")
              ])
            ]
        )

      assert :ok = RequestIR.validate(pending)
      assert {:error, {:pending_tool_calls, ["pending"]}} = RequestIR.to_provider_prompt(pending)

      interleaved = %{
        pending
        | messages: pending.messages ++ [message(:user, :author, [RequestIR.text_block("继续")])]
      }

      assert {:error, :interrupted_tool_exchange} = RequestIR.validate(interleaved)
    end

    test "工具结果不能先于其调用出现" do
      reversed =
        ir(
          g1_messages() ++
            [
              message(:tool, :tool_result, [
                RequestIR.validation_result_block("late", "failed", "invalid")
              ]),
              message(:assistant, :model, [
                RequestIR.tool_call_block("read_character", %{}, "late")
              ])
            ]
        )

      assert {:error, :tool_result_before_call} = RequestIR.validate(reversed)
    end

    test "G1 合法 IR 通过校验" do
      assert :ok = RequestIR.validate(ir(g1_messages()))
    end

    test "观察的来源和版本在进入压缩边界前必须合法" do
      for invalid <- [%{versions: nil}, %{source_refs: [nil]}, %{source_refs: [%{ref: ""}]}] do
        messages = g2_messages()
        observation = List.last(messages)
        [block] = observation.blocks
        observation = %{observation | blocks: [Map.merge(block, invalid)]}

        assert {:error, :invalid_observation_block} =
                 RequestIR.validate(ir(List.replace_at(messages, -1, observation)))
      end
    end

    test "缺少 system identity_ref 拒绝" do
      ir = %{ir(g1_messages()) | system: %{}}
      assert {:error, :missing_system_identity_ref} = RequestIR.validate(ir)
    end

    test "禁止 adopt/canon_write 类工具（I-ART-6）" do
      bad_tools = [%{name: "adopt", input_schema: %{}}]

      assert {:error, :forbidden_tool_schema} =
               RequestIR.validate(ir(g1_messages(), tools: bad_tools))

      messages =
        g1_messages() ++
          [
            message(:assistant, :model, [
              RequestIR.tool_call_block("canon_write", %{}, "call-1")
            ])
          ]

      assert :ok = RequestIR.validate(ir(messages))

      assert {:error, {:pending_tool_calls, ["call-1"]}} =
               RequestIR.to_provider_prompt(ir(messages))
    end

    test "观察必须绑定已有 call_id，且 status 如实（I-ART-4）" do
      orphan =
        g1_messages() ++
          [
            message(:tool, :tool_result, [
              RequestIR.observation_block("call-orphan", %{status: "ok"})
            ])
          ]

      assert {:error, :orphan_tool_result} = RequestIR.validate(ir(orphan))

      invalid_status =
        g1_messages() ++
          [
            message(:assistant, :model, [
              RequestIR.tool_call_block("read_character", %{}, "call-1")
            ]),
            message(:tool, :tool_result, [
              RequestIR.observation_block("call-1", %{status: "pretend_ok"})
            ])
          ]

      assert {:error, {:invalid_observation_status, "pretend_ok"}} =
               RequestIR.validate(ir(invalid_status))
    end

    test "重复 call_id 拒绝" do
      messages =
        g1_messages() ++
          [
            message(:assistant, :model, [
              RequestIR.tool_call_block("read_character", %{}, "call-1")
            ]),
            message(:assistant, :model, [
              RequestIR.tool_call_block("read_character", %{}, "call-1")
            ])
          ]

      assert {:error, :duplicate_call_id} = RequestIR.validate(ir(messages))
    end

    test "used_refs 不得越出 Base ∪ 实际观察（I-ART-9）" do
      refs = %{base_refs: base_refs(), observation_refs: [], used_refs: ["character:1"]}

      assert {:error, {:used_refs_out_of_scope, ["character:1"]}} =
               RequestIR.validate(ir(g1_messages(), refs: refs))
    end
  end

  describe "legacy 适配器（迁移期）" do
    test "旧 prompt 映射为 IR 并显式标记 legacy 有限模式" do
      legacy = RequestIR.from_legacy(%{messages: [%{role: "user", content: "hello"}]})

      assert :ok = RequestIR.validate(legacy)
      assert legacy.projection.finite_mode == %{name: "legacy_prompt"}

      assert {:finite_mode, body, meta} = Projection.project(legacy)
      assert meta.finite_mode == %{name: "legacy_prompt"}
      assert meta.missing == RequestIR.required_capabilities()
      assert [%{role: "system"}, %{role: "user", content: "hello"}] = body.messages
    end
  end

  describe "能力门槛与显式有限模式（VS-00L §6.4）" do
    test "完整能力 → 正常投影" do
      assert {:ok, body} = Projection.project(ir(g1_messages()))
      assert [%{role: "system"} | _] = body.messages
    end

    test "缺能力且未声明有限模式 → 拒绝路由" do
      caps = Map.delete(full_caps(), :streaming)

      assert {:error, {:unsupported_capability, [:streaming]}} =
               Projection.project(ir(g1_messages(), capabilities: caps))
    end

    test "缺能力但显式有限模式 → 返回明确降级" do
      caps = Map.delete(full_caps(), :streaming)

      assert {:finite_mode, _body, %{missing: [:streaming], finite_mode: %{name: "no_streaming"}}} =
               Projection.project(
                 ir(g1_messages(), capabilities: caps, finite_mode: %{name: "no_streaming"})
               )
    end
  end

  describe "六类黄金请求 G1–G6 投影" do
    test "G1 首轮：作者原话独立 user 消息、Base 带 provenance、tools 完整" do
      {:ok, body} = Projection.project(ir(g1_messages()))

      assert [%{role: "system"} | _] = body.messages
      assert Enum.any?(body.messages, &(&1 == %{role: "user", content: @author_text}))

      assert Enum.any?(body.messages, fn message ->
               message.role == "user" and String.starts_with?(message.content, @provenance_header)
             end)

      assert [%{type: "function", function: %{name: "read_character"}}] = body.tools
    end

    test "G2 观察后：tool call 与 observation 按 call_id 关联进入下一请求" do
      {:ok, chat} = Projection.project(ir(g2_messages(), refs: observed_refs()))
      assistant = Enum.find(chat.messages, &(&1.role == "assistant"))

      assert [%{id: "call-1", function: %{name: "read_character"}}] = assistant.tool_calls

      tool = Enum.find(chat.messages, &(&1.role == "tool"))
      assert tool.tool_call_id == "call-1"
      assert tool.content =~ "ok"
      assert tool.content =~ "character:1"

      {:ok, anthropic} =
        Projection.project(ir(g2_messages(), target: "anthropic_messages", refs: observed_refs()))

      assert Enum.any?(anthropic.messages, fn m ->
               Enum.any?(m.content, &(&1.type == "tool_use" and &1.id == "call-1"))
             end)

      assert Enum.any?(anthropic.messages, fn m ->
               Enum.any?(m.content, &(&1.type == "tool_result" and &1.tool_use_id == "call-1"))
             end)

      {:ok, responses} =
        Projection.project(ir(g2_messages(), target: "responses_api", refs: observed_refs()))

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
        assert Projection.project(ir(exchange_with_arguments(mixed), target: target)) ==
                 Projection.project(ir(exchange_with_arguments(canonical), target: target))
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

      {:ok, body} = Projection.project(ir(messages))
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

      {:ok, body} = Projection.project(ir(messages, refs: refs))

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

      {:ok, body} = Projection.project(ir(messages))
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

      {:ok, body} = Projection.project(ir(messages))

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
        first = %{first | projection: %{first.projection | target: target}}
        second = %{second | projection: %{second.projection | target: target}}
        assert {:ok, first_body} = Projection.project(first)
        assert {:ok, second_body} = Projection.project(second)
        first_items = Map.get(first_body, :messages, first_body[:input])
        second_items = Map.get(second_body, :messages, second_body[:input])

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
  end

  describe "adapter 桥（CP2 收尾，VS-00L §6/§8）" do
    test "normalize_messages 保真原生工具字段（I-ART-8）" do
      tool_calls = [
        %{
          id: "call-1",
          type: "function",
          function: %{name: "read_character", arguments: "{\"character_ref\":\"character:1\"}"}
        }
      ]

      messages = [
        %{role: "assistant", content: "", tool_calls: tool_calls},
        %{role: "tool", content: "{\"status\":\"ok\"}", tool_call_id: "call-1"},
        %{role: "user", content: "hi"}
      ]

      assert [assistant, tool, user] = NovelAgent.Provider.normalize_messages(messages)
      assert assistant.tool_calls == tool_calls
      assert tool.tool_call_id == "call-1"
      assert user == %{role: "user", content: "hi"}
    end

    test "IR → provider prompt：OpenAI 兼容 adapter 消费结果与投影同源" do
      ir = ir(g2_messages(), refs: observed_refs())

      assert {:ok, prompt} = RequestIR.to_provider_prompt(ir)
      assert prompt.ir_version == RequestIR.ir_version()

      assert NovelAgent.Provider.normalize_messages(prompt) ==
               elem(Projection.project(ir), 1).messages

      assert NovelAgent.Provider.put_openai_tools(%{}, prompt).tools ==
               elem(Projection.project(ir), 1).tools

      assert NovelAgent.Provider.tool_specs(prompt) != []
    end

    test "legacy prompt 仍按原语义保留（不产生 ir_version/工具字段伪值）" do
      assert [%{role: "user", content: "hello"}] =
               NovelAgent.Provider.normalize_messages(%{
                 messages: [%{role: "user", content: "hello"}]
               })
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

      assert {:ok, prompt} =
               RequestIR.to_provider_prompt(ir,
                 tool_names: ["report_quality_findings"],
                 tool_choice: "report_quality_findings"
               )

      assert Enum.map(prompt.tools, & &1.name) == ["report_quality_findings"]
      assert NovelAgent.Provider.tool_choice(prompt) == "report_quality_findings"
      assert length(ir.tools) == 2

      assert {:error, {:unknown_tool_names, ["missing_tool"]}} =
               RequestIR.to_provider_prompt(ir, tool_names: ["missing_tool"])
    end
  end
end
