defmodule NovelAgent.Test.Provider.SliceVerifyPendingRevision do
  @moduledoc """
  仅测试支持：SliceVerify 普通待采纳候选修订的识别与确定性改名产物。

  从当前原生 Scope 读取任务身份，保留原候选全文、请求指纹及既有输出结构。
  主替身负责分派顺序；这里不读取候选目录、选择目标或执行采纳。
  """

  alias NovelTest.TestProviderPrompt

  def matches?(prompt) do
    task = get_in(TestProviderPrompt.scope_content(prompt) || %{}, ["authoring_task"]) || %{}

    task["kind"] == "revision" and task["operation_effect"] == "revise_candidate"
  end

  def items(materials, context) do
    original = context |> String.split("：\n", parts: 2) |> List.last()
    body = String.replace(original, "沈砚", "林渡")

    [
      %{
        item_id: "revision_#{:erlang.phash2(materials)}",
        title: "旧书铺修订稿",
        body: body,
        rationale: "按作者要求修改名字，原稿保留。"
      }
    ]
  end
end
