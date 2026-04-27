defmodule NovelApplication do
  @moduledoc """
  Application 层根模块。

  本 app 负责用例编排，协调 Agent Runtime 与 Domain：
  - 上下文组装与策略选择
  - 用例流程编排（创建工作、推进章节、改稿等）
  - Prompt 构建
  - 领域对象注册

  依赖方向：novel_agent + novel_domain → novel_application
  不依赖：novel_web / novel_persistence
  """
end
