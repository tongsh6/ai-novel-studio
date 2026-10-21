defmodule NovelDomain.VolumeScopeTest do
  @moduledoc """
  B11A CP3（VS-00J §3.2 形态 A / ADR-0028）：开新卷动作的机械规划范围。

  服务端从阅读投影 TOC 机械推导「下一卷/下一章号」，不让模型/前端猜；纯函数、确定性。
  """
  use ExUnit.Case, async: true

  alias NovelDomain.VolumeScope

  defp toc do
    %{
      work_id: "work-1",
      volumes: [
        %{
          id: "vol-1",
          title: "第一卷·觉醒",
          seq: 1,
          blueprint: nil,
          chapters: [
            %{id: "ch-1", title: "第01章：起", seq: 1},
            %{id: "ch-2", title: "第02章：承", seq: 2}
          ]
        },
        %{
          id: "vol-2",
          title: "第二卷·裂变",
          seq: 2,
          blueprint: %{"goal_conflict" => "掀翻旧秩序"},
          chapters: [
            %{id: "ch-3", title: "第03章：转", seq: 3},
            %{id: "ch-4", title: "第04章：合", seq: 4}
          ]
        }
      ]
    }
  end

  describe "from_toc/1" do
    test "从末卷与全书章序推导下一卷/下一章号/现有计数" do
      assert {:ok, scope} = VolumeScope.from_toc(toc())

      assert scope == %{
               next_seq: 3,
               current_volume_seq: 2,
               current_volume_title: "第二卷·裂变",
               next_chapter_seq: 5,
               existing_volume_count: 2,
               existing_chapter_count: 4
             }
    end

    test "无卷（空 TOC/非法输入）→ {:error, :no_volume_to_extend}" do
      assert VolumeScope.from_toc(nil) == {:error, :no_volume_to_extend}
      assert VolumeScope.from_toc(%{}) == {:error, :no_volume_to_extend}
      assert VolumeScope.from_toc(%{volumes: []}) == {:error, :no_volume_to_extend}
      assert VolumeScope.from_toc("bad") == {:error, :no_volume_to_extend}
    end

    test "末卷无章（新卷刚建、章计划还没落）：下一章号从已有章序续排" do
      toc = %{
        volumes: [
          %{title: "第一卷", seq: 1, chapters: [%{seq: 1}, %{seq: 2}, %{seq: 7}]},
          %{title: "第二卷", seq: 2, chapters: []}
        ]
      }

      assert {:ok, scope} = VolumeScope.from_toc(toc)
      assert scope.current_volume_title == "第二卷"
      assert scope.next_chapter_seq == 8
      assert scope.existing_chapter_count == 3
    end

    test "卷 seq 乱序/字符串键 TOC：末卷按 max(seq) 取，章节计数跨卷" do
      toc = %{
        "volumes" => [
          %{"title" => "第二卷", "seq" => 2, "chapters" => [%{"seq" => 5}]},
          %{"title" => "第一卷", "seq" => 1, "chapters" => [%{"seq" => 1}, %{"seq" => 2}]}
        ]
      }

      assert {:ok, scope} = VolumeScope.from_toc(toc)
      assert scope.current_volume_seq == 2
      assert scope.current_volume_title == "第二卷"
      assert scope.next_seq == 3
      assert scope.next_chapter_seq == 6
      assert scope.existing_chapter_count == 3
    end

    test "末卷标题缺失 → 诚实占位「未命名卷」（不崩）" do
      toc = %{volumes: [%{seq: 1, title: "  ", chapters: []}]}
      assert {:ok, scope} = VolumeScope.from_toc(toc)
      assert scope.current_volume_title == "未命名卷"
      assert scope.next_chapter_seq == 1
    end
  end

  describe "render_section/1" do
    test "确定性渲染：含范围约束的全部必需片段" do
      {:ok, scope} = VolumeScope.from_toc(toc())
      text = VolumeScope.render_section(scope)

      assert String.starts_with?(text, "## 本轮规划范围（机械给定，不得改）")
      assert text =~ "本轮只规划下一卷：第 3 卷"
      assert text =~ "当前已有 2 卷"
      assert text =~ "当前卷《第二卷·裂变》"
      assert text =~ "下一章号从 5 开始"
      assert text =~ "不要重规划已有卷/已有章"
      assert text =~ "必须为该卷产出一条「卷蓝图：卷标题｜序号：3｜…」行"
      assert text =~ "为该卷开篇章节标注「所属卷：卷标题」"

      # 同输入同输出（提示词确定性，I-L4 同款纪律）。
      assert VolumeScope.render_section(scope) == text
    end

    test "nil/非法 scope → \"\"（诚实缺席，不改既有 prompt 字节）" do
      assert VolumeScope.render_section(nil) == ""
      assert VolumeScope.render_section(%{}) == ""
      assert VolumeScope.render_section(%{next_seq: 0, current_volume_title: "第一卷"}) == ""
      assert VolumeScope.render_section("bad") == ""
    end

    test "scope 以字符串键传入同样渲染（跨边界容错）" do
      scope = %{
        "next_seq" => 2,
        "current_volume_seq" => 1,
        "current_volume_title" => "第一卷",
        "next_chapter_seq" => 10,
        "existing_volume_count" => 1,
        "existing_chapter_count" => 9
      }

      text = VolumeScope.render_section(scope)
      assert text =~ "本轮只规划下一卷：第 2 卷"
      assert text =~ "下一章号从 10 开始"
    end
  end

  describe "normalize/1" do
    test "合法 scope 归一为 atom keys（去标题空白）" do
      assert VolumeScope.normalize(%{
               "next_seq" => 2,
               "current_volume_seq" => 1,
               "current_volume_title" => "  第一卷  ",
               "next_chapter_seq" => 4,
               "existing_volume_count" => 1,
               "existing_chapter_count" => 3
             }) == %{
               next_seq: 2,
               current_volume_seq: 1,
               current_volume_title: "第一卷",
               next_chapter_seq: 4,
               existing_volume_count: 1,
               existing_chapter_count: 3
             }
    end

    test "nil 透传；负/非整数/空标题/缺字段 → nil" do
      valid = %{
        next_seq: 2,
        current_volume_seq: 1,
        current_volume_title: "第一卷",
        next_chapter_seq: 4,
        existing_volume_count: 1,
        existing_chapter_count: 3
      }

      assert VolumeScope.normalize(nil) == nil
      assert VolumeScope.normalize(%{}) == nil

      for {key, bad} <- [
            {:next_seq, 0},
            {:next_seq, -1},
            {:next_seq, 1.5},
            {:current_volume_seq, 0},
            {:current_volume_title, ""},
            {:current_volume_title, "   "},
            {:current_volume_title, nil},
            {:next_chapter_seq, 0},
            {:existing_volume_count, -1},
            {:existing_chapter_count, 1.0}
          ] do
        assert VolumeScope.normalize(Map.put(valid, key, bad)) == nil,
               "expected #{inspect(key)}=#{inspect(bad)} to be rejected"
      end

      assert VolumeScope.normalize(Map.delete(valid, :next_seq)) == nil
    end
  end

  test "section_title/marker 常量与渲染段首一致（stub/证据共用口径）" do
    {:ok, scope} = VolumeScope.from_toc(toc())
    assert String.starts_with?(VolumeScope.render_section(scope), VolumeScope.section_title())
    assert VolumeScope.section_title() =~ VolumeScope.section_marker()
  end
end
