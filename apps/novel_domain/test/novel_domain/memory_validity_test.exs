defmodule NovelDomain.MemoryValidityTest do
  use ExUnit.Case, async: true

  alias NovelDomain.MemoryValidity

  @seq_map %{"ch2" => 2, "ch4" => 4, "ch8" => 8}

  test "无窗口始终有效；窗口内有效；两侧越界无效" do
    assert MemoryValidity.within_window?(nil, nil, 5, @seq_map)

    assert MemoryValidity.within_window?(
             %{"chapter_id" => "ch2"},
             %{"chapter_id" => "ch4"},
             3,
             @seq_map
           )

    refute MemoryValidity.within_window?(%{"chapter_id" => "ch8"}, nil, 3, @seq_map)
    refute MemoryValidity.within_window?(nil, %{"chapter_id" => "ch4"}, 5, @seq_map)
  end

  test "目标位置未知时不约束（诚实未知）" do
    assert MemoryValidity.within_window?(%{"chapter_id" => "ch8"}, nil, nil, @seq_map)
    assert MemoryValidity.within_window?(nil, %{"chapter_id" => "ch2"}, nil, @seq_map)
  end

  test "窗口边界章节不存在时该侧不约束，另一侧仍生效" do
    assert MemoryValidity.within_window?(%{"chapter_id" => "missing"}, nil, 1, @seq_map)

    refute MemoryValidity.within_window?(
             %{"chapter_id" => "missing"},
             %{"chapter_id" => "ch2"},
             3,
             @seq_map
           )

    assert MemoryValidity.within_window?(
             %{"chapter_id" => "ch2"},
             %{"chapter_id" => "missing"},
             8,
             @seq_map
           )
  end
end
