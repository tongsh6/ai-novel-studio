import {
  BookOpen,
  Boxes,
  ClipboardCheck,
  Hammer,
  LayoutPanelTop,
  Library,
  SplitSquareHorizontal,
  Users
} from "lucide-react";

export const companyNavItems = [
  { id: "company-dashboard", label: "公司总览", icon: LayoutPanelTop },
  { id: "departments", label: "部门", icon: Boxes },
  { id: "projects", label: "小说项目", icon: Library }
];

export const projectNavItems = [
  { id: "project-overview", label: "项目总览", icon: LayoutPanelTop },
  { id: "bible", label: "书籍圣经", icon: BookOpen },
  { id: "characters", label: "角色", icon: Users },
  { id: "plot", label: "剧情", icon: SplitSquareHorizontal },
  { id: "factory", label: "章节工厂", icon: Hammer },
  { id: "continuity", label: "连续性", icon: ClipboardCheck }
];

export const workflowSteps = [
  { title: "开新书", detail: "把作者初始文本压成项目骨架，并直接创建书籍资料树" },
  { title: "建圣经", detail: "沉淀世界规则、势力、金手指、主题和禁写项" },
  { title: "做人设", detail: "补齐欲望、弱点、关系、成长线、出场章节" },
  { title: "排剧情", detail: "组织卷纲、篇章线、章节卡、场景卡和情绪曲线" },
  { title: "章节生产", detail: "从章节合同到场景序列、章节草稿和审稿" },
  { title: "连续检查", detail: "检查伏笔、时间线、矛盾、质量清单和回收情况" }
];

export const boardConfig = {
  bible: {
    title: "书籍圣经",
    subtitle: "本书正式规则与核心承诺",
    icon: BookOpen,
    groups: ["圣经", "世界"],
    actions: ["core-selling-point", "golden-three"]
  },
  characters: {
    title: "角色工作台",
    subtitle: "角色欲望、弱点、关系与成长线",
    icon: Users,
    groups: ["角色"],
    actions: ["character-card"]
  },
  continuity: {
    title: "连续性工作台",
    subtitle: "伏笔、时间线、矛盾与质量检查",
    icon: ClipboardCheck,
    groups: ["伏笔", "时间", "审稿"],
    actions: ["foreshadow-check", "timeline-check", "payoff-audit"]
  }
};

export const chapterSteps = [
  { id: "outline", title: "章节大纲", action: "plotline-plan", note: "先确定本章推进什么读者期待。" },
  { id: "contract", title: "章节合同", action: "chapter-contract", note: "把情绪、场景、信息边界压成施工图。" },
  { id: "sequence", title: "场景序列", action: "scene-sequence", note: "每场都有进入、冲突、反转、场尾钩。" },
  { id: "draft", title: "章节草稿", action: "chapter-draft", note: "根据合同和场景序列生成可审阅草稿。" },
  { id: "payoff-review", title: "商业审稿", action: "payoff-audit", note: "检查爽点、钩子、代价与追读拉力。" },
  { id: "voice-review", title: "风格审稿", action: "anti-ai-audit", note: "删除解释腔、说明文和机械短句。" }
];
