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
