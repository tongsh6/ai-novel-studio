# VS00G 触发 C：两份真实十章作品分别验证去重关闭与作者显式启动。
# 正文/摘要复用 AU14 已冻结种子，不预制 finding、提议或裁决。
alias NovelApplication.WorkService

works =
  for {key, title} <- [
        {"dismiss", "VS00G 触发 C 关闭与去重"},
        {"start", "VS00G 触发 C 显式盘点"}
      ] do
    {_result, binding} = Code.eval_file("scripts/seed_au14_finding_inventory_arc.exs")
    work = Keyword.fetch!(binding, :work)
    session_id = Keyword.fetch!(binding, :session_id)
    {:ok, renamed} = WorkService.rename(work.id, %{"title" => title, "revision" => work.revision})
    {key, renamed, session_id}
  end

fields =
  Enum.flat_map(works, fn {key, work, session_id} ->
    ["#{key}_work_id=#{work.id}", "#{key}_work_title=#{work.title}", "#{key}_session_id=#{session_id}"]
  end)

IO.puts("[vs00g-trigger-c-seed] #{Enum.join(fields, " ")}")
