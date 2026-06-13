# 部署形态

> 状态：草案
>
> 目的：定义阶段 1 单机 → 阶段 2 B/S 的部署演化路径，包括基础设施、运维边界、零业务代码改动的切换流程。

---

## 1. 阶段 1：单机桌面应用

### 1.1 形态

- 用户下载 `.dmg` / `.msi` / `.deb` / `.AppImage`
- 双击安装
- 开箱即用，无需配置数据库/服务器

### 1.2 组件清单

| 组件 | 形态 | 位置 |
|---|---|---|
| Tauri webview | OS native | 应用进程 |
| React/TS frontend | 静态资源（嵌入 Tauri）| 应用进程 |
| Mix Release sidecar | 子进程二进制 | 应用进程 spawn |
| Phoenix endpoint | bind `localhost:4000` | sidecar 内 |
| Ecto + SQLite | 文件 | 用户数据目录 |
| LLM provider | 外部 HTTP API | 远程 |

### 1.3 用户数据存储

| 平台 | 路径 |
|---|---|
| macOS | `~/Library/Application Support/com.ai-novel-studio.app/` |
| Windows | `%APPDATA%/com.ai-novel-studio.app/` |
| Linux | `~/.local/share/com.ai-novel-studio.app/` |

### 1.4 网络

- 本地通信：`localhost:4000` HTTP/WS
- 外部访问：仅 LLM provider API（用户配置）
- 防火墙：默认无入站端口（sidecar 只 bind localhost）

### 1.5 升级

- 内置 Tauri Updater 检查 + 下载新版
- Mix Release 二进制热替换
- Ecto migration 启动时自动跑

详见 [`05-desktop.md`](./05-desktop.md) §8。

---

## 2. 阶段 2：B/S 多用户多作者

### 2.1 形态

- 用户浏览器访问 `https://app.example.com`
- 后端是 Phoenix server（多节点 cluster）
- 数据库 PostgreSQL 主从

### 2.2 拓扑

```mermaid
flowchart TB
    User1([Browser User 1])
    User2([Browser User 2])
    
    DNS[DNS / CDN<br/>静态资源]
    LB[Load Balancer<br/>+ TLS termination]
    
    subgraph Cluster["Phoenix Cluster (libcluster)"]
        Node1[Phoenix Node 1<br/>BEAM VM<br/>:4000]
        Node2[Phoenix Node 2<br/>BEAM VM<br/>:4000]
        Node3[Phoenix Node 3<br/>BEAM VM<br/>:4000]
    end
    
    PG[(PostgreSQL Primary)]
    PGRO[(PostgreSQL Replicas)]
    
    Redis[(Redis<br/>session / rate limit)]
    
    LLM[(LLM Providers)]
    
    Otel[OTel Collector<br/>→ Tempo / Loki / Prometheus]
    
    User1 --> DNS
    User2 --> DNS
    DNS --> LB
    DNS -.静态资源.-> User1
    DNS -.静态资源.-> User2
    
    LB --> Node1
    LB --> Node2
    LB --> Node3
    
    Node1 <-->|Erlang Distribution<br/>Phoenix.PubSub| Node2
    Node2 <-->|Erlang Distribution| Node3
    Node1 <-->|Erlang Distribution| Node3
    
    Node1 --> PG
    Node2 --> PG
    Node3 --> PG
    
    Node1 -.read.-> PGRO
    Node2 -.read.-> PGRO
    Node3 -.read.-> PGRO
    
    Node1 --> Redis
    Node2 --> Redis
    Node3 --> Redis
    
    Node1 --> LLM
    Node2 --> LLM
    Node3 --> LLM
    
    Node1 -.metrics+trace.-> Otel
    Node2 -.metrics+trace.-> Otel
    Node3 -.metrics+trace.-> Otel
```

### 2.3 组件清单

| 组件 | 形态 | 备注 |
|---|---|---|
| 前端静态资源 | CDN（CloudFront / Cloudflare）| `frontend/dist` 直接部署 |
| Load Balancer | ALB / nginx | TLS termination + sticky session（按 workspace_id） |
| Phoenix 节点 | 3+ BEAM VMs | Distributed Erlang cluster |
| PostgreSQL | 主从 | RDS / Aurora / 自建 Patroni |
| Redis | session / rate limit / cache | ElastiCache 或自建 |
| OTel Collector | 数据汇聚 | Tempo + Loki + Prometheus |
| LLM | 外部 API | 同阶段 1 |

### 2.4 多租户路由

每个 workspace 的所有 Agent **路由到同一节点**（避免跨节点 message 延迟）：

```elixir
# Load balancer sticky session by workspace_id (cookie 或 header)
# Phoenix internal: workspace_id 用 consistent hashing 选 node
```

详见 [`08-multi-agent.md`](./08-multi-agent.md) §10.2。

---

## 3. 阶段 1 → 阶段 2 切换路径

### 3.1 业务核心代码改动：零；Foundation 边界适配层切换

> **关于"0 改动"的边界**：表中"0 改动"指 Domain / Foundation **业务核心逻辑**无需修改。Foundation 内部的 adapter 层（数据库、事件总线、认证、跨节点路由）必然有切换实现，这部分按"边界适配层"对待，不算业务代码。详见 [`00-overview.md`](./00-overview.md) §4 同口径说明。

