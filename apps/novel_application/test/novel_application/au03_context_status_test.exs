defmodule NovelApplication.AU03ContextStatusTest do
  @moduledoc """
  AU03-CONTEXT CP1：读取失败/未知/真实空在同次模型输入中的安全表达。

  不新建 Context 架构；在 DialogueContext 上 additive `source_status`，由 fetcher 状态驱动，
  使“读取失败”不能被渲染成“新对话/尚未创建作品”，真实空仍可渲染为零/无。
  """
  use ExUnit.Case, async: true

  alias NovelApplication.{ContextAssembler, DialoguePlanningService}
  alias NovelDomain.DialogueContext

  @author_text "第03章正文里有没有提到旧账？只按当前作品事实回答。"

  defp block(context), do: DialoguePlanningService.judgment_context_block(context, @author_text)

  defp raising_fetcher, do: fn _ws, _text, _session -> raise "au03_simulated_db_failure" end

  defp non_ok_fetcher, do: fn _ws, _text, _session -> {:error, :db_unavailable} end

  defp statuses(overrides) do
    Map.merge(
      %{
        work: :ok,
        conversation: :empty,
        memory: :empty,
        behavior: :empty,
        chapters: :ok,
        interaction: :empty
      },
      overrides
    )
  end

  test "fetcher raise → source_status 标 unavailable，prompt 明确未知且不声称新对话/空作品" do
    context = ContextAssembler.assemble_for_input("ws-au03", @author_text, raising_fetcher(), [])

    assert %DialogueContext{} = context
    assert context.source_status[:work] == :unavailable
    assert context.source_status[:chapters] == :unavailable
    assert context.source_status[:conversation] == :unavailable

    text = block(context)
    assert text =~ "## 上下文可用性"
    assert text =~ "读取失败"
    refute text =~ "无——这是新对话或尚未创建作品"
    refute text =~ "全书 0 章"
    assert context.context_refs == []
  end

  test "fetcher 非 {:ok,...} → 同样 unavailable 而不是空作品" do
    context = ContextAssembler.assemble_for_input("ws-au03", @author_text, non_ok_fetcher(), [])

    assert context.source_status[:work] == :unavailable
    text = block(context)
    assert text =~ "## 上下文可用性"
    refute text =~ "无——这是新对话或尚未创建作品"
  end

  test "生产扩展合同（9 元组 statuses）：work 成功 + chapters 失败 → 保留已知事实、章节标未知、不渲染 0 章" do
    fetcher = fn _ws, _text, _session ->
      {:ok, %{title: "灯楼夜雨", genre: "悬疑"}, nil, nil, nil, [], [], %{},
       statuses(%{chapters: :unavailable})}
    end

    context = ContextAssembler.assemble_for_input("ws-au03", @author_text, fetcher, [])

    assert context.source_status[:work] == :ok
    assert context.source_status[:chapters] == :unavailable

    text = block(context)
    assert text =~ "灯楼夜雨"
    assert text =~ "## 上下文可用性"
    assert text =~ "章节"
    refute text =~ "无——这是新对话或尚未创建作品"
    refute text =~ "全书 0 章"
  end

  test "真实空作品（成功读取、无章）→ 可渲染 0 章/无，但不声明读取失败" do
    fetcher = fn _ws, _text, _session ->
      {:ok, %{title: "真实空作品"}, nil, nil, nil, [], [], %{}, statuses(%{chapters: :empty})}
    end

    context = ContextAssembler.assemble_for_input("ws-au03", @author_text, fetcher, [])
    text = block(context)

    assert context.source_status[:chapters] == :empty
    assert text =~ "真实空作品"
    assert text =~ "0 章中已写 0 章"
    refute text =~ "## 上下文可用性"
  end

  test "work-only（无会话/记忆）→ 不声称刚才讨论，也不把成功缺段说成读取失败" do
    fetcher = fn _ws, _text, _session ->
      {:ok, %{title: "只有作品"}, nil, nil, nil}
    end

    context = ContextAssembler.assemble_for_input("ws-au03", @author_text, fetcher, [])

    assert context.source_status[:work] == :ok
    assert context.source_status[:conversation] == :empty

    text = block(context)
    assert text =~ "只有作品"
    assert text =~ "0 章中已写 0 章"
    refute text =~ "## 上下文可用性"
    refute text =~ "无——这是新对话或尚未创建作品"
  end

  test "旧 fetcher（5 元组空）→ 兼容既有语义：无事实时仍可渲染新对话/尚未创建" do
    empty = fn _ws, _text, _session -> {:ok, nil, nil, nil, nil} end

    context = ContextAssembler.assemble_for_input("ws-au03", @author_text, empty, [])

    assert context.source_status[:work] == :empty
    assert block(context) =~ "无——这是新对话或尚未创建作品"
  end

  test "DialogueContext.to_prompt_text 也消费 source_status（available 与 unavailable 分流）" do
    unavailable = %DialogueContext{
      workspace_id: "ws-au03",
      current_work_snapshot: nil,
      source_status: %{work: :unavailable}
    }

    text = DialogueContext.to_prompt_text(unavailable)
    assert text =~ "读取失败"
    refute text =~ "无——这是新对话或尚未创建作品"

    legacy = %DialogueContext{workspace_id: "ws-au03", current_work_snapshot: nil}
    assert DialogueContext.to_prompt_text(legacy) =~ "无——这是新对话或尚未创建作品"
  end

  test "source_status_summary 供 trace/观测的 author-safe 摘要" do
    summary =
      DialogueContext.source_status_summary(%DialogueContext{
        workspace_id: "ws-au03",
        source_status: %{
          work: :unavailable,
          chapters: :ok,
          conversation: :unknown,
          memory: :empty
        }
      })

    assert summary.sources == %{
             "work" => "unavailable",
             "chapters" => "ok",
             "conversation" => "unknown",
             "memory" => "empty"
           }

    assert summary.unavailable_sources == ["work"]
    assert summary.unknown_sources == ["conversation"]

    assert DialogueContext.source_status_summary(%DialogueContext{workspace_id: "ws"}) == %{
             sources: %{},
             unavailable_sources: [],
             unknown_sources: []
           }
  end
end
