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
- 作者详情、作者索引与搜索，以及分页公开作品列表；作者 profile 可由独立 VocaDB detail refresh 补充别名、简介、头像和公开外链。
- 标签索引、搜索与标签详情页；只关联公开歌曲的标签才对外可见，详情页只展示公开歌曲。
- 全站搜索页面：一次查询本地 PostgreSQL 快照中的歌曲、作者和标签，按组展示预览与准确总数。
- GitHub OAuth 登录、PostgreSQL database sessions、用户私有收藏与 owner-only 有序歌单。
- 账号设置、全设备 session 撤销、primary database hard delete 与公开隐私/数据保留说明。
- OAuth token 仅用于 callback，不持久化；每日 one-shot maintenance 清理 expired Session rows。
- 媒体交付架构评估：当前继续浏览器 direct hotlink，待对象存储/CDN 就绪后由 worker 执行受控持久缓存；不开放任意 URL 代理。
- 单元测试和真实 PostgreSQL 集成测试。

尚未实现：

- 定时任务和部署级 worker service。
- 图片对象存储/CDN 持久缓存（需先提供部署级 S3-compatible storage 与稳定 delivery base URL）。
- 全站搜索所需的 Stage C 候选生产索引；须先通过隔离 benchmark 取得证据。
- 密码/邮件登录、provider disconnect、数据导出、公开或协作歌单、Redis、推荐、评论、投稿或 AI 功能。

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

### GitHub 登录配置

Auth.js 使用 GitHub OAuth 和 PostgreSQL database session。创建 GitHub OAuth App，并将 callback 配置为：

```text
http://localhost:3000/api/auth/callback/github
```

在 `.env` 设置：

```env
AUTH_SECRET="使用密码学随机值"
AUTH_URL="http://localhost:3000"
AUTH_GITHUB_ID="GitHub OAuth Client ID"
AUTH_GITHUB_SECRET="GitHub OAuth Client Secret"
```

生产 callback 使用 `https://<canonical-host>/api/auth/callback/github`，必须启用 HTTPS，并将相同 canonical origin 写入 `AUTH_URL`。只有可信 reverse proxy 会覆盖并严格约束 forwarded host headers 时才设置 `AUTH_TRUST_HOST=true`；不要默认启用。Auth secrets 只提供给 app，不提供给 VocaDB worker 或 migrate。

公开目录和 API 不要求登录。登录后可在歌曲详情加入“我的收藏”，并创建最多 100 个私有歌单、每个最多 500 首。歌单没有公开分享或协作能力；收藏和歌单只引用 local Song UUID，不写回 VocaDB。歌曲变为不可公开时，用户 relation 会保留为不泄露元数据的 unavailable placeholder，并可移除。

账号设置支持普通当前 session 退出、撤销账号全部 database sessions，以及输入精确确认词后永久删除账号。Hard delete 从 live primary database 清除 User、GitHub provider identity、Sessions、Favorites、Playlists 与 PlaylistSongs，但保留公共 VocaDB catalog；重新登录会创建空账号。VocalHub 不持久化 GitHub OAuth token，旧 token columns 由 committed migration 清空。删除 VocalHub 账号不会自动撤销 GitHub OAuth App authorization；完整边界见 `/privacy`。

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

所有 mode 都必须显式指定。`incremental` 要求至少一次成功 seed；`resume` 只处理 durable manifest 中未完成的 item。`auto` 遇到多个同 entity 的 `RUNNING` run 时 fail closed，需 operator 处理。命令返回非零表示 run 未完全成功或配置/并发锁失败。

独立 artist detail 只刷新已由结构化歌曲 credit 建立、且至少关联一首本地公开歌曲的 Artist；不会导入 VocaDB 全站 artist，也不会为 custom credit 创建 Artist。首次回填和每日错峰刷新：

```bash
npm run sync:vocadb -- artists refresh
npm run sync:vocadb -- artists auto refresh
```

也可通过 `artists ids --ids=100,200` 刷新已存在的 source ID，或用 `artists resume` 恢复中断 manifest。默认刷新间隔为 7 天（`VOCADB_ARTIST_REFRESH_INTERVAL_MS=604800000`）；never-synced、FAILED、summary version/status 已变化和 stale profile 会进入 immutable manifest。建议每日运行 `artists auto refresh`，并与 song incremental/reconcile 错峰；全局 advisory lock 仍串行化所有 VocaDB worker。

