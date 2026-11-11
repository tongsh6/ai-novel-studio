defmodule NovelCommon.RequestIRTest do
  use ExUnit.Case, async: true

  alias NovelCommon.RequestIR

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
end
