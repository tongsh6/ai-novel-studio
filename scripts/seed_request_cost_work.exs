# B87 R01 真实基线起点：批次数据库由 source-snapshot/work.sqlite3 完整恢复，不裁剪作品。
# 本 seed 只做两件已声明的 fixture 转换：
# 1) 经现役 WorkService.rename 给目标作品设置冻结的唯一可见名（15 部作品原名相同，
#    GUI 只能按可见名选择；不改最近打开时间绕过菜单）；
# 2) 经现役 WorkSessionService.create 建立新的 ACTIVE session。
# 不修改源库；不假定服务副作用正确，prepare 会独立对账实际 title/revision/session。
alias NovelApplication.{WorkService, WorkSessionService}

work_id = System.get_env("REQUEST_COST_WORK_ID") || raise("缺少 REQUEST_COST_WORK_ID")
title = System.get_env("REQUEST_COST_WORK_TITLE") || raise("缺少 REQUEST_COST_WORK_TITLE")

session_title =
  System.get_env("REQUEST_COST_SESSION_TITLE") || raise("缺少 REQUEST_COST_SESSION_TITLE")

work =
  case WorkService.get(work_id) do
    nil -> raise "REQUEST_COST_WORK_ID 在恢复快照中不存在: #{work_id}"
    work -> work
  end

revision_before = work.revision

renamed =
  case WorkService.rename(work_id, %{"title" => title}) do
    {:ok, renamed} -> renamed
    :not_found -> raise "目标作品在 rename 时不存在: #{work_id}"
    {:error, reason} -> raise "WorkService.rename 失败: #{inspect(reason)}"
  end

if renamed.title != title do
  raise "WorkService.rename 实际标题不符合: #{inspect(renamed.title)}"
end

session =
  case WorkSessionService.create(work_id, %{"title" => session_title}) do
    {:ok, session} -> session
    {:error, reason} -> raise "WorkSessionService.create 失败: #{inspect(reason)}"
  end

if session.work_id != work_id or session.status != "ACTIVE" do
  raise "WorkSessionService.create 实际 session 不符合: #{inspect(session)}"
end

IO.puts(
  "[request-cost-seed] work_id=#{work_id} title_after=#{renamed.title} " <>
    "revision_before=#{revision_before} revision_after=#{renamed.revision} " <>
    "session_id=#{session.id} session_title=#{session.title} new_session=true"
)