同步完成后启动：

```bash
npm run dev
```

访问：

- `http://localhost:3000/`：目录首页
- `http://localhost:3000/songs`：歌曲浏览与搜索
- `/search`：跨歌曲、作者和标签的全站搜索
- `/songs/{localUuid}`：歌曲详情
- `/artists`：作者浏览与搜索
- `/artists/{localUuid}`：作者详情与公开作品
- `/tags`：标签浏览与搜索
- `/tags/{localUuid}`：标签详情与公开歌曲

## 生产部署与调度

仓库提供同一版本的四个 Docker target：

- `app`：Next.js standalone server，需要 `DATABASE_URL` 和 `AUTH_*` runtime 配置。
- `worker`：一次性 VocaDB sync job，需要 `DATABASE_URL` 和 `VOCADB_*` 配置。
- `maintenance`：一次性 expired Auth.js Session cleanup，只需要 `DATABASE_URL`。
- `migrate`：只执行 committed migration，不启动 app、worker 或 maintenance。

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
docker compose -f compose.production.yaml --profile worker run --rm --no-deps worker artists auto refresh
```

建议 incremental 每 15 分钟，reconcile 每日低峰运行，artist refresh 每日错峰调用；seed 只用于首次部署或人工重建 baseline。scheduler 应禁止重叠，但 PostgreSQL advisory lock 仍是所有 VocaDB worker 的最终保护。worker 收到 `SIGTERM`/`SIGINT` 后停止领取新 item、取消 HTTP 等待、等所有 lane 收束再释放 DB 连接；未完成 item 保持 `PENDING`，run 保持 `RUNNING`，下次对应 entity 的 `auto` 恢复。容器至少保留 60 秒 termination grace period。

Auth.js 已在请求时立即拒绝 expired Session。为了删除长期未再访问的过期数据库 row，外部 scheduler 应每日错峰执行：

```bash
docker compose -f compose.production.yaml \
  --profile maintenance run --rm --no-deps session-cleanup
