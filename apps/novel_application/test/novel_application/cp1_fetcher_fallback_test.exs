defmodule NovelApplication.CP1FetcherFallbackTest do
  @moduledoc """
  VS-00C CP1（关 G10 / AU-03 SC-B3）：context fetcher 异常时不阻断整轮，
  降级为明确空上下文，让 Planner 后续诚实说明读不到，而不是整轮崩溃或编造。
  """
  use ExUnit.Case, async: true

  alias NovelApplication.ContextAssembler
  alias NovelDomain.DialogueContext

  test "fetcher 抛异常 → 降级为明确空上下文，不崩" do
    raising = fn _ws, _text -> raise "db hiccup" end

    ctx = ContextAssembler.assemble_for_input("w1", "主角现在在哪", raising)

    assert %DialogueContext{} = ctx
    refute DialogueContext.has_context?(ctx)
    assert ctx.current_work_snapshot == nil
    assert ctx.current_chapters == []
    # envelope 仍带默认策略（floor），保证下游读取安全。
    assert ctx.assembly_policy != nil
  end

  test "fetcher 返回非 {:ok,...} → 同样降级为空上下文" do
    bad = fn _ws, _text -> {:error, :boom} end

    ctx = ContextAssembler.assemble_for_input("w1", "x", bad)

    assert %DialogueContext{} = ctx
    refute DialogueContext.has_context?(ctx)
  end

  test "正常 fetcher 不受影响" do
    ok = fn _ws, _text -> {:ok, %{"title" => "作品"}, nil, nil, nil, ["第一章"]} end

    ctx = ContextAssembler.assemble_for_input("w1", "x", ok)

    assert ctx.current_work_snapshot == %{"title" => "作品"}
    assert ctx.current_chapters == ["第一章"]
  end
end
