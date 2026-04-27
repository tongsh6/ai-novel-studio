defmodule NovelDomain do
  @moduledoc """
  Domain 层根模块。

  本 app 负责小说业务领域的纯逻辑建模：
  - 领域对象（Work / Volume / Chapter / Scene / Draft / Character 等）
  - 领域规则（状态机、约束、校验）
  - 领域事件定义

  严格禁止：OTP 进程、外部 I/O、引用其他 umbrella app。
  只允许：纯 struct + 纯函数。
  """
end
