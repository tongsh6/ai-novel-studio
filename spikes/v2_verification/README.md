# v2_verification

Phase 0 的 spike 脚手架，承载 `docs/design-v2/tech-stack/verification/` 列出的两个验证任务：

- `paper_trail` × Ecto 3.13 × SQLite / PostgreSQL 兼容性
- 结构化输出选型（langchain / legacy hex `instructor` 0.1 / 直连 Req / instructor_lite 四路对比）

本工程独立于仓库主项目（Python 实现），不参与产品代码。

## 前置条件

- Elixir 1.19 / OTP 28（`brew install elixir` 即可）
- Docker（colima 即可）用于跑 PostgreSQL 容器
- Ollama（本机 OpenAI-compat 端点）用于跑结构化输出
- 网络代理已开（`mix deps.get` 走 hex.pm）

## 一键复跑

```bash
cd spikes/v2_verification
mix deps.get

# Spike 1: paper_trail
docker run -d --name v2_spike_pg \
  -e POSTGRES_PASSWORD=spike -e POSTGRES_USER=spike -e POSTGRES_DB=spike \
  -p 5432:5432 postgres:16-alpine

SPIKE_DB=sqlite   mix run -e 'V2Verification.Spike.PaperTrail.run(:sqlite)'
SPIKE_DB=postgres mix run -e 'V2Verification.Spike.PaperTrail.run(:postgres)'

# Spike 2: structured output（默认 27 次/路径，四路径约 7-8 分钟）
SPIKE_DB=sqlite mix run -e 'V2Verification.Spike.StructuredOutput.run()'
```

## 清理

```bash
docker rm -f v2_spike_pg
rm -f priv/spike_sqlite.db priv/spike_sqlite.db-shm priv/spike_sqlite.db-wal
```

## 目录结构

```
lib/v2_verification/
  application.ex          # 启动并按 SPIKE_DB 选择 Repo
  repos.ex                # RepoSqlite / RepoPostgres
  migrations.ex           # works + versions DDL（双库自适配）
  schema/work.ex          # 验证任务最小 schema
  spike/
    paper_trail.ex        # spike 1
    structured_output.ex  # spike 2 主流程（A/B/C/D 四路径）
    structured_output_schema.ex  # Ecto + JSON Schema + ex_json_schema 校验
config/config.exs         # 双 Repo + paper_trail repo + instructor 指向 Ollama
```
