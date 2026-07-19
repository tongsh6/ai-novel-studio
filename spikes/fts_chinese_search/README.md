# fts_chinese_search — CP5 search_prose 中文检索选型 spike

> 服务 `tasks/slices/UA01-judgment-driven-loop.md` CP5（探索内部翼）唯一新建件
> `prose_search` 的技术选型。一键复跑：`cd spikes/fts_chinese_search && mix deps.get && mix run run.exs`

## 文件

| 文件 | 角色 |
|---|---|
| `mix.exs` | 独立 mix 工程（仅依赖 exqlite ~> 0.36，与产品同源） |
| `run.exs` | 五问验证脚本（Q1-Q5，输出即证据） |

## 结论（2026-07-19，exqlite 0.36 / SQLite 3.53.3）

| 问题 | 实测 |
|---|---|
| Q1 FTS5 可用性 | 编入 ✓（产品捆绑 SQLite 3.53.3） |
| Q2 trigram | ≥3 字 MATCH 精确；**2 字 MATCH 不命中**（trigram 原理性限制）；`LIKE '%矿区%'` 走 trigram 索引（查询计划 `VIRTUAL TABLE INDEX 0:L1`）；1 字 LIKE 可用 |
| Q3 unigram 字切分 | 任意长度短语查询全精确，但存储按字加空格（约 ×2）、snippet 带空格需还原、bm25 rank 语义弱化 |
| Q4 snippet() | trigram 表引用片段直接可用（原文存储） |
| Q5 写入成本 | 1000 章 × ~700 字批量插入 25ms（单章均摊 0.03ms，采纳时同步 upsert 可忽略） |

**选型：trigram tokenizer 表（正文原样存储）+ 查询整形**——查询 ≥3 字走 MATCH
（bm25 rank + snippet 引用）；<3 字回退 LIKE（2 字仍走 trigram 索引）。不采用
unigram 字切分（存储/引用/排序三项劣势）。
