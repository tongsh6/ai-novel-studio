# Intent 枚举定义

> 本文档定义“对话式小说工作台”当前版本支持的 intent 枚举。
> 
> 它的作用不是解释文学，而是为 Router、Executor、Validator、状态机提供统一协议。

---

# 1. 设计原则

Intent 设计必须满足以下要求：

1. **可判定**：用户请求来了以后，Router 能尽量稳定归类
2. **可执行**：每个 intent 后面都能挂一个明确执行器
3. **可扩展**：后续能加新 intent，而不是推翻重来
4. **边界清晰**：避免一个 intent 吃掉所有相邻任务
5. **协议优先**：名字首先为系统服务，不是为“好听”服务

---

# 2. 枚举总表

当前建议支持以下 intent：

- `CREATE_CHARACTER_CANDIDATES`
- `REFINE_EXISTING_CHARACTER`
- `DEFINE_CHARACTER_RELATION`
- `ADVANCE_PLOT`
- `GENERATE_SCENE_OPTIONS`
- `EXPAND_WORLD_SETTING`
- `REVIEW_EXISTING_OUTLINE`
- `SUMMARIZE_CURRENT_STATE`
- `OTHER`

---

# 3. 各 Intent 详细定义

## 3.1 CREATE_CHARACTER_CANDIDATES

### 定义
基于当前剧情、当前任务或当前缺口，生成新的角色候选供作者挑选、比较、确认。

### 核心特征
- 目标是“新增候选”
- 强调“多个方案”
- 结果通常不是定稿，而是待作者确认
- 通常与“当前剧情缺口”或“人物功能缺口”有关

### 典型请求
- 根据现在剧情补几个角色
- 这里需要一个新人物，你先给几个版本
- 你根据当前故事走向设计几个候选角色
- 先给我几个可选人物，我再定

### 易混淆 Intent
- `REFINE_EXISTING_CHARACTER`

### 区分规则
- **新增人物候选** -> `CREATE_CHARACTER_CANDIDATES`
- **已有角色细化** -> `REFINE_EXISTING_CHARACTER`

---

## 3.2 REFINE_EXISTING_CHARACTER

### 定义
对已经存在的角色进行定向补强、细化、修正或深化。

### 核心特征
- 目标对象已经存在
- 重点是“补强”而不是“新增”
- 通常会指向明确维度，如动机、弱点、成长线、说话风格等

### 典型请求
- 把这个角色写细一点
- 补一下他的动机和软肋
- 完善主角的成长弧线
- 这个人物有点薄，帮我补厚一点

### 易混淆 Intent
- `CREATE_CHARACTER_CANDIDATES`
- `DEFINE_CHARACTER_RELATION`

### 区分规则
- 讨论单个已有角色自身 -> `REFINE_EXISTING_CHARACTER`
- 讨论两个角色之间关系 -> `DEFINE_CHARACTER_RELATION`

---

## 3.3 DEFINE_CHARACTER_RELATION

### 定义
设计两个或多个角色之间的关系结构、张力来源、误解机制、冲突挂钩、依赖路径等。

### 核心特征
- 目标是“关系”，不是单体角色
- 强调“表层关系 + 深层钩子”
- 通常与后续剧情推动强相关

### 典型请求
- 这两个人怎么更有张力
- 设计主角和她的关系线
- 给他们之间加一层暗线联系
- 让这两个人的互动更带劲

### 易混淆 Intent
- `REFINE_EXISTING_CHARACTER`
- `ADVANCE_PLOT`

### 区分规则
- 重心在“人和人之间” -> `DEFINE_CHARACTER_RELATION`
- 重心在“剧情下一步怎么走” -> `ADVANCE_PLOT`

---

## 3.4 ADVANCE_PLOT

### 定义
基于当前剧情状态，设计下一步剧情推进路径、冲突转折、信息揭示、角色入场等。

### 核心特征
- 目标是“往前推进”
- 关注“下一步”
- 强调事件链、冲突点、转折点、节奏连续性

### 典型请求
- 下一章怎么推进
- 这段后面怎么接
- 接下来发生什么比较合理
- 这段剧情应该怎么往前走

### 易混淆 Intent
- `GENERATE_SCENE_OPTIONS`
- `SUMMARIZE_CURRENT_STATE`

### 区分规则
- 需要具体推进建议 -> `ADVANCE_PLOT`
- 只是回顾当前状态 -> `SUMMARIZE_CURRENT_STATE`
- 需要多个场景落地方案 -> `GENERATE_SCENE_OPTIONS`

---

## 3.5 GENERATE_SCENE_OPTIONS

### 定义
围绕一个明确目标，生成多个具体场景、桥段、落地方案，供作者比较选择。

