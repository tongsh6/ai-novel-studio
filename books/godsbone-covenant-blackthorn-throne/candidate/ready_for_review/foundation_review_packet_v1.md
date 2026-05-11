# 待评审包：新书基础设定与开篇合同 v1

- 状态：candidate/ready_for_review
- 项目：godsbone-covenant-blackthorn-throne
- 书名候选：《神骸圣约：黑棘王座》
- 生成日期：2026-05-11

## 评审目标

请作者确认以下候选内容是否可以进入正式库存，或是否需要修改后再审：

- 新书基础 Bible 包
- 新书研究包
- 第一卷与前三章合同包
- 开篇 ch01-ch10 规划包

## 推荐批准项

### A. 基础 Bible 包

建议：可以批准入库。

文件：

- `candidate/bible/book_bible_foundation_v1.md`
- `candidate/bible/worldrule_soul_entropy_v1.md`
- `candidate/bible/worldrule_factions_and_powers_v1.md`
- `candidate/bible/character_core_cast_v1.md`
- `candidate/bible/timeline_six_volume_master_v1.json`
- `candidate/bible/foreshadow_master_v1.md`

理由：这些文件是新书的世界、人物、时间线和伏笔骨架。审批后，后续章节才能稳定遵守同一真相层。

对应审批卡：

- `candidate/approvals/approval_foundation_pack_v1.json`

对应 patch：

- `candidate/patches/patch_foundation_pack_v1.json`

### B. 研究包

建议：可以批准入库。

文件：

- `candidate/research/research_market_positioning_2026-05-11_v1.md`
- `candidate/research/research_soul_entropy_world_logic_2026-05-11_v1.md`

理由：这两份是写作方法和题材定位，不直接锁剧情细节，但能作为本书长期创作参照。

对应审批卡：

- `candidate/approvals/approval_research_pack_v1.json`

对应 patch：

- `candidate/patches/patch_research_pack_v1.json`

### C. 第一卷与前三章 DeepSeek 详细合同包

建议：可以批准入库。

文件：

- `candidate/contracts/contract_vol1_master_v1.md`
- `candidate/contracts/story_overview_for_deepseek_v1.md`
- `candidate/contracts/contract_ch01_v1.md`
- `candidate/contracts/contract_ch02_v1.md`
- `candidate/contracts/contract_ch03_v1.md`

理由：合同通过后，可将这些文件交给 DeepSeek 独立生成前三章正文；主 agent 后续只负责正文回流后的审阅、state diff、patch 和审批。

对应审批卡：

- `candidate/approvals/approval_deepseek_contracts_ch01_ch03_v1.json`

对应 patch：

- `candidate/patches/patch_deepseek_contracts_ch01_ch03_v1.json`

## 建议暂缓项

### D. 开篇规划包

建议：暂缓正式入库，先作为候选写作参考。

文件：

- `candidate/drafts/opening_ch01_ch10_outline_v1.md`
- `candidate/drafts/opening_ch01_ch03_scene_plan_v1.md`

理由：这两份对前三章写作很有用，但细纲容易在试写后调整。建议等 ch01-ch03 候选正文出来，再决定是否锁定为正式开篇规划。

## 作者可用裁决格式

如果同意推荐方案，可以回复：

`基础 Bible 包 approved；研究包 approved；第一卷与前三章 DeepSeek 详细合同包 approved；开篇规划包暂缓。`

如果要部分修改，可以回复：

`基础 Bible 包 partial：需要改 XXX；研究包 approved；合同包 partial：需要改 XXX。`