```

maintenance 只接收 `DATABASE_URL`，不接收 OAuth/VocaDB secrets，也不占用 VocaDB advisory lock。它以 PostgreSQL `CURRENT_TIMESTAMP` 计算 cutoff，删除严格早于 database time `- 5 minutes` 的 Session；5 分钟仅是物理 cleanup race grace，不延长认证有效期。重复执行 idempotent，operator 应捕获 JSON summary 和 exit status，并对 nonzero 或每日成功缺失告警。

发布新版本时先暂停 scheduler 并等待 active worker 退出，再运行 `migrate`、部署 `app`，最后恢复 scheduler；advisory lock 不负责协调 migration。同一 entity 出现多个 `RUNNING` run 表示状态歧义，对应 worker 会拒绝自动恢复；应先检查 `SyncRun`/`SyncItem`。`PARTIAL`/`FAILED` run 已终结，需根据 item error 修复后发起新 run。`ACTIVITY_INTERVAL_SATURATED` 需重新执行完整 song seed。production app 不接收 `VOCADB_*`，且 lint 禁止请求路径导入 VocaDB 模块。

### 生产索引 migration

`SongArtistCredit_artistId_songId_idx` 是 partial index，`prisma/schema.prisma` 无法准确表达其 predicate，因此只存在于 committed SQL migration。`SongTag_tagId_songId_idx` 是普通 btree reverse relation index，已在 `prisma/schema.prisma` 与 committed SQL migration 中声明。Stage C 仅推广这两个已有证据支持的 relation indexes；trigram 和数组候选索引不进入 production。部署前确认数据库备份/恢复能力和索引磁盘余量，暂停 incremental/reconcile scheduler，并等待所有 active worker 进程完全退出。普通 `CREATE INDEX` 在 build 期间对目标关系持有 `SHARE` lock：`SELECT` 可继续，但 `INSERT`、`UPDATE`、`DELETE` 会等待；它也可能等待已有未提交 writer。应在低写入窗口运行现有 migrate container，app 可保持只读服务：

```bash
docker compose -f compose.production.yaml --profile migrate run --rm migrate
docker compose -f compose.production.yaml up -d app
```

可通过 `pg_stat_progress_create_index` 和 PostgreSQL lock views 观察 build。migrate 成功后检查 `SongArtistCredit_artistId_songId_idx` 位于 `SongArtistCredit`、key 顺序为 `artistId, songId`、predicate 为 `artistId IS NOT NULL`；同时检查 `SongTag_tagId_songId_idx` 位于 `SongTag`、key 顺序为 `tagId, songId`、predicate 为 null；两个 index 的 `indisvalid` / `indisready` 均应为 true。确认后再恢复 scheduler。

若 build 失败且 SongTag catalog 中索引不存在，先标记 migration rolled back，再重跑 deploy：

```bash
npx prisma migrate resolve --rolled-back 20260802090000_add_song_tag_tag_song_index
npm run db:deploy
```

若进程在 PostgreSQL 已提交 SongTag index、Prisma 尚未记录完成的窗口退出，只有 catalog 显示上述定义完全一致且 valid/ready 时，才执行：

```bash
npx prisma migrate resolve --applied 20260802090000_add_song_tag_tag_song_index
```

同理，Artist index 使用既有 migration `20260727120000_add_song_artist_credit_artist_song_partial_index` 的 resolve 命令。任一 index 缺失或定义冲突时不得标记 applied，也不得恢复 scheduler，必须先解决物理状态与 migration history 的歧义。应用版本回滚应保留这些 additive indexes。若 index 本身必须删除，使用单独审核的 forward migration；紧急手工 `DROP INDEX CONCURRENTLY` 必须在 transaction 外执行、记录操作，并随后用 corrective migration 修复 migration history 与物理状态差异。

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
- 标签还必须关联至少一首公开歌曲。

## 当前 API

```http
GET /api/songs?q=miku&page=1&pageSize=24&sort=latest
GET /api/songs/{localUuid}
GET /api/artists?q=miku&page=1&pageSize=24
GET /api/artists/{localUuid}
GET /api/artists/{localUuid}/songs?page=1&pageSize=24&sort=latest
GET /api/tags?q=rock&page=1&pageSize=24
GET /api/tags/{localUuid}
GET /api/tags/{localUuid}/songs?page=1&pageSize=24&sort=latest
```

通用规则：

- 路径 ID 是本地 UUID；VocaDB 数字 ID 只作为来源标识，不是公开业务主键。
- `page` 默认 `1`、最大 `10000`；`pageSize` 默认 `24`、最大 `50`。
- `sort=latest|popular` 只适用于歌曲集合及 Artist/Tag 的歌曲列表端点。
- Artist/Tag 集合索引只接受 `q`、`page`、`pageSize`，并固定按公开歌曲数降序、名称和本地 UUID 升序排列；未知参数（包括 `sort`）忽略。
- 错误结构为 `{ "error": { "code": "...", "message": "..." } }`。
- 非法 Tag UUID 返回 `400 INVALID_TAG_ID`；不存在或只关联隐藏歌曲的 Tag 返回 `404 TAG_NOT_FOUND`。

歌曲搜索返回歌曲结果。Artist、Tag 和 Song 的标量名称均以大小写不敏感 literal substring 匹配；Artist 与 Tag 的 `additionalNames` 别名均为大小写敏感的精确数组成员匹配。`q` 最长 100 字符，`%`、`_` 和反斜杠按普通字符处理。当前没有模糊匹配、分词、转写或相关度排序。

`/search` 接受同样最长 100 字符的 `q`，trim 后为空时仅显示搜索引导且不访问数据库；合法非空 `q` 直接查询本地 PostgreSQL，在同一快照中返回歌曲、作者和标签的分组预览、准确总数与按需“查看全部”链接。该功能不提供 `/api/search`，Server Component 也不经本站 HTTP API 或 VocaDB。Stage C 已推广 `SongArtistCredit` 与 `SongTag` 反向关系索引；trigram 和数组候选索引仍不进入 production。

`Song.favoritedTimes` 是 VocaDB 上游收藏聚合值，继续用于“热门”排序；它与 VocalHub 登录用户的 `Favorite` 完全独立。本地收藏和私有歌单不加入公开 catalog DTO，也不改变现有匿名 GET API contract。

作者作品只包含通过 `artistId` 结构化关联的公开歌曲。Custom credit 没有 Artist 实体，因此保留歌曲署名，但不生成作者页面。

## 实际数据模型

- `Song`：本地 UUID、VocaDB 来源 ID、展示字段、来源和同步状态。
- `SongName`：多语言标题。
- `Artist`：从歌曲 credit 建立的结构化作者；独立 detail refresh 保存 canonical 名称、简介、头像、source lifecycle 和 summary observation。
- `ArtistName` / `ArtistWebLink`：作者多语言别名与来源外链；disabled 或不安全 URL 不进入公开 DTO。
- `SongArtistCredit`：歌曲署名、roles/categories、support/custom 标记；`artistId` 可空。
- `Tag` / `SongTag`：标签及歌曲关系。
- `SongPV`：外部播放入口。
- `SyncRun` / `SyncItem`：mode、durable manifest、运行边界、尝试和单项结果。
- `VocaDbSongSyncState`：Song activity checkpoint、seed/reconciliation 完成时间和 compare-and-swap version。
- `User` / `Account` / `Session`：Auth.js GitHub identity 与 database session；OAuth token 不持久化，provider token/session/email 不进入公开 DTO。
- `Favorite`：User 与 local Song UUID 的 set-like 私有关系；不改变 `Song.favoritedTimes`。
- `Playlist` / `PlaylistSong`：owner-only 私有歌单和稳定 position；hidden Song relation 可保留但不公开 catalog fields。

声库角色当前通过通用 Artist credit 的 `categories`、`roles` 和 `effectiveRoles` 表示，没有独立 `Vocal` 模型。公开/协作歌单、角色权限与账号管理尚未实现。

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
- artist detail refresh 只从本地已知、关联公开歌曲的 Artist 建 manifest；不调用 artist inventory。成功响应原子替换 canonical aliases/description/avatar/links；临时失败保留最后成功资料并保持 `FAILED` snapshot 可公开，404/deleted/merged 隐藏但不改 local UUID、不自动迁移 credit。
- song detail 中的 embedded artist summary 只负责首次建立 fallback snapshot，并持续写入 `summary*` observation；Artist 已存在后不覆盖独立 detail 的 canonical fields 或 sync state。
- 作者头像与 web link 只保留无 credentials 的 HTTP/HTTPS URL；disabled link 保存在本地 snapshot 但不公开。
- 仅保留 HTTP/HTTPS PV 与媒体 URL；disabled PV 的播放信息和缩略图均不进入公开详情 API 或页面。

## 媒体与来源政策

VocalHub 已获得可追溯书面许可，允许展示 VocaDB 提供的歌曲封面、作者头像和 PV 缩略图，并允许热链、服务端代理与持久缓存；许可原件不提交到公开仓库。当前版本展示歌曲封面、公开 PV 缩略图和独立 artist detail 提供的作者头像。

当前页面使用浏览器直连远程图片源，不经过 VocalHub 图片代理、`/_next/image`、对象存储或 CDN 持久缓存。图片元素使用 `referrerPolicy="no-referrer"`，按用途依次尝试已保存的 rendition，加载失败时显示等尺寸占位；远程主机仍可获得访客 IP、User-Agent 等连接信息。页面 footer 统一标明 VocaDB 来源，歌曲和作者详情继续链接对应原条目，图片权利归各权利人。

当前部署继续 direct hotlink。VocaDB URL 只在 worker 中经过 `normalizeHttpUrl()` 的展示级校验后写入 PostgreSQL；该校验只保证 URL 是无 credentials 的 HTTP/HTTPS 地址，不验证目标 IP、DNS 或 redirect，因此不是 server-side fetch 授权器。当前不会增加接收 caller URL 的 `/api/image?url=...`、任意 hostname proxy、request-time cache miss 回源、容器本地磁盘持久 cache 或数据库 blob。app 保持无状态，用户请求路径不访问 VocaDB。

持久缓存将在部署可提供 S3-compatible object storage、稳定 first-party/CDN base URL、bucket lifecycle/CORS、容量预算、凭证注入和监控后单独实施。目标设计如下：

- worker 只从歌曲、作者和 PV 的结构化媒体字段建立 curated asset manifest；不接受客户端 URL，也不让用户请求触发下载。
- media registry 使用 opaque local asset ID，保留 source URL，并记录 rendition、source fingerprint、object key、MIME、bytes、checksum、ETag/Last-Modified、状态、错误和 fetch timestamps。
- 专用 fetch policy 只允许批准的 VocaDB 媒体 host；每次 DNS 解析与 redirect 都重验 scheme、host 和 IP，拒绝 credentials、loopback、private、link-local 和 reserved targets，并限制 timeout、redirect、响应 bytes、解码像素及允许 MIME。文件 magic bytes 必须与允许类型一致。
- 对象 key 使用 immutable content hash。worker 先上传并完成 DB 状态切换，再公开新对象；source 删除、merged 或失效时先停止引用，旧对象按保留期异步 GC。
- CDN 或 first-party media route 只接受 opaque asset ID/object key，永不接受远端 URL，也不做代理回源。成功对象使用 immutable long-lived cache headers；pending/failed 返回稳定占位或现有 source fallback 策略。
- 后续 DTO 采用 additive contract：保留原始 source URL用于来源追踪与失效，新增 cached/delivery URL；UI 优先 cached URL。不会直接破坏现有 raw URL 字段。

作者 detail 可公开四档头像 URL、plain-text description、稳定去重别名和 enabled web links。description 由 React 转义并保留换行，不作为 HTML/Markdown 执行；unsafe/credential-bearing URL 被丢弃，disabled link 不进入 API 或页面。

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

## 目录查询性能基线

性能 harness 使用确定性合成数据和独立数据库，不请求 VocaDB，也不复用开发库或集成测试库。所有 destructive command 都要求数据库名以 `_benchmark` 结尾，并显式确认 reset：

```bash
docker compose --profile benchmark up -d --wait postgres-benchmark
export BENCHMARK_DATABASE_URL=postgresql://vocalhub:vocalhub@localhost:5434/vocalhub_benchmark
npm run benchmark:catalog -- setup --install-pg-trgm
npm run benchmark:catalog -- load --songs=5000 --seed=20260720 --confirm-reset=vocalhub_benchmark
npm run benchmark:catalog -- run --output=.benchmark-results/catalog-5000.json
```

标准规模为 5k、10k、20k 和当前 Stage C target 50k；20k 仅作为固定对照，不能替代 target 证据。默认每场景 3 次 warmup、15 次 measured run。`run` 调用真实 `listSongs()` / `listArtistWorks()` / Artist、Tag list repository 与 `searchCatalog()`，记录完整调用时延、Prisma emitted SQL 和 `EXPLAIN (ANALYZE, BUFFERS, SETTINGS, FORMAT JSON, TIMING FALSE)`；原始 JSON 输出位于 ignored `.benchmark-results/`，不加入普通 CI。`matrix` 默认要求 5k、10k、20k 和 50k target 全部运行；显式 `--sizes` 也必须包含至少 50k。

`compare-search-shape` 使用相邻 `A→B` / `B→A` 成对样本比较现有 broad Prisma `OR` 与 relation-branch `UNION` 候选：

```bash
npm run benchmark:catalog -- compare-search-shape --warmups=3 --repeats=15 \
  --output=.benchmark-results/catalog-search-shape.json
