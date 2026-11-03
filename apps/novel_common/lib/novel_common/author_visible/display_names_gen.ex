# AUTO-GENERATED FROM docs/design/schemas/author_visible/display_names.json — DO NOT EDIT.
# Run `mix codegen.author_visible` to regenerate; `mix codegen.author_visible --check` detects drift.
defmodule NovelCommon.AuthorVisible.DisplayNames do
  @moduledoc """
  作者可见展示名生成数据（来源 `docs/design/schemas/author_visible/display_names.json`）。

  只允许通过 `NovelCommon.AuthorVisible.Display` 查询；作者可见面不得直接使用内部 code。
  """

  @source_hash "60d8be45c07d2c88ec68a1e8694ca8ffd3c307304e73b23dfd9fea31436d577e"

  @domains %{
    "action" => %{
      "accept" => "采纳",
      "agentRunBudget.selected_steps" => "继续选定的步骤",
      "agent_run_budget_next_step" => "下一步",
      "agent_run_budget_remaining_plan" => "继续剩余计划",
      "answer_clarification" => "回答",
      "artifact.accept" => "采纳",
      "artifact.discard" => "放弃",
      "artifact.edit" => "修改",
      "artifact.supersede" => "替换为新版本",
      "author_question.option" => "选择",
      "author_question.reply" => "回复",
      "behavior.confirm" => "确认",
      "behavior.reject" => "取消",
      "cancel_pending_behavior" => "取消",
      "candidate.select" => "选择这个方向",
      "choose_candidate" => "设为后续方向",
      "confirm" => "确认",
      "confirm_before_execute" => "确认执行",
      "discard" => "放弃",
      "edit" => "修改",
      "edit_then_accept" => "修改后采纳",
      "fact_inventory.dismiss" => "关闭盘点提议",
      "fact_inventory.start" => "发起设定盘点",
      "quality.revise_from_findings" => "按质量发现修订",
      "reject" => "取消",
      "reject_or_cancel_confirmation" => "拒绝",
      "revise_from_findings" => "按质量发现修订"
    },
    "artifact_type" => %{
      "chapter_plan" => "章节计划",
      "character_evolution_memory" => "角色演化记录",
      "character_seed" => "角色设定",
      "outline" => "大纲",
      "prose_formatting_plan" => "排版计划",
      "prose_fragment" => "正文草稿",
      "world_setting" => "世界观设定"
    },
    "capability" => %{
      "character_design" => "角色设计",
      "character_evolution" => "角色演化",
      "character_roster" => "角色阵容",
      "plot_outline" => "大纲规划",
      "prose_writing" => "正文写作",
      "work_archive_read" => "作品档案查阅",
      "world_building" => "世界观设定"
    },
    "context_source" => %{
      "conversation" => "近期对话",
      "current_work" => "当前作品背景",
      "memory" => "已确认设定",
      "recent_dialogue" => "近期对话",
      "session_transcript" => "当前会话记录",
      "work_archive" => "作品档案"
    },
    "decision" => %{
      "adopt_tentative" => "已采用候选",
      "allow_agent_run" => "允许开始创作",
      "allow_tool" => "允许执行工具",
      "capability_gap" => "能力缺口",
      "clarification_required" => "需要补充信息",
      "confirmation_required" => "需要确认",
      "downgrade" => "降级为对话",
      "downgrade_to_dialogue" => "转为对话处理",
      "exploration" => "探索方向",
      "fail_with_recovery" => "已降级恢复",
      "recovery" => "已降级恢复",
      "reject" => "已拒绝执行",
      "rejected" => "已拒绝执行",
      "replay_existing" => "回放现有结果",
      "reply_only" => "AI 回应",
      "require_clarification" => "需要补充说明",
      "require_confirmation" => "需要作者确认",
      "tool_allowed" => "允许工具",
      "tool_dispatched" => "已调用工具",
      "unknown" => "已记录"
    },
    "error_code" => %{
      "auth" => "模型服务需要重新登录",
      "checkpoint_persistence_failed" => "整理失败，请稍后重试",
      "connection_refused" => "无法连接模型服务",
      "execution_in_progress" => "当前有任务在执行",
      "invalid_request" => "模型服务拒绝了这次请求",
      "invalid_response" => "模型返回内容不完整",
      "provider_internal" => "模型服务暂时不可用",
      "rate_limit" => "模型服务请求过于频繁",
      "target_missing" => "未找到目标对象",
      "timeout" => "模型响应超时",
      "transcript_not_found" => "会话记录未找到"
    },
    "frame_type" => %{
      "capability_gap" => "能力缺口",
      "casual_reply" => "回复",
      "confirmation_answer" => "确认操作",
      "creative_exploration" => "探索",
      "execution_candidate" => "候选",
      "meta_discussion" => "讨论",
      "question_answer" => "提问"
    },
    "gate" => %{
      "action_scope" => "当前请求超出本轮可执行范围。",
      "authority_budget" => "权限或预算策略要求先暂停。",
      "confirmation_required" => "此操作需要作者明确确认。",
      "planner_boundary" => "计划没有通过执行边界检查。"
    },
    "memory_scope" => %{
      "ARC" => "故事线",
      "CHAPTER" => "当前章",
      "GLOBAL" => "全局",
      "SESSION" => "当前会话",
      "VOLUME" => "当前卷",
      "WORK" => "整部作品"
    },
    "memory_source_type" => %{
      "AI_EXTRACTED" => "AI 提取",
      "AUTHOR_CONFIRMED" => "作者确认",
      "AUTHOR_CREATED" => "作者创建",
      "CHAPTER_EXTRACTED" => "章节提取",
      "SESSION_CONTEXT" => "会话上下文",
      "WORK_SETTING_IMPORTED" => "作品设定导入"
    },
    "memory_status" => %{
      "ARCHIVED" => "已归档",
      "CONFIRMED" => "已确认",
      "CONFLICTED" => "有冲突",
      "DEPRECATED" => "已弃用",
      "DRAFT" => "草稿",
      "STABILIZED" => "已稳定",
      "SUPERSEDED" => "已被新版替代"
    },
    "memory_tag" => %{
      "adopted_artifact" => "作者采纳内容",
      "risk:high" => "高风险",
      "risk:low" => "低风险",
      "risk:medium" => "中风险",
      "work_direction" => "创作方向"
    },
    "memory_type" => %{
      "AUTHOR_PREFERENCE" => "作者偏好",
      "CHARACTER_PROFILE" => "人物设定",
      "CONSTRAINT" => "创作约束",
      "CURRENT_STATE" => "当前状态",
      "DRAFT_CONTEXT" => "草稿上下文",
      "FORESHADOWING" => "伏笔",
      "IDEA" => "灵感",
      "PLOT_FACT" => "剧情事实",
      "RELATIONSHIP" => "人物关系",
      "STYLE_RULE" => "写作风格",
      "WORK_DIRECTION" => "创作方向",
      "WORLD_RULE" => "世界观规则"
    },
    "model" => %{
      "__default__" => "当前模型"
    },
    "narrative_role" => %{
      "ANTAGONIST" => "反派",
      "ENSEMBLE_POV" => "群像视角",
      "MINOR" => "次要角色",
      "PROTAGONIST" => "主角",
      "SUPPORTING" => "配角"
    },
    "provider" => %{
      "anthropic" => "Anthropic",
      "deepseek" => "DeepSeek",
      "gemini" => "Gemini",
      "kimi" => "Kimi",
      "lmstudio" => "本地模型",
      "minimax" => "Minimax",
      "minimax_cn" => "Minimax（国内版）",
      "openai" => "OpenAI",
      "openai_subscription" => "OpenAI（订阅）",
      "slice_verify" => "本地模型（测试环境）",
      "strata" => "本地模型",
      "stub" => "本地模型（测试环境）",
      "zhipu" => "智谱"
    },
    "reason_code" => %{
      "candidate_adopted_as_tentative" => "候选内容先作为待采纳草稿保存。",
      "gates_passed" => "执行门禁已通过。",
      "tool_result_not_adoption" => "工具结果不是自动采纳的作品事实。"
    },
    "run_status" => %{
      "awaiting_author" => "等待你回复",
      "cancelled" => "已停止",
      "cancelling" => "正在停止",
      "completed" => "已完成",
      "created" => "已创建",
      "failed" => "失败",
      "paused" => "已暂停",
      "pausing" => "暂停中",
      "pending" => "待处理",
      "running" => "进行中"
    },
    "session_status" => %{
      "ACTIVE" => "进行中",
      "ARCHIVED" => "已归档",
      "EXITED" => "已退出"
    },
    "status" => %{
      "ACCEPTED" => "已采纳",
      "ARCHIVED" => "已归档",
      "AUTHOR_EDITED" => "作者已改写",
      "CANCELLED" => "已取消",
      "CONFIRMED" => "已确认",
      "DISCARDED" => "已放弃",
      "EDITED_ACCEPTED" => "已采纳（修订后）",
      "EXPIRED" => "已过期",
      "INVALIDATED" => "已失效",
      "OPEN" => "进行中",
      "RESOLVED" => "已解决",
      "SUPERSEDED" => "已被新版本替代",
      "TENTATIVE" => "待采纳",
      "WAITING_USER" => "等待你回复",
      "needs_confirmation" => "需要确认"
    },
    "tool" => %{
      "agent_plan_draft" => "创作计划",
      "agent_plan_revision" => "创作计划修订",
      "ask_author" => "向作者确认",
      "chapter_mission" => "章节目标",
      "continuation_decision" => "续写判断",
      "explore" => "资料查阅",
      "judgment_decision" => "创作判断",
      "planning_mission" => "写作准备",
      "propose_creative_directions" => "创作方向建议",
      "propose_work_profile_revision" => "作品档案修订建议",
      "prose_writing" => "正文写作",
      "register_author_content" => "登记作者原文",
      "report_capability_gap" => "能力缺口报告",
      "report_quality_findings" => "质量核对",
      "submit_tentative_artifact" => "保存候选草稿",
      "text_analysis" => "文本分析"
    }
  }

  @fallbacks %{
    "action" => "操作",
    "artifact_type" => "创作内容",
    "capability" => "创作能力",
    "context_source" => "其他安全来源",
    "decision" => "处理中",
    "error_code" => "处理遇到问题",
    "frame_type" => "创作进展",
    "gate" => "前置检查",
    "memory_scope" => "记忆范围",
    "memory_source_type" => "来源未知",
    "memory_status" => "状态未知",
    "memory_tag" => "标签",
    "memory_type" => "记忆类型",
    "model" => "当前模型",
    "narrative_role" => "角色定位未知",
    "provider" => "当前模型服务",
    "reason_code" => "已记录",
    "run_status" => "处理中",
    "session_status" => "状态未知",
    "status" => "处理中",
    "tool" => "创作操作"
  }

  @forbidden_tokens %{
    "allow" => [],
    "internal_identifiers" => ["slice_verify", "Stub", "Strata", "[stub]"],
    "internal_terms_zh" => ["工作过程", "确认回合", "创作执行", "任务控制", "结构化回放", "持久 trace"],
    "protocol_codes" => [
      "request_ir",
      "provider_session",
      "reasoning_content",
      "call_id",
      "narrative_role",
      "continuation_decision",
      "submit_tentative_artifact",
      "report_quality_findings",
      "agent_plan_draft",
      "agent_plan_revision",
      "prose_writing",
      "character_evolution",
      "provider_run_ref",
      "provider_call_ref"
    ],
    "ref_patterns" => [
      "(?:character|chapter|work|artifact|trace|pcall|prun|pevt|turn|run|draft):[0-9A-Za-z_-]{6,}"
    ]
  }

  @doc "SSOT 内容哈希；前后端生成物必须一致。"
  @spec source_hash() :: String.t()
  def source_hash, do: @source_hash

  @spec domains() :: %{String.t() => %{String.t() => String.t()}}
  def domains, do: @domains

  @spec fallbacks() :: %{String.t() => String.t()}
  def fallbacks, do: @fallbacks

  @spec forbidden_tokens() :: %{String.t() => [String.t()]}
  def forbidden_tokens, do: @forbidden_tokens
end