### 核心特征
- 输出多个“场景级”方案
- 粒度比剧情推进更细
- 常用于把抽象推进目标落地到具体一幕

### 典型请求
- 给我几个桥段方案
- 这一幕可以怎么写
- 这里怎么落成场景
- 这个场面给我几个走法

### 易混淆 Intent
- `ADVANCE_PLOT`

### 区分规则
- 讨论“下一步剧情怎么推进” -> `ADVANCE_PLOT`
- 讨论“这一幕怎么落地成具体场景” -> `GENERATE_SCENE_OPTIONS`

---

## 3.6 EXPAND_WORLD_SETTING

### 定义
扩展世界观、势力结构、江湖规则、地域背景、制度逻辑、门派秩序等设定内容。

### 核心特征
- 目标是“设定层”
- 不是直接推进剧情
- 也不是写人物正文
- 设定必须服务作品，不是百科堆砌

### 典型请求
- 这部分设定太薄
- 补一下门派体系
- 这个世界规则不够完整
- 把江湖关系网搭起来

### 易混淆 Intent
- `REVIEW_EXISTING_OUTLINE`
- `ADVANCE_PLOT`

### 区分规则
- 重点在背景结构 -> `EXPAND_WORLD_SETTING`
- 重点在后续推进 -> `ADVANCE_PLOT`

---

## 3.7 REVIEW_EXISTING_OUTLINE

### 定义
对既有大纲、路线、结构方案进行审查，识别问题、冲突、塌陷点与优化空间。

### 核心特征
- 输入对象通常是已有方案
- 输出应以问题识别为主
- 强调优先级，而不是泛泛评价

### 典型请求
- 看看这个大纲有没有问题
- 节奏会不会塌
- 这条线逻辑成不成立
- 帮我审一遍现有结构

### 易混淆 Intent
- `SUMMARIZE_CURRENT_STATE`
- `ADVANCE_PLOT`

### 区分规则
- 重点是“评估已有方案” -> `REVIEW_EXISTING_OUTLINE`
- 重点是“接下来怎么写” -> `ADVANCE_PLOT`

---

## 3.8 SUMMARIZE_CURRENT_STATE

### 定义
总结当前作品、当前阶段、当前剧情、当前角色状态与未决问题，帮助作者恢复工作记忆。

### 核心特征
- 目标是“回顾”
- 输出应清楚区分已确定 / 未确定
- 常作为继续创作前的整理步骤

### 典型请求
- 先回顾一下现在的情况
- 总结目前的设定和剧情进度
- 帮我整理当前已确定内容
- 先把现状梳理一下

### 易混淆 Intent
- `REVIEW_EXISTING_OUTLINE`
- `ADVANCE_PLOT`

### 区分规则
- 重点是“总结现状” -> `SUMMARIZE_CURRENT_STATE`
- 重点是“评估对错” -> `REVIEW_EXISTING_OUTLINE`
- 重点是“下一步怎么走” -> `ADVANCE_PLOT`

---

## 3.9 OTHER

### 定义
无法稳定归类，或请求横跨多个 intent 且主意图不清晰时使用。

### 使用原则
- 不是兜底偷懒标签
- 只有在主意图不稳定时才使用
- 一旦发现高频落入 `OTHER`，说明 intent 体系不够好

---

# 4. 路由优先级建议

当一句话可能同时触发多个意图时，优先识别“主意图”。

建议优先级判断顺序：

1. 用户是否在要求**新增候选**？
2. 用户是否在要求**细化已有对象**？
3. 用户是否在要求**关系设计**？
4. 用户是否在要求**剧情推进**？
5. 用户是否在要求**场景落地**？
6. 用户是否在要求**设定扩充**？
7. 用户是否在要求**方案审查**？
8. 用户是否在要求**现状总结**？

---

# 5. Intent 版本管理建议

建议给 intent 枚举做版本号，例如：

- `intent_version = v1`

后续若新增：

- `MERGE_MULTIPLE_PLOT_THREADS`
- `REWRITE_SCENE`
- `GENERATE_DIALOGUE_OPTIONS`

不要直接覆盖旧定义，应通过版本升级管理。

---

# 6. MVP 建议

第一阶段只启用 4 个高频 intent：

- `CREATE_CHARACTER_CANDIDATES`
- `REFINE_EXISTING_CHARACTER`
- `ADVANCE_PLOT`
- `SUMMARIZE_CURRENT_STATE`

原因很简单：

- 高频
- 易测
- 闭环明确
- 能尽快暴露 Router 真实问题

---

# 7. 一句结论

Intent 枚举不是给人看的漂亮标签，而是系统的分流骨架。

只要 intent 设计含混，后面参数、执行器、校验器都会一起塌。