defmodule NovelApplication.AuthorContentRegistrationTest do
  use ExUnit.Case, async: false

  alias NovelApplication.ArtifactAssembler
  alias NovelApplication.AuthorContentRegistration
  alias NovelDomain.DialogueContext

  test "只有明确原文登记操作消费来源，不再使用旧布尔联合条件" do
    assert :ok =
             AuthorContentRegistration.validate_author_registration(
               %{action: "reply", author_content_registration: "true"},
               []
             )

    assert {:error, {:author_content_registration_invalid, :source_required}} =
             AuthorContentRegistration.validate_author_registration(
               %{action: "author_content_registration"},
               []
             )

    assert {:error, {:author_content_registration_invalid, :source_not_available}} =
             AuthorContentRegistration.validate_author_registration(
               %{action: "author_content_registration", author_content_source_ref: "foreign"},
               []
             )

    assert :ok =
             AuthorContentRegistration.validate_author_registration(
               %{action: "author_content_registration", author_content_source_ref: "current"},
               []
             )
  end

  test "M18：current 只适用于本条消息本身即原文；指代过去资料且无显式原文时机械拒绝" do
    registration = %{action: "author_content_registration", author_content_source_ref: "current"}

    # 典型指代历史原文的保存指令：current 不成立
    assert {:error,
            {:author_content_registration_invalid,
             :anaphoric_current_source_requires_explicit_text}} =
             AuthorContentRegistration.validate_author_registration(
               registration,
               [],
               "把之前那段灯油配方的资料存进设定"
             )

    # 无指代的普通保存请求：current 合法（不误拒）
    assert :ok =
             AuthorContentRegistration.validate_author_registration(
               registration,
               [],
               "把这段灯油配方存进设定"
             )

    # 指代但本条消息显式给出原文（引号/冒号后的实质内容）：current 合法
    assert :ok =
             AuthorContentRegistration.validate_author_registration(
               registration,
               [],
               "把之前那句存进设定：“灯油用鲸脂，松脂少许”"
             )

    # 指代 + 本条消息本身是足够长的原文材料：current 合法
    assert :ok =
             AuthorContentRegistration.validate_author_registration(
               registration,
               [],
               "之前的灯油配方是：" <>
                 "鲸脂三份、松脂一份、灯芯草灰少许，混匀后静置三日再点火。"
             )
  end

  test "M18：历史来源（非 current）的机械校验不越权，由判断 prompt 约束对象匹配" do
    registration = %{
      action: "author_content_registration",
      author_content_source_ref: "turn_prev"
    }

    # current 语义之外的来源不在本机械规则里误杀：是否“来源原文就是被指代资料”
    # 由判断 prompt 规则与模型取证负责（应用侧仍按来源字节保真复制）。
    assert :ok =
             AuthorContentRegistration.validate_author_registration(
               registration,
               ["turn_prev"],
               "把之前那段灯油配方的资料存进设定"
             )
  end

  test "历史来源只从上下文白名单读取，物化不改原文字节" do
    raw = "  原文\n第二行  "

    context = %DialogueContext{
      work_id: "w",
      interaction_state: %{
        author_inputs: [%{turn_ref: "source-1", text: raw}]
      }
    }

    assert {:ok, "source-1", ^raw} =
             AuthorContentRegistration.source_text("source-1", "请存档", context, "current-2")

    assert {:error, {:author_content_registration_invalid, :source_not_available}} =
             AuthorContentRegistration.source_text("foreign-source", "请存档", context, "current-2")

    assert {:error, {:author_content_registration_invalid, :source_required}} =
             AuthorContentRegistration.source_text(nil, "把上一条原文存档", context, "current-2")

    assert {:ok, "current-2", ^raw} =
             AuthorContentRegistration.source_text("current", raw, context, "current-2")

    assert {:ok, artifact} = ArtifactAssembler.assemble_author_content("source-1", raw)
    assert hd(artifact.items).body == raw
    assert artifact.source_tool_result_ref == "author_input:source-1"

    assert {:ok, linked} =
             ArtifactAssembler.assemble_author_content("save-request-2", raw, "source-1")

    assert linked.source_turn_ref == "save-request-2"
    assert linked.source_tool_result_ref == "author_input:source-1"
    assert hd(linked.items).provider_call_ref == "author_input:source-1"
    assert hd(linked.items).body == raw
  end
end
