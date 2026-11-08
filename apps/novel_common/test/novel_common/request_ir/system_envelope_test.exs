defmodule NovelCommon.RequestIR.SystemEnvelopeTest do
  # 2026-11-08 B71 复审 P1-2：system 规则/版本落地（2026-11-06 作者裁决 A）在
  # common 层无直接测试。本文件锁定稳定 system 前缀的渲染顺序、版本字段透传与
  # validate 边界，防止字段名漂移、版本行丢失或校验放松后无人发现。
  use ExUnit.Case, async: true

  alias NovelCommon.RequestIR
  alias NovelCommon.RequestIR.Projection
  alias NovelCommon.RequestIR.SystemEnvelope
  alias NovelCommon.SystemIdentity

  @author_text "把沈砚的年龄改成三十岁"

  defp valid_ir(system) do
    RequestIR.new(%{
      run: %{run_id: "run-system-envelope", work_id: "work-1", goal: %{text: "读取作品事实后给出候选"}},
      system: system,
      messages: [
        RequestIR.message(:application_base, :application, [
          RequestIR.text_block("run goal: 读取作品事实并生成 tentative 候选")
        ]),
        RequestIR.message(:user, :author, [RequestIR.text_block(@author_text)], %{
          source_refs: [%{ref: "author_turn:turn-1"}]
        })
      ],
      tools: [],
      projection: %{}
    })
  end

  defp versioned_system do
    SystemEnvelope.envelope(
      instructions: "本次你承担创作判断器的角色：结合作者原话与真实观察推进作品。",
      run_role: "creation_run",
      constitution_version: "b27-constitution-v1",
      output_protocol_version: "b26-tools-v1",
      output_schema_ref: "authoring-output/v1"
    )
  end

  describe "system_text/1 稳定前缀渲染" do
    test "身份 + 版本 + 规则按固定顺序渲染，版本行逐字透传" do
      text = SystemEnvelope.system_text(versioned_system())

      assert String.starts_with?(text, SystemIdentity.content())

      identity_at = :binary.match(text, SystemIdentity.content()) |> elem(0)

      constitution_at =
        :binary.match(text, "constitution_version: b27-constitution-v1") |> elem(0)

      protocol_at = :binary.match(text, "output_protocol_version: b26-tools-v1") |> elem(0)
      schema_at = :binary.match(text, "output_schema_ref: authoring-output/v1") |> elem(0)
      rules_at = :binary.match(text, "本次你承担创作判断器的角色") |> elem(0)

      assert identity_at < constitution_at
      assert constitution_at < protocol_at
      assert protocol_at < schema_at
      assert schema_at < rules_at

      # 身份只出现一次；版本行与规则不重复。
      assert length(String.split(text, SystemIdentity.content())) - 1 == 1
      assert length(String.split(text, "constitution_version:")) - 1 == 1
      assert length(String.split(text, "本次你承担创作判断器的角色")) - 1 == 1
    end

    test "缺省版本字段不渲染版本行，也不产生空行" do
      system = SystemEnvelope.envelope(instructions: "只在本轮授权范围内行动。")
      text = SystemEnvelope.system_text(system)

      refute text =~ "constitution_version"
      refute text =~ "output_protocol_version"
      refute text =~ "output_schema_ref"
      # 身份文本自身末尾带换行；缺省版本不得插入额外空段。
      assert text == SystemIdentity.content() <> "\n\n" <> "只在本轮授权范围内行动。"
    end

    test "instructions 为非空文本时优先于 run_role" do
      system =
        SystemEnvelope.envelope(
          instructions: "完整的角色规则",
          run_role: "creation_run"
        )

      text = SystemEnvelope.system_text(system)

      assert String.ends_with?(text, "完整的角色规则")
      refute text =~ "run_role: creation_run"
    end

    test "instructions 缺省时用 run_role 生成最小规则；空串视为未提供" do
      fallback = SystemEnvelope.system_text(SystemEnvelope.envelope(run_role: "planner"))

      assert fallback =~ "run_role: planner"
      assert fallback =~ "你只能在作者授权边界内读取、计划、创作 tentative 候选、提问或报告缺口"
      assert fallback =~ "不存在采纳/写入 canon 的工具"

      # 空串不覆盖 run_role 兜底（非空白串才进入 role_rules）。
      empty_instructions =
        SystemEnvelope.system_text(SystemEnvelope.envelope(instructions: "", run_role: "planner"))

      assert empty_instructions == fallback
    end

    test "空 system 用 run_role 缺省生成最小规则；非 map 输入回退身份文本不崩溃" do
      empty = SystemEnvelope.system_text(%{})

      assert String.starts_with?(empty, SystemIdentity.content())
      assert empty =~ "run_role: authoring_run"
      assert empty =~ "不存在采纳/写入 canon 的工具"

      # 显式字符串键不参与渲染（envelope 只消费 atom key），回退为默认规则。
      assert SystemEnvelope.system_text("not-a-map") == SystemIdentity.content()
      assert SystemEnvelope.system_text(nil) == SystemIdentity.content()
    end
  end

  describe "validate/1 边界" do
    test "登记身份、非空版本与规则文本的 envelope 通过" do
      assert :ok = SystemEnvelope.validate(versioned_system())
      assert :ok = SystemEnvelope.validate(SystemEnvelope.envelope())

      # 缺省版本字段是合法的「本次不携带该事实」。
      assert :ok = SystemEnvelope.validate(SystemEnvelope.envelope(instructions: "规则"))
    end

    test "缺 identity_ref 或身份不匹配一律拒绝" do
      assert {:error, :missing_system_identity_ref} = SystemEnvelope.validate(%{})

      assert {:error, :missing_system_identity_ref} =
               SystemEnvelope.validate(%{identity_ref: nil})

      forged = %{
        identity_ref: %{version: "sys-identity-v1", content_hash: "forged"},
        instructions: "规则"
      }

      assert {:error, :missing_system_identity_ref} = SystemEnvelope.validate(forged)

      assert {:error, :missing_system_identity_ref} =
               SystemEnvelope.validate(%{instructions: "规则"})
    end

    test "版本/规则字段非法类型或空白文本被明确拒绝，且不回显内容" do
      base = SystemEnvelope.envelope(instructions: "规则")

      for {field, value} <- [
            {:constitution_version, 123},
            {:output_protocol_version, %{}},
            {:output_schema_ref, ["v1"]},
            {:run_role, :planner}
          ] do
        assert {:error, {:invalid_system_field, ^field}} =
                 SystemEnvelope.validate(Map.put(base, field, value))
      end

      for field <- [
            :instructions,
            :run_role,
            :constitution_version,
            :output_protocol_version,
            :output_schema_ref
          ] do
        assert {:error, {:invalid_system_field, ^field}} =
                 SystemEnvelope.validate(Map.put(base, field, "   "))
      end
    end
  end

  describe "三 wire 投影的稳定 system 前导一致" do
    test "Chat/Anthropic/Responses 的 system 文本逐字节相同，均以唯一身份开头" do
      system = versioned_system()
      ir = valid_ir(system)
      assert :ok = RequestIR.validate(ir)

      expected = SystemEnvelope.system_text(system)

      assert {:ok, chat} = Projection.project(ir, "chat_completions")
      assert [%{role: "system", content: chat_system} | _] = chat.messages

      assert {:ok, anthropic} = Projection.project(ir, "anthropic_messages")
      assert [%{type: "text", text: anthropic_system}] = anthropic.system

      assert {:ok, responses} = Projection.project(ir, "responses_api")
      assert responses.instructions == expected

      assert chat_system == expected
      assert anthropic_system == expected
      assert String.starts_with?(chat_system, SystemIdentity.content())
      assert String.starts_with?(anthropic_system, SystemIdentity.content())
      assert String.starts_with?(responses.instructions, SystemIdentity.content())
    end

    test "canonical system 消息在 Anthropic 顶层 system 中按原顺序追加，不降级为 user" do
      system = SystemEnvelope.envelope(instructions: "角色规则")

      ir =
        valid_ir(system)
        |> Map.update!(:messages, fn messages ->
          [RequestIR.message(:system, :product, [RequestIR.text_block("产品附加约束")]) | messages]
        end)

      assert :ok = RequestIR.validate(ir)

      assert {:ok, anthropic} = Projection.project(ir, "anthropic_messages")
      assert [%{type: "text", text: text}] = anthropic.system
      assert String.starts_with?(text, SystemEnvelope.system_text(system))
      assert String.ends_with?(text, "产品附加约束")

      user_texts =
        anthropic.messages
        |> Enum.filter(&(&1.role == "user"))
        |> Enum.flat_map(& &1.content)
        |> Enum.map(&Map.get(&1, :text))

      refute "产品附加约束" in user_texts
    end
  end
end
