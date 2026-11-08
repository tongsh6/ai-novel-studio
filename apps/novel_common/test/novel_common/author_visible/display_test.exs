defmodule NovelCommon.AuthorVisible.DisplayTest do
  use ExUnit.Case, async: true

  alias NovelCommon.AuthorVisible.Display
  alias NovelCommon.AuthorVisible.Text

  describe "Display.label/2" do
    test "已登记 code 返回作者显示名（tool/provider/status/model）" do
      assert Display.label(:tool, "prose_writing") == "正文写作"
      assert Display.label("tool", "submit_tentative_artifact") == "保存候选草稿"
      # 2026-11-08 作者裁决：生产显示名 SSOT 不登记测试替身；未登记 code 走
      # 作者安全 fallback（不含内部 code），不再给测试环境专名。
      assert Display.label(:provider, :stub) == "当前模型服务"
      assert Display.label(:provider, :slice_verify) == "当前模型服务"
      assert Display.label(:provider, "strata") == "本地模型"
      assert Display.label(:status, "ACCEPTED") == "已采纳"
      assert Display.label(:status, "EDITED_ACCEPTED") == "已采纳（修订后）"
      assert Display.label(:model, "__default__") == "当前模型"
    end

    test "未登记 code 返回作者安全兜底文案，绝不回显内部 code" do
      for {kind, code} <- [
            {:tool, "new_unregistered_tool"},
            {:provider, "private_provider_id"},
            {:status, "SOME_INTERNAL_STATE"},
            {:error_code, "fresh_error_code"}
          ] do
        label = Display.label(kind, code)

        assert is_binary(label) and label != ""
        refute label =~ code
        assert label == Display.fallback(kind)
      end
    end

    test "labels/2 拼接与 known?/2" do
      assert Display.labels(:tool, ["prose_writing", "chapter_mission"]) == "正文写作、章节目标"
      assert Display.known?(:tool, "prose_writing")
      refute Display.known?(:tool, "unknown_tool")
    end

    test "每个 domain 都有兜底文案（作者面不会出现空文本）" do
      for kind <- Display.kinds() do
        assert is_binary(Display.fallback(kind)) and Display.fallback(kind) != ""
      end
    end
  end

  describe "SSOT 元数据" do
    test "forbidden tokens 包含协议 code / 中文内部术语 / 内部标识 / ref 模式" do
      tokens = Display.forbidden_tokens()

      assert "prose_writing" in tokens["protocol_codes"]
      assert "工作过程" in tokens["internal_terms_zh"]
      assert "Stub" in tokens["internal_identifiers"]
      assert "slice_verify" in tokens["internal_identifiers"]
      assert is_list(tokens["allow"])
      assert is_list(tokens["ref_patterns"]) and tokens["ref_patterns"] != []
    end

    test "source_hash 是 64 位 hex，且与前端生成物一致（双端 codegen 同源）" do
      hash = Display.source_hash()
      assert hash =~ ~r/^[0-9a-f]{64}$/

      frontend_ts =
        Path.expand(
          "../../../../../frontend/src/generated/author_visible/displayNames.ts",
          __DIR__
        )

      assert File.exists?(frontend_ts), "前端 displayNames.ts 未生成（运行 pnpm codegen:author-visible）"

      assert File.read!(frontend_ts) =~ ~s(SOURCE_HASH = "#{hash}")
    end
  end

  describe "Text" do
    test "from_display 产出作者可见文本 struct（未登记 code 走兜底）" do
      assert %Text{text: "正文写作"} = Text.from_display(:tool, "prose_writing")
      assert %Text{text: "创作操作"} = Text.from_display(:tool, "unregistered_tool")
      assert Text.text(Text.from_display(:status, "ACCEPTED")) == "已采纳"
    end

    test "new/1 拒绝空文本；join/1 拼接多个作者可见文本" do
      assert_raise ArgumentError, fn -> Text.new("") end

      joined =
        Text.join([
          Text.from_display(:tool, "prose_writing"),
          Text.from_display(:tool, "chapter_mission")
        ])

      assert Text.text(joined) == "正文写作、章节目标"
      assert Text.text(Text.join([])) == "无"
    end
  end
end
