# VocalHub（术曲星图）

面向中文用户的本地优先术曲资料目录。VocalHub 从 [VocaDB](https://github.com/VocaDB/vocadb) 同步歌曲元数据，经过运行时校验与清洗后写入 PostgreSQL；浏览器页面和站内 API 只读取本地快照，不在用户请求期间依赖上游服务。

## 当前状态

已实现：

- Next.js 16、React 19、TypeScript 和 Tailwind CSS 4 前端。
- PostgreSQL 17、Prisma 7 和本地 UUID 业务主键。
- VocaDB song detail、完整 song ID inventory 与 Song activity client：10 秒详情超时、有界重试、`Retry-After` 共享冷却和 Zod 契约校验。
- 显式 ID、全量 seed、activity 增量和删除 reconciliation worker；durable manifest、checkpoint、resume、优雅终止和外部 scheduler 调用支持。
- 可分别构建 Next.js app、一次性 VocaDB worker 和 Prisma migration 的生产容器。
- 歌曲、标题、artist credits、Artists、Tags、PVs 和同步记录幂等写入。
- 歌曲目录、基础搜索、最新/热门排序、分页与歌曲详情。
- 歌曲卡片与详情封面、公开 PV 缩略图展示；远程图片失败时保留稳定占位。
- 作者详情和分页作品列表；作者资料来自已同步歌曲中的结构化 credit。
- 单元测试和真实 PostgreSQL 集成测试。

尚未实现：

- 定时任务和部署级 worker service。
- 独立 VocaDB artist detail 同步、作者简介、别名、头像或社交链接。
- 图片服务端代理、对象存储或 CDN 持久缓存。
- 作者索引、独立跨歌曲/作者/标签的全站搜索。
- Auth.js、收藏、歌单、Redis、推荐、评论、投稿或 AI 功能。

## 快速开始

要求：Node.js 20.19+、npm、Docker 与 Docker Compose。

```bash
npm ci
cp .env.example .env
docker compose up -d --wait postgres
npm run db:generate
npm run db:deploy
```

`db:deploy` 应用仓库已提交 migration；修改 Prisma schema 时使用 `npm run db:migrate` 创建开发 migration。

先执行完整 seed。该命令从 VocaDB `/api/songs/ids` 获取完整非删除 ID 集合，建立 durable manifest，再以并发 2 获取 canonical song detail：

```bash
npm run sync:vocadb -- seed
```

后续手工增量刷新和删除 reconciliation：

```bash
npm run sync:vocadb -- incremental
npm run sync:vocadb -- reconcile
```

外部 scheduler 应使用 `auto`。若存在唯一 `RUNNING` run，该命令先恢复它；否则创建指定 mode：

```bash
npm run sync:vocadb -- auto incremental
npm run sync:vocadb -- auto reconcile
```

也可指定有限 ID 批次，或继续中断的唯一 RUNNING run：

```bash
npm run sync:vocadb -- ids --ids=121,1477,4904,25430
npm run sync:vocadb -- resume
```

所有 mode 都必须显式指定。`incremental` 要求至少一次成功 seed；`resume` 只处理 durable manifest 中未完成的 item。`auto` 遇到多个 `RUNNING` run 时 fail closed，需 operator 处理。命令返回非零表示 run 未完全成功或配置/并发锁失败。同步完成后启动：

```bash
npm run dev
```

访问：

- `http://localhost:3000/`：目录首页
- `http://localhost:3000/songs`：歌曲浏览与搜索
- `/songs/{localUuid}`：歌曲详情
- `/artists/{localUuid}`：作者详情与公开作品

## 生产部署与调度

仓库提供同一版本的三个 Docker target：

- `app`：Next.js standalone server，只需要 `DATABASE_URL`。
- `worker`：一次性 VocaDB sync job，需要 `DATABASE_URL` 和 `VOCADB_*` 配置。
- `migrate`：只执行 committed migration，不启动 app 或 worker。

`compose.production.yaml` 不提供生产 PostgreSQL，也不在容器内运行 cron。首次部署顺序：

```bash
docker compose -f compose.production.yaml --profile migrate run --rm migrate
docker compose -f compose.production.yaml up -d app
docker compose -f compose.production.yaml --profile worker run --rm worker seed
```

seed 成功后再启用外部 scheduler。单机 cron、systemd timer 或托管 scheduler 都调用同一个一次性 worker：

```bash
docker compose -f compose.production.yaml --profile worker run --rm --no-deps worker auto incremental
docker compose -f compose.production.yaml --profile worker run --rm --no-deps worker auto reconcile
```

建议 incremental 每 15 分钟，reconcile 每日低峰运行；seed 只用于首次部署或人工重建 baseline。scheduler 应禁止重叠，但 PostgreSQL advisory lock 仍是跨 scheduler 的最终保护。worker 收到 `SIGTERM`/`SIGINT` 后停止领取新 item、取消 HTTP 等待、等所有 lane 收束再释放 DB 连接；未完成 item 保持 `PENDING`，run 保持 `RUNNING`，下次 `auto` 恢复。容器至少保留 60 秒 termination grace period。

发布新版本时先暂停 scheduler 并等待 active worker 退出，再运行 `migrate`、部署 `app`，最后恢复 scheduler；advisory lock 不负责协调 migration。多个 `RUNNING` run 表示状态歧义，worker 会拒绝自动恢复；应先检查 `SyncRun`/`SyncItem`。`PARTIAL`/`FAILED` run 已终结，需根据 item error 修复后发起新 run。`ACTIVITY_INTERVAL_SATURATED` 需重新执行完整 seed。production app 不接收 `VOCADB_*`，且 lint 禁止请求路径导入 VocaDB 模块。

## 架构边界

```text
手工 CLI / 外部 scheduler
  -> VocaDB song IDs / Song activity discovery
  -> VocaDB GET /api/songs/{vocadbId}
  -> Zod 校验与规范化
  -> durable manifest / checkpoint
  -> Prisma 事务 / PostgreSQL
  -> repository
  -> Route Handlers / Server Components
  -> 页面
```

VocaDB API 访问只发生在 `worker/sync-vocadb.ts` 经 `src/lib/vocadb/` 调用时。`src/app/` 中的页面和 API 不访问 VocaDB API，也不通过 HTTP 调用本站 API；Server Components 直接复用 repository。页面中的封面和 PV 缩略图由浏览器直接向持久化 URL 所指向的远程主机请求，不改变本地元数据读取边界。

公共快照规则：

- 歌曲/作者未被上游删除，且至少有一次本地同步时间。
- `SYNCED` 可公开；刷新暂时失败后的 `FAILED` 保留最后好快照。
- `PENDING`、`SOURCE_MISSING`、`SOURCE_DELETED` 不公开。
- 作者还必须关联至少一首公开歌曲。

## 当前 API

```http
GET /api/songs?q=miku&page=1&pageSize=24&sort=latest
GET /api/songs/{localUuid}
GET /api/artists/{localUuid}
GET /api/artists/{localUuid}/songs?page=1&pageSize=24&sort=latest
```

通用规则：

- 路径 ID 是本地 UUID；VocaDB 数字 ID 只作为来源标识，不是公开业务主键。
- `page` 默认 `1`、最大 `10000`；`pageSize` 默认 `24`、最大 `50`。
- `sort` 为 `latest` 或 `popular`。
- 错误结构为 `{ "error": { "code": "...", "message": "..." } }`。

歌曲搜索返回歌曲结果。`q` 最长 100 字符，大小写不敏感地 substring 匹配主标题、默认标题、多语言标题、artist string、结构化或 custom credit、标签名；Tag `additionalNames` 是精确且大小写敏感的数组成员匹配。当前没有模糊匹配、分词、转写或相关度排序。

作者作品只包含通过 `artistId` 结构化关联的公开歌曲。Custom credit 没有 Artist 实体，因此保留歌曲署名，但不生成作者页面。

## 实际数据模型

- `Song`：本地 UUID、VocaDB 来源 ID、展示字段、来源和同步状态。
- `SongName`：多语言标题。
- `Artist`：从歌曲 credit 中同步的结构化作者概要。
- `SongArtistCredit`：歌曲署名、roles/categories、support/custom 标记；`artistId` 可空。
- `Tag` / `SongTag`：标签及歌曲关系。
- `SongPV`：外部播放入口。
- `SyncRun` / `SyncItem`：mode、durable manifest、运行边界、尝试和单项结果。
- `VocaDbSongSyncState`：Song activity checkpoint、seed/reconciliation 完成时间和 compare-and-swap version。

声库角色当前通过通用 Artist credit 的 `categories`、`roles` 和 `effectiveRoles` 表示，没有独立 `Vocal` 模型。未来用户、收藏和歌单模型尚未创建。

## VocaDB client 与同步行为

- 固定请求 `Artists,Names,PVs,Tags,MainPicture,CultureCodes`。
- 仅网络错误、超时、408/425/429 和 5xx 可重试；404、其他 4xx、非法 JSON 和契约错误不重试。
- `GET /api/songs/ids` 只用于 seed/reconcile inventory；它未出现在 Swagger。空、非法或不可达响应均 fail closed，不推进 checkpoint，也不做删除变更。
- incremental 从最后成功 checkpoint 回退 15 分钟，并固定 `now - 2 分钟` 为窗口上界；activity 只发现待刷新的 source ID，最终写入仍来自完整 song detail。
- activity 单次上限 500；饱和窗口递归拆分。最小时间片仍饱和时返回 `ACTIVITY_INTERVAL_SATURATED`，需重新执行完整 seed 建立新 baseline。
- 429 支持 `Retry-After` 秒数或 HTTP date，并触发 worker process-wide cooldown；detail 并发默认 2。
- manifest 创建后可使用 `resume`；scheduled `auto` 优先恢复唯一 RUNNING run。discovery、item processing 或 finalization 失败时 run 保持 RUNNING 并记录错误，供 operator 修复后继续。checkpoint 只在 discovery 完整且没有 FAILED item 时原子推进。
- caller cancellation 与 request timeout 分开处理：部署终止不重试、不污染 Song 或 item failure；timeout 仍按原策略重试并最终记为 item failure。
- reconcile 只在完整 inventory 成功后计算差集，并逐条复核。仅“inventory 缺失 + detail 404”或 detail `deleted:true` 才确认删除；不硬删除 Song。
- `sourceUpdatedAt` 不是同步游标；当前官方 song contract 没有可信全局更新时间，activity checkpoint 单独持久化。
- 已请求关系字段缺失时拒绝写入；完整响应中的合法空数组会清除对应旧关系。
- 每首歌曲独立事务并按 `vocadbId` upsert；重复同步保留本地 UUID。
- 404 将已有歌曲标记为 `SOURCE_MISSING`；成功响应中的 `deleted: true` 标记为 `SOURCE_DELETED`。
- `sourceUpdatedAt` 只保存可信上游更新时间；本地抓取时间使用 `lastSyncedAt`。
- 上游枚举/flags 以字符串/字符串数组保存，允许新增值。
- Custom artist credit 即使没有 Artist 实体也保留。
- 仅保留 HTTP/HTTPS PV 与媒体 URL；disabled PV 的播放信息和缩略图均不进入公开详情 API 或页面。

## 媒体与来源政策

VocalHub 已获得可追溯书面许可，允许展示 VocaDB 提供的歌曲封面、作者头像和 PV 缩略图，并允许热链、服务端代理与持久缓存；许可原件不提交到公开仓库。当前版本只展示已有可靠字段：歌曲封面与公开 PV 缩略图。作者头像要等独立 artist detail 同步提供可信字段后再实现。

当前页面使用浏览器直连远程图片源，不经过 VocalHub 图片代理、`/_next/image`、对象存储或 CDN 持久缓存。图片元素使用 `referrerPolicy="no-referrer"`，加载失败时显示等尺寸占位；远程主机仍可获得访客 IP、User-Agent 等连接信息。页面 footer 统一标明 VocaDB 来源，歌曲和作者详情继续链接对应原条目，图片权利归各权利人。

歌曲列表 DTO 公开 `coverUrlOriginal` 与 `coverUrlThumb`；歌曲详情 DTO 另在公开 PV 中提供 `thumbnailUrl`。这些字段只可能是已规范化的 HTTP/HTTPS URL 或 `null`。disabled PV 的整个记录（包括播放 URL 与缩略图）均不会公开。VocalHub 不复制歌词。

参考：

- [VocaDB 源码](https://github.com/VocaDB/vocadb)
- [VocaDB Public API](https://wiki.vocadb.net/docs/development/public-api)
- [VocaDB Swagger](https://vocadb.net/swagger/index.html)

## 项目结构

```text
src/
├── app/
│   ├── api/songs/
│   ├── api/artists/
│   ├── songs/
│   ├── artists/[id]/
│   ├── layout.tsx
│   └── page.tsx
├── components/          # 共享 catalog UI
├── generated/prisma/    # Prisma Client
└── lib/
    ├── artists/
    ├── catalog/
    ├── songs/
    └── vocadb/
prisma/
├── migrations/
└── schema.prisma
tests/
├── fixtures/
├── unit/
└── integration/
worker/
└── sync-vocadb.ts
```

## 测试与质量门

```bash
npm run test:unit
npm run lint
npm run build
```

集成测试必须使用隔离数据库：

```bash
docker compose --profile test up -d --wait postgres-test
DATABASE_URL=postgresql://vocalhub:vocalhub@localhost:5433/vocalhub_test \
DIRECT_URL=postgresql://vocalhub:vocalhub@localhost:5433/vocalhub_test \
  npm run db:deploy
TEST_DATABASE_URL=postgresql://vocalhub:vocalhub@localhost:5433/vocalhub_test \
  npm run test:integration
```

`TEST_DATABASE_URL` 未设置时，测试会回退到本机 5432 上名为 `vocalhub_test` 的数据库；不要指向开发库。

## 路线图

1. 用 5,000–20,000 首真实数据测量搜索与作者作品查询，按结果评估 `pg_trgm` 和关系索引。
2. 独立同步 artist detail，再扩展作者别名、简介、资料图片和可信头像字段。
3. 按部署需求评估图片服务端代理、持久缓存与 CDN，而非开放任意 URL 代理。
4. 接入 Auth.js，设计 User/Favorite/Playlist 模型和功能。
5. 在真实数据和用户行为基础上评估标签页、推荐、Redis、AI 与社区能力。
