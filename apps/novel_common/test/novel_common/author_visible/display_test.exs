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
      refute Map.has_key?(tokens, "allow")
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
    test "HTML normal 投影只折叠可观察为同一间隔的 ASCII 空白，原值保持" do
      original = " \t林澈 \r\n调查员\f "
      assert Text.html_normal(original) == "林澈 调查员"
      assert Text.html_normal(" \t\r\n\f") == ""
      assert Text.html_normal("林澈\u00a0调查员") == "林澈\u00a0调查员"
      assert Text.text(Text.new(original)) == original
    end

    test "narrative 校验拒绝内部协议与真实身份形状，不生成清洗文本" do
      for text <- [
            "角色 character:e9fe5f90-c939-4f9e-abee-da235d1eaa45",
            "候选 as_mwnwwxoe_11",
            "调用 pcall_mwnwe414_s / prun_mwnwe414_t",
            "事件 pevt_mwnwe414_u，回合 turn_mwnwe414_v",
            "运行 run_mwnwe414_w，追踪 trace_mwnwe414_x",
            "来源 message_e9fe5f90-c939-4f9e-abee-da235d1eaa45",
            "基线 c993629b64db85ef763f5ca2c4a69f85579edd898d2d4b8b2ce73d7e335ec47e",
            "选段 seg_12_4f3a9c0b1d2e",
            "断行 break_15_0123456789ab",
            "字段 narrative_role",
            "正文 prose_writing",
            "他的工作过程缺少具体细节。character:e9fe5f90-c939-4f9e-abee-da235d1eaa45"
          ] do
        assert {:error, :author_visible_narrative_invalid} = Text.validate_narrative(text)
      end
    end

    test "合法姓名、作者文字和空白逐字保留，构造器不承担模型接受校验" do
      for text <- [
            "  老沈目前是群像视角。\n\n拟改为主角。\n",
            "笔名 Red_Moon，人物阿鸢。",
            "查看第三段。",
            "他的工作过程缺少具体细节。",
            "Stub 与 Strata 在门口争论任务控制权。"
          ] do
        assert :ok = Text.validate_narrative(text)
        assert Text.text(Text.new(text)) == text
      end

      assert Text.text(Text.new("narrative_role")) == "narrative_role"
    end

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
