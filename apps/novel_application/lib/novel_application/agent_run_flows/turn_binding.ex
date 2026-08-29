defmodule NovelApplication.AgentRunFlows.TurnBinding do
  @moduledoc """
  AgentRun step turn_id 的构造 + Logger metadata 绑定单点（B15，2026-08-26）。

  ## 为什么存在

  `LogEmit.emit/4` 按 ADR-0018 §2 从 `Logger.metadata` 取关联键（turn_id /
  work_id / session_id …），而 metadata 是**进程本地**的。主链路 2026-06-29 迁进
  bounded AgentRun 后，工具在 run server 进程执行，各 flow 只在自己的上下文组装
  函数里调过 `LogContext.put_turn`，工具执行步没有绑——于是
  `toolbox.execute.start/done/error` 三个事件的 turn_id 长期为空。

  后果不是产品行为错，而是**证据链断**：`p1-chapter-expansion` /
  `p1-chapter-overwrite-confirm` 两个 P1 场景的 verifier behavior 门
  （`turnsHaveEvent([draft_turn_id], …, "toolbox.execute.done")`）永远匹配不上。
  产物实证：老产物（工具跑在 channel 进程）`au05-adoption-boundary` 事件带
  `turn_id=turn_3`、`p1-100k-dogfood` 248/842 带；M4 狗粮（2026-07-29）起全部为 0。

  ## 设计

  把「构造 turn_id」与「绑定 metadata」合成同一个调用，使得**拿到 turn_id 的路径
  必然已经绑定**，避免同类漂移再次发生（原实现里两件事分处两地，新增 step 时很容易
  只做前者）。`frame/3` 是所有工具执行步的必经点，因此绑定挂在那里最省且最全。
  """

  alias NovelCommon.LogContext

  @typedoc "AgentRun step 序号，或 ledger_reconcile / provider_progress 这类具名步。"
  @type sequence :: non_neg_integer() | String.t() | atom()

  @doc """
  构造本 step 的 turn_id 并绑定进当前进程 Logger metadata，返回 turn_id。

  绑定语义沿用 `LogContext.put_turn/4`：写入 workspace/work/turn/session，并把上一
  step 的 frame/behavior/decision/tool_request 键清空（新 step 从干净关联板起步）。
  """
  @spec bind(struct(), sequence()) :: String.t()
  def bind(run, sequence) do
    turn_id = turn_id(run, sequence)
    LogContext.put_turn(run.workspace_id, run.work_id, turn_id, run.session_id)
    turn_id
  end

  @doc "只构造不绑定——仅供已在同一 step 内绑过的调用点复用，避免重复清空关联键。"
  @spec turn_id(struct(), sequence()) :: String.t()
  def turn_id(run, sequence), do: "#{run.parent_turn_ref}:agent:#{sequence}"
end
