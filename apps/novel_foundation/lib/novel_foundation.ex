defmodule NovelFoundation do
  @moduledoc """
  Shared Kernel —— 项目内所有 app 共享的基础能力。

  本 app 是无业务语义的纯工具库。不包含：
  - OTP 进程（GenServer / Supervisor / Registry / DynamicSupervisor）
  - 业务概念（Workspace / Author / Agent / Work / Chapter）
  - 外部依赖（Ecto / Phoenix / Provider）

  未来根据需要在此添加：
  - `NovelFoundation.Result` —— Result/Error 类型与组合子
  - `NovelFoundation.Error` —— 统一 Error struct
  - `NovelFoundation.ID` —— ID 生成（UUID v7, prefix 规则）
  - `NovelFoundation.Clock` —— 可注入时间源
  - `NovelFoundation.Pagination` —— 分页参数与游标
  - `NovelFoundation.Validation` —— 通用校验 helper
  - `NovelFoundation.Telemetry` —— Telemetry 事件定义
  """
end