| 维度 | 阶段 1 | 阶段 2 | 业务代码 | 边界适配层 |
|---|---|---|---|---|
| 部署 | Tauri shell + sidecar | Phoenix server | 0 | 启动脚本 / release target |
| 数据库 | SQLite (Ecto.Adapters.SQLite3) | PostgreSQL (Ecto.Adapters.Postgres) | 0 | adapter 切换 + 跨方言能力差异（FTS / LISTEN-NOTIFY / JSON 操作）通过 `EventBus.Adapter` / `Search.Adapter`，详见 [`06-database.md`](./06-database.md) §2.2 |
| Event Bus | Phoenix.PubSub 单节点 | Phoenix.PubSub 跨节点 | 0 | Distributed Erlang 节点发现（libcluster 配置）|
| 认证 | Device key（Tauri Stronghold 取） | OAuth / SSO / JWT | 0 | **接口层** 0（统一 Bearer plug），但 token 校验、用户身份提取、刷新逻辑在 plug 内部不同实现；Stage 1 的 device key 没有过期、刷新、撤销概念，Stage 2 必须新增 |
| Multi-Agent | 单节点 supervision | 跨节点 process registry | 0 | via 元组从 `{:via, Registry, ...}` 切到 `{:via, Horde.Registry, ...}`，通过 helper 抽象后业务代码不感知 |
| Observability | 本地 JSONL + stdout | OTLP → Tempo/Loki/Prometheus | 0 | exporter 配置切换 |
| Provider Gateway | 本地 LLM + 远程 LLM | 同 | 0 | 同（API key 来源从 OS Keychain 切到 Vault）|

### 3.2 配置层改动

```bash
# 阶段 1
DB_TYPE=sqlite
DB_PATH=~/.local/share/.../db.sqlite3
AUTH_MODE=device_key
OTEL_EXPORTER=stdout

# 阶段 2
DB_TYPE=postgres
DATABASE_URL=postgres://user:pass@db.internal:5432/ainovel
AUTH_MODE=oauth
OAUTH_CLIENT_ID=...
OTEL_EXPORTER=otlp
OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4317
SECRET_KEY_BASE=...
RELEASE_COOKIE=...
```

### 3.3 数据迁移

如果用户从单机 → web，需要数据迁移工具：

```bash
mix ainovel.migrate.sqlite_to_postgres \
  --source ~/.local/share/.../db.sqlite3 \
  --target $DATABASE_URL
```

工具读取 SQLite + 写入 Postgres，保留所有 ID。

### 3.4 切换 checklist

- [ ] PG schema 跑过 `mix ecto.migrate`
- [ ] 数据迁移完成（如有）
- [ ] OAuth provider 配置完成
- [ ] Load balancer / DNS / TLS 就绪
- [ ] OTel Collector + Grafana / Tempo / Loki 就绪
- [ ] 多节点 cluster 启动 + libcluster 节点发现成功
- [ ] 灰度：先一个节点 + 内部测试，再扩到多节点 + 公开

---

## 4. 阶段 2 容量规划

### 4.1 单节点承载估算

| 资源 | 单节点上限（粗估）|
|---|---|
| 并发 workspace | ~500（每个 workspace 持续 alive 的 OTP process 树） |
| 并发 active turn | ~100（每个 turn 多 Agent 并行） |
| 内存底盘 | 1-2GB（OTP process tree + Ecto pool） |
| 内存增长 | ~10MB/active workspace |
| Phoenix 连接数 | 10k+（Channels 长连接）|
| 数据库连接 | 10-20（pool size） |

### 4.2 横向扩展信号

- 单节点内存 > 70% → 加节点
- 单节点 CPU > 70% → 加节点
- workspace 数量逼近 500 → 加节点
- 预算告警：单节点 LLM 调用 RPS > 50 → 考虑 provider rate limit

### 4.3 阶段 2 早期目标规模

[`00-overview.md`](./00-overview.md) §1 约束 2 + 用户回答"还没想这么远"：

- 阶段 2 早期：百量级作者 + 单节点 + 单 PostgreSQL
- 阶段 2 中期：千量级作者 + 3-5 节点 + PG 主从
- 大规模目标暂未冻结

---

## 5. 灾难恢复

### 5.1 阶段 1

- 备份：用户菜单 → 导出备份
- 自动备份：每天到 `~/Library/.../backups/`
- 恢复：用户菜单 → 从备份恢复

### 5.2 阶段 2

- PG 主备 streaming replication
- WAL archiving + Point-in-Time Recovery
- 异地备份（每天 pg_dump → S3）
- RPO: < 1 hour
- RTO: < 30 min（双 region 时）

---

## 6. 监控阈值

| 指标 | 警告 | 严重 |
|---|---|---|
| BEAM heap usage | > 70% | > 90% |
| GC pressure (微秒/s) | > 1000 | > 5000 |
| Phoenix request p99 latency | > 500ms | > 2s |
| Channel connection drop rate | > 0.5% | > 2% |
| LLM provider error rate | > 1% | > 5% |
| Provider p99 latency | > 30s | > 90s |
| DB connection pool saturation | > 70% | > 95% |
| Disk usage (PG / log) | > 70% | > 90% |
| Agent crash rate | > 0.1/min | > 1/min |

阈值在阶段 2 落地后，按真实数据校准。

---

## 7. 安全边界

### 7.1 阶段 1

- 用户数据本地，无网络出站（除 LLM provider）
- API key 存 OS Keychain（Tauri Stronghold plugin）
- SQLite 文件可选 OS 文件系统加密

### 7.2 阶段 2

- TLS 终止在 Load Balancer
- 内网通信 mTLS（Erlang Distribution + TLS）
- DB 连接 TLS
- API key 存 Vault / AWS Secrets Manager
- WAF 防注入
- Rate limit per workspace（Redis）

---

## 8. 当前 TBD

- 阶段 2 具体 IaC 工具（Terraform / Pulumi / 其他）
- 部署平台选型（Kubernetes / ECS / Fly.io / Render / 自建）
- CDN 选型与 region 分布
- 多 region active-active vs primary-only
- 数据驻留合规（GDPR / 国内合规）

以上在阶段 2 触发时再决策。
