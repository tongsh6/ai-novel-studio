defmodule NovelCommon.RequestIRTest do
  use ExUnit.Case, async: true

  alias NovelCommon.RequestIR
  alias NovelCommon.RequestIR.Operation
  alias NovelCommon.RequestIR.Projection

  @author_text "把沈砚的年龄改成三十岁"

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

  describe "独立文本操作的显式作者来源" do
    test "真实原文与引用独立保留，应用材料与 Base 不混入作者来源" do
      raw = "  请说明这次工具结果。\r\n保留我的原字节。\n"
      ref = "turn:actual-author-input"
      material_refs = [%{ref: "tool:prose_writing"}, %{ref: "pcall:actual-result"}]
      attrs = %{profile_ref: "result_narration", text: "工具实际结果", source_refs: material_refs}

      request =
        Operation.text_operation(Map.merge(attrs, %{author_text: raw, source_input_ref: ref}))

      assert :ok = RequestIR.validate(request)
      assert request.run == %{profile_ref: "result_narration"}
      assert [base, author] = request.messages
      assert base.role == "application_base"
      assert base.source_refs == material_refs
      assert base.base_refs == material_refs
      assert RequestIR.usable_base_refs(request) == material_refs

      assert author ==
               RequestIR.message(:user, :author, [RequestIR.text_block(raw)], %{
                 source_refs: [%{ref: ref}]
               })

      assert request.refs == %{base_refs: material_refs, observation_refs: [], used_refs: []}
      refute String.contains?(Map.get(request.system, :instructions, ""), raw)

      for target <- ["chat_completions", "responses_api", "anthropic_messages"] do
        assert {:ok, body} = Projection.project(request, target)

        author_message =
          case target do
            "chat_completions" ->
              %{role: "user", content: raw}

            "responses_api" ->
              %{type: "message", role: "user", content: [%{type: "input_text", text: raw}]}

            "anthropic_messages" ->
              %{role: "user", content: [%{type: "text", text: raw}]}
          end

        messages = Map.get(body, :messages, Map.get(body, :input, []))
        assert Enum.count(messages, &(&1 == author_message)) == 1
      end

      without_author = Operation.text_operation(attrs)
      assert without_author.messages == [base]
      assert without_author.refs == request.refs
    end

    test "缺少配对来源或空白原文明确拒绝，不从目标或工具来源补作者身份" do
      attrs = %{
        profile_ref: "result_narration",
        text: "工具结果",
        source_refs: [%{ref: "tool:result"}]
      }

      for {text, ref} <- [
            {"原话", nil},
            {nil, "turn:author"},
            {"", "turn:author"},
            {" \n", "turn:author"},
            {"原话", ""},
            {"原话", " \n"},
            {123, "turn:author"},
            {"原话", []}
          ] do
        assert_raise ArgumentError, "invalid text operation author input", fn ->
          Operation.text_operation(Map.merge(attrs, %{author_text: text, source_input_ref: ref}))
        end
      end
    end
  end

  describe "Base 材料绑定的实际可投影内容" do
    @tag :r05_base_binding_content
    test "空字符串操作保留既有文本块拒绝分类" do
      assert_raise ArgumentError, ~r/invalid_text_block/, fn ->
        Operation.text_operation(%{
          profile_ref: "result_narration",
          text: "",
          source_refs: [%{ref: "tool:actual-result"}]
        })
      end
    end

    @tag :r05_base_binding_content
    test "纯空白文本只在声明供应 Base 时拒绝，不改写通用文本字节" do
      raw = " \r\n\t "
      attrs = %{profile_ref: "result_narration", text: raw}

      unbound = Operation.text_operation(attrs)
      assert :ok = RequestIR.validate(unbound)
      assert hd(unbound.messages).blocks == [RequestIR.text_block(raw)]

      assert_raise ArgumentError, ~r/invalid_base_binding_content/, fn ->
        Operation.text_operation(Map.put(attrs, :source_refs, [%{ref: "tool:actual-result"}]))
      end
    end

    @tag :r05_base_binding_content
    test "application_base 未投影的非文本块不能为绑定的材料提供正文" do
      artifact = RequestIR.tentative_artifact_block(:prose_fragment, [%{body: "未投影的材料正文"}])

      for blocks <- [[], [artifact], [RequestIR.text_block("可见文本"), artifact]] do
        base =
          message(:application_base, :application, blocks, %{
            source_refs: base_refs(),
            base_refs: base_refs()
          })

        assert {:error, :invalid_base_binding_content} = RequestIR.validate(ir([base]))
      end

      empty_scope =
        message(:scope_update, :application, [], %{
          source_refs: base_refs(),
          base_refs: base_refs()
        })

      assert {:error, :invalid_base_binding_content} = RequestIR.validate(ir([empty_scope]))
    end

    @tag :r05_base_binding_content
    test "合法多文本 Base 保留逐字正文，绑定元数据不增加任何 wire 内容" do
      parts = ["  前段 Ω\r\n", "后段 é\t "]
      raw = Enum.join(parts, "")

      base =
        message(:application_base, :application, Enum.map(parts, &RequestIR.text_block/1), %{
          source_refs: base_refs(),
          base_refs: base_refs()
        })

      request = ir([base])
      unbound = %{request | messages: [Map.delete(base, :base_refs)]}
      assert :ok = RequestIR.validate(request)
      assert RequestIR.usable_base_refs(request) == base_refs()
      assert RequestIR.usable_base_refs(unbound) == []
      assert Projection.text_of(base.blocks) == raw

      for target <- ~w(chat_completions responses_api anthropic_messages) do
        assert {:ok, body} = Projection.project(request, target)
        assert {:ok, ^body} = Projection.project(unbound, target)

        texts =
          body
          |> Map.get(:messages, Map.get(body, :input, []))
          |> Enum.flat_map(fn message ->
            case Map.get(message, :content) do
              text when is_binary(text) -> [text]
              blocks when is_list(blocks) -> Enum.map(blocks, &Map.get(&1, :text, ""))
              _ -> []
            end
          end)

        assert Enum.any?(texts, &String.ends_with?(&1, raw))
      end
    end
  end

  describe "R05 逐消息 Base 绑定" do
    @tag :r05_base_bindings
    test "累计目录和普通来源本身不授信，只有已登记的显式消息绑定可用" do
      [source_only | authors] = g1_messages()
      request = ir([source_only | authors])
      assert :ok = RequestIR.validate(request)
      assert RequestIR.usable_base_refs(request) == []
      assert {:error, _reason} = RequestIR.validate_used_refs(request, ["work:work-1"])

      bound = %{request | messages: [Map.put(source_only, :base_refs, base_refs()) | authors]}
      assert :ok = RequestIR.validate_used_refs(bound, ["work:work-1"])
      assert RequestIR.usable_base_refs(bound) == base_refs()

      missing = %{bound | refs: %{bound.refs | base_refs: []}}

      assert {:error, {:base_binding_not_registered, ["work:work-1"]}} =
               RequestIR.validate(missing)

      assert RequestIR.usable_base_refs(missing) == []
    end

    @tag :r05_base_bindings
    test "非应用材料消息不能伪造 Base 绑定，坏绑定形状明确拒绝" do
      for {role, provenance} <- [
            {:user, :author},
            {:assistant, :model},
            {:tool, :tool_result},
            {:checkpoint, :application},
            {:application_notice, :application},
            {:application_base, :model},
            {:scope_update, :model}
          ] do
        forged =
          message(role, provenance, [RequestIR.text_block("关联目录不是实际材料。")], %{
            base_refs: base_refs()
          })

        assert {:error, :invalid_base_binding_owner} = RequestIR.Scope.validate_owner(forged)
        assert RequestIR.usable_base_refs(ir([forged])) == []
      end

      for refs <- [nil, false, %{}, "work:work-1", [nil], [" "], [%{}]] do
        invalid =
          message(:application_base, :application, [RequestIR.text_block("已供正文")], %{
            base_refs: refs
          })

        assert {:error, :invalid_base_binding} = RequestIR.validate(ir([invalid]))
      end
    end
  end

  describe "IR v1 数据边界校验" do
    test "observation_payloads 只保留计划聚合叶实际存在的字段，不虚构缺省" do
      block =
        RequestIR.observation_block("call-plan", %{
          status: "ok",
          source_refs: [%{ref: "chapter:1"}],
          content: %{
            tool: "planned_exploration",
            observations: [
              %{
                status: nil,
                versions: %{"draft:page-1" => 1},
                content: %{"observation_ref" => "observation:obs_1"}
              }
            ]
          }
        })

      assert [leaf] = RequestIR.observation_payloads(block)

      assert leaf == %{
               status: nil,
               versions: %{"draft:page-1" => 1},
               content: %{"observation_ref" => "observation:obs_1"}
             }

      refute Map.has_key?(leaf, :source_refs)
      refute Map.has_key?(leaf, :coverage)
      refute Map.has_key?(leaf, :omissions)
      refute Map.has_key?(leaf, :next_offset)
    end

    test "计划聚合的非对象值不是观察叶，也不从外层来源补造证据" do
      for value <- [nil, false, 17, "不是观察", []] do
        block =
          RequestIR.observation_block("call-non-object", %{
            status: "ok",
            source_refs: [%{ref: "chapter:not-read", version: 9}],
            versions: %{"draft:not-read" => 9},
            content: %{tool: "planned_exploration", observations: [value]}
          })

        request =
          ir(
            g1_messages() ++
              [
                message(:assistant, :model, [
                  RequestIR.tool_call_block("agent_plan_draft", %{}, "call-non-object")
                ]),
                message(:tool, :tool_result, [block])
              ]
          )

        assert :ok = RequestIR.validate(request)
        assert RequestIR.observation_payloads(block) == []
        assert RequestIR.visible_observations(request) == []

        assert RequestIR.Compaction.evidence(request.messages, %{
                 call_ids: ["call-non-object"]
               }) == {[], %{}}
      end
    end

    test "应用计划读取的非对象结果不生成默认观察或覆盖真实原生材料" do
      for value <- [nil, false, 17, "不是观察", []] do
        scope =
          message(:scope_update, :application, [
            RequestIR.scope_block(%{
              work_id: "work-1",
              operation: %{role: "planned_exploration"},
              facts: %{exploration_result: value}
            })
          ])

        request = ir(g2_messages() ++ [scope])

        assert :ok = RequestIR.validate(request)
        assert [read] = RequestIR.visible_observations(request)
        assert read.status == "ok"
        assert read.source_refs == [%{ref: "character:1", version: 2}]
        assert read.content == %{"narrative_role" => "ENSEMBLE_POV"}
        refute Map.has_key?(read, :provenance)
      end
    end

    test "可见观察只来自实际消息，计划叶保留分页与不完整状态而引用表不生成材料" do
      request =
        ir(
          g2_messages() ++
            [
              message(:assistant, :model, [
                RequestIR.tool_call_block("agent_plan_draft", %{}, "call-plan")
              ]),
              message(:tool, :tool_result, [
                RequestIR.observation_block("call-plan", %{
                  status: "partial",
                  source_refs: [%{ref: "memory:actual"}],
                  content: %{
                    tool: "planned_exploration",
                    observations: [
                      %{
                        status: "partial",
                        source_refs: [%{ref: "memory:actual"}],
                        versions: %{"memory:actual" => 4},
                        coverage: %{text: %{status: "partial", start: 0, end: 6}},
                        omissions: ["后半段尚未读取"],
                        next_offset: 6,
                        content: %{summary: "逐字材料前六字"}
                      }
                    ]
                  }
                })
              ])
            ],
          refs: %{
            base_refs: base_refs(),
            observation_refs: [%{ref: "memory:actual"}, %{ref: "memory:not-supplied"}],
            used_refs: []
          }
        )

      assert :ok = RequestIR.validate(request)
      assert [character, memory] = RequestIR.visible_observations(request)
      assert character.content == %{"narrative_role" => "ENSEMBLE_POV"}
      assert character.source_refs == [%{ref: "character:1", version: 2}]

      assert memory == %{
               status: "partial",
               source_refs: [%{"ref" => "memory:actual"}],
               versions: %{"memory:actual" => 4},
               coverage: %{"text" => %{"status" => "partial", "start" => 0, "end" => 6}},
               omissions: ["后半段尚未读取"],
               next_offset: 6,
               content: %{"summary" => "逐字材料前六字"}
             }
    end

    test "canonical projection 只承载调用政策，prepare_request 不查询 Gateway" do
      ir = ir(g1_messages())
      assert ir.projection == %{usage_streaming: false}
      assert :ok = RequestIR.validate(ir)

      assert {:ok, prepared} =
               RequestIR.prepare_request(ir,
                 tool_names: ["read_character"],
                 tool_choice: "required"
               )

      assert prepared.tools == tools()
      assert prepared.projection[:tool_choice] == "required"
      assert prepared.messages == ir.messages
      assert prepared.refs == ir.refs
      assert prepared.run == ir.run
      assert ir.tools == tools()

      assert {:error, {:unknown_tool_names, ["missing"]}} =
               RequestIR.prepare_request(ir, tool_names: ["missing"])
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
      assert {:error, {:pending_tool_calls, ["pending"]}} = RequestIR.prepare_request(pending)

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
               RequestIR.prepare_request(ir(messages))
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

  defp scope_message(content \\ %{}, extra \\ %{}) do
    scope =
      Map.merge(
        %{
          work_id: "work-1",
          facts: %{work: %{ref: "work:work-1", work_id: "work-1", version: 3}}
        },
        content
      )

    message(
      :scope_update,
      :application,
      [RequestIR.scope_block(scope)],
      Map.merge(%{source_refs: base_refs(), versions: %{"work" => 3}}, extra)
    )
  end

  describe "R02 结构化 Scope 的纯数据边界" do
    test "已绑定作者目标只投来源，独立应用解释不依文字相等而被删除" do
      goal = %{text: @author_text, source_ref: "author_turn:turn-1", version: 2}

      request =
        RequestIR.append_scope_update(
          ir(g1_messages()),
          %{work_id: "work-1", goal: goal},
          %{"scope_revision" => 1},
          []
        )

      assert :ok = RequestIR.validate(request)
      [scope] = Enum.filter(request.messages, &(&1.role == "scope_update"))

      assert hd(scope.blocks).content["goal"] ==
               %{"source_input_ref" => "author_turn:turn-1", "version" => 2}

      assert goal.text == @author_text

      for target <- ~w(chat_completions responses_api anthropic_messages) do
        assert {:ok, wire} = Projection.project(request, target)
        assert length(String.split(Jason.encode!(wire), @author_text)) == 2
      end

      independent =
        RequestIR.scope_block(%{goal: %{text: @author_text, provenance: "application"}})

      assert independent.content["goal"]["text"] == @author_text
    end

    test "来源分立：事实供应于 Base，作者来源不被提升为事实或观察" do
      author = "  作者原话\n原样保留。 "
      author_ref = %{ref: "author_turn:scope-1"}

      scope =
        scope_message(
          %{goal: %{text: "应用解释的目标", source_input_ref: author_ref.ref}},
          %{source_refs: base_refs() ++ [author_ref]}
        )

      request =
        ir([
          scope,
          message(:user, :author, [RequestIR.text_block(author)], %{source_refs: [author_ref]})
        ])

      assert :ok = RequestIR.validate(request)
      assert [%{type: "scope", content: content}] = scope.blocks
      assert content["facts"]["work"]["version"] == 3
      assert content["goal"]["source_input_ref"] == author_ref.ref
      assert request.refs.base_refs == base_refs()
      assert request.refs.observation_refs == []
      assert List.last(request.messages).blocks == [RequestIR.text_block(author)]
    end

    test "scope 只属于一个 application scope_update，不冒充作者、模型或工具" do
      valid = scope_message()

      for invalid <- [
            %{valid | role: "user", provenance: "author"},
            %{valid | role: "assistant", provenance: "model"},
            %{valid | role: "tool", provenance: "tool_result"},
            %{valid | provenance: "model"},
            %{valid | blocks: valid.blocks ++ [RequestIR.text_block("旁路材料")]},
            %{valid | blocks: valid.blocks ++ valid.blocks}
          ] do
        assert {:error, :invalid_scope_owner} = RequestIR.validate(ir([invalid]))
      end

      assert {:error, :malformed_block} =
               RequestIR.validate(ir([%{valid | blocks: [nil]}]))
    end

    test "同作品、唯一对象与实际供应来源分别校验，嵌套关系 ref 不算第二实体" do
      work = %{ref: "work:work-1", work_id: "work-1", version: 3}

      invalid = [
        {scope_message(%{work_id: "work-other"}), :scope_work_mismatch},
        {scope_message(%{facts: %{work: %{work | work_id: "work-other"}}}),
         :scope_fact_work_mismatch},
        {scope_message(%{facts: %{work: Map.delete(work, :ref)}}), :invalid_scope_fact_ref},
        {scope_message(%{facts: %{work: %{work | ref: " "}}}), :invalid_scope_fact_ref},
        {scope_message(%{facts: %{work: work, chapters: [work]}}), :duplicate_scope_fact},
        {scope_message(%{}, %{source_refs: []}), :scope_fact_without_source}
      ]

      for {scope, reason} <- invalid do
        assert {:error, ^reason} = RequestIR.validate(ir([scope]))
      end

      assert {:error, :scope_source_not_supplied} =
               RequestIR.validate(
                 ir([scope_message()],
                   refs: %{base_refs: [], observation_refs: [], used_refs: []}
                 )
               )

      related = Map.put(work, :related, %{ref: "work:work-1", role: "reference"})
      assert :ok = RequestIR.validate(ir([scope_message(%{facts: %{work: related}})]))
    end

    test "版本只约束同一快照内一致；合法的新事实版本不被历史 scope 阻断" do
      older = scope_message(%{}, %{versions: %{"work" => 3, "scope_revision" => 1}})

      newer =
        scope_message(
          %{facts: %{work: %{ref: "work:work-1", work_id: "work-1", version: 4}}},
          %{versions: %{"work" => 4, "scope_revision" => 2}}
        )

      assert :ok = RequestIR.validate(ir([older, newer]))
      assert hd(ir([older, newer]).messages) == older

      for versions <- [%{"work" => 2}, %{}] do
        assert {:error, :scope_work_version_mismatch} =
                 RequestIR.validate(ir([scope_message(%{}, %{versions: versions})]))
      end

      assert {:error, :scope_work_version_mismatch} =
               RequestIR.validate(ir([scope_message(%{facts: %{}})]))

      assert :ok =
               RequestIR.validate(
                 ir([scope_message(%{facts: %{}}, %{versions: %{"scope_revision" => 1}})])
               )
    end

    test "内容仅接受 JSON 值与声明形状；未知嵌套 JSON 键原样保留" do
      opaque = %{
        "未知键" => %{"role" => "literal", "versions" => %{"future" => [false, nil, "  中文\n"]}}
      }

      scope = scope_message(%{context: opaque})
      assert :ok = RequestIR.validate(ir([scope]))
      assert hd(scope.blocks).content["context"] == opaque

      omissions = [
        %{
          source: "chapters",
          reason: "budget_limited",
          count: 2,
          replacement: nil,
          detail: %{"source/path" => [1, true]}
        }
      ]

      scope = scope_message(%{omissions: omissions})
      assert :ok = RequestIR.validate(ir([scope]))
      assert hd(scope.blocks).content["omissions"] == RequestIR.json_value(omissions)

      for value <- [self(), fn -> :ok end, {:tuple, 1}, ~D[2026-11-14], <<255>>] do
        assert {:error, :invalid_scope_content} =
                 RequestIR.validate(ir([scope_message(%{context: %{value: value}})]))
      end

      for content <- [
            %{work_id: 42},
            %{facts: nil},
            %{facts: %{chapters: %{}}},
            %{facts: %{characters: [nil]}},
            %{goal: "不能用文本代替结构目标"},
            %{context: false},
            %{coverage: nil},
            %{omissions: [42]},
            %{omissions: ["旧文本省略说明"]},
            %{omissions: [%{}]},
            %{omissions: [%{source: "chapters", reason: ""}]},
            %{omissions: [%{source: nil, reason: "budget_limited"}]}
          ] do
        assert {:error, :invalid_scope_content} =
                 RequestIR.validate(ir([scope_message(content)]))
      end

      for metadata <- [%{versions: nil}, %{source_refs: [nil]}, %{source_refs: "work:work-1"}] do
        assert {:error, :invalid_scope_metadata} =
                 RequestIR.validate(ir([scope_message(%{}, metadata)]))
      end
    end

    test "未读不伪装零；空集合、局部和已知的陈旧覆盖保持各自事实" do
      for coverage <- [
            %{status: "not_read"},
            %{status: "unavailable"},
            %{status: "complete", count: 0, returned: 0, total: 0},
            %{status: "partial", returned: 2, total: 5},
            %{status: "stale", count: 2}
          ] do
        assert :ok =
                 RequestIR.validate(ir([scope_message(%{coverage: %{chapters: coverage}})]))
      end

      for coverage <- [
            %{status: "not_read", count: 0},
            %{status: "unavailable", total: 0},
            %{status: "complete", count: -1},
            %{status: "complete", count: 0.5},
            %{status: "complete", returned: 2, total: 5},
            %{status: "partial", returned: 6, total: 5},
            %{status: "invented"},
            nil
          ] do
        assert {:error, :invalid_scope_content} =
                 RequestIR.validate(ir([scope_message(%{coverage: %{chapters: coverage}})]))
      end
    end

    test "真实历史文本保留为原证据，新生产 API 只追加结构化 Scope" do
      text = "  历史应用材料\n不从这段字里推定版本或权限。 "
      historical = message(:scope_update, :application, [RequestIR.text_block(text)])
      original = ir([historical])
      current = hd(scope_message().blocks).content

      appended = RequestIR.append_scope_update(original, current, %{"work" => 3}, base_refs())

      assert :ok = RequestIR.validate(appended)
      assert hd(appended.messages) == historical
      assert List.last(appended.messages).blocks == [RequestIR.scope_block(current)]
      assert hd(hd(appended.messages).blocks).text == text
    end
  end
end
