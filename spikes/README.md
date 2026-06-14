# spikes/ — 技术选型可复跑验证代码

> 独立验证脚手架（独立 mix 工程，不参与产品 umbrella build）。承载 `docs/design/tech-stack/verification/` 列出的技术选型实测，提供"一键复跑"证据。
>
> 性质：历史验证资产，仅在复查早期技术选型时使用，不在产品主阅读/构建路径。

## 子目录

| 目录 | 内容 |
|---|---|
| `v2_verification/` | paper_trail × Ecto × SQLite/PostgreSQL 兼容性、结构化输出选型四路对比（详见 `v2_verification/README.md`；被 `docs/design/tech-stack/verification/` 与 `13-risks.md` 引用） |
