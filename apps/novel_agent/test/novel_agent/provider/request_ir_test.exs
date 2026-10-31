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

  describe "IR v1 数据边界校验" do
    test "G1 合法 IR 通过校验" do
      assert :ok = RequestIR.validate(ir(g1_messages()))
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

      assert {:error, {:forbidden_tool_name, "canon_write"}} =
               RequestIR.validate(ir(messages))
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
end
