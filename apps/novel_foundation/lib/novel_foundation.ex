defmodule NovelFoundation do
  @moduledoc """
  Shared Kernel —— 项目内所有 app 共享的基础能力。

  本 app 是无业务语义的纯工具库。禁止包含：
  - OTP 进程（GenServer / Supervisor / Registry / DynamicSupervisor）
  - 业务概念（Workspace / Author / Agent / Work / Chapter）
  - 外部依赖（Ecto / Phoenix / Provider）

  需要时按 YAGNI 原则在此添加模块，不提前占位。
  """
end
