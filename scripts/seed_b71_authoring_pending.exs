# B71 CP4b pending 对话候选作者边界：只建立空作品与活动会话。
#
# 本 seed 不预造候选、AgentRun、ProviderRun、TurnResult 或 author_action receipt；
# 真实候选/采纳/放弃/恢复/后续问答全部由外部原生驱动在真实工作台产生。
# 唯一输出是 work_id/session_id，供 native_b71_evidence prepare 绑定目标。
alias NovelApplication.{WorkService, WorkSessionService}

unique = System.unique_integer([:positive, :monotonic])

{:ok, work} =
  WorkService.create(%{
    "title" => "B71 pending author boundary #{unique}",
    "genre" => "赛博修仙",
    "core_selling_point" => "pending 对话作者采纳/放弃边界原生取证"
  })

{:ok, %{active_session: session}} = WorkSessionService.resume(work.id)

IO.puts(
  "[b71-authoring-pending-seed] work_id=#{work.id} session_id=#{session.id}"
)