```

候选索引只在 benchmark DB 比较。`compare` 使用交错 baseline/candidate state cycles，并在计时结束后单独生成 EXPLAIN：

```bash
npm run benchmark:catalog -- compare --candidate=credit-artist \
  --cycles=8 --block-repeats=3 --warmups=1 \
  --confirm-reset=vocalhub_benchmark
```

compare 精确删除所有 `bench_` index；paired result digest 不一致时立即失败。只有 10k/20k 计划证明 PostgreSQL 实际使用候选，且 scan/sort/buffer 与成对时延改善超过执行顺序波动后，才另建生产 migration；“当前规模无需索引”也是合法结论。当前脱敏结论记录于 [`docs/performance/catalog-index-baseline.md`](docs/performance/catalog-index-baseline.md)。

## 路线图

媒体代理、持久缓存与 CDN 的部署评估已完成：当前保留 direct hotlink；object storage/CDN 基础设施就绪后再按上述 worker-curated 方案实施，不开放任意 URL 代理。Auth.js、私有收藏和 owner-only 歌单 MVP 已实现。

1. 在真实数据和用户行为基础上评估标签页、推荐、Redis、AI 与社区能力。
2. 设计账号管理、公开/协作歌单与内容治理后，再扩展当前 private library。
3. S3-compatible object storage、CDN 和隔离测试 bucket 可用后，实施 worker-time media hydration 与 additive delivery URL。
