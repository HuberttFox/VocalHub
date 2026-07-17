# VocalHub（术曲星图）

面向中文用户的本地优先术曲资料目录。VocalHub 从 [VocaDB](https://github.com/VocaDB/vocadb) 同步歌曲元数据，经过运行时校验与清洗后写入 PostgreSQL；浏览器页面和站内 API 只读取本地快照，不在用户请求期间依赖上游服务。

## 当前状态

已实现：

- Next.js 16、React 19、TypeScript 和 Tailwind CSS 4 前端。
- PostgreSQL 17、Prisma 7 和本地 UUID 业务主键。
- VocaDB song detail client：10 秒超时、最多 3 次有界重试、Zod 契约校验。
- 手工 ID 批量同步 worker；歌曲、标题、artist credits、Artists、Tags、PVs 和同步记录幂等写入。
- 歌曲目录、基础搜索、最新/热门排序、分页与歌曲详情。
- 作者详情和分页作品列表；作者资料来自已同步歌曲中的结构化 credit。
- 单元测试和真实 PostgreSQL 集成测试。

尚未实现：

- 全量导入、定时任务、增量游标和删除事件扫描。
- 独立 VocaDB artist detail 同步、作者简介、别名、头像或社交链接。
- 封面/PV 缩略图展示、代理或缓存策略。
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

同步 4 首默认 seed 歌曲（VocaDB ID：`121,1477,4904,25430`）：

```bash
npm run sync:vocadb
```

也可指定有限 ID 批次：

```bash
npm run sync:vocadb -- --ids=121,1477,4904,25430
```

当前命令不是全量或增量导入器。同步完成后启动：

```bash
npm run dev
```

访问：

- `http://localhost:3000/`：目录首页
- `http://localhost:3000/songs`：歌曲浏览与搜索
- `/songs/{localUuid}`：歌曲详情
- `/artists/{localUuid}`：作者详情与公开作品

## 架构边界

```text
手工 sync CLI
  -> VocaDB GET /api/songs/{vocadbId}
  -> Zod 校验与规范化
  -> Prisma 事务 / PostgreSQL
  -> repository
  -> Route Handlers / Server Components
  -> 页面
```

VocaDB 访问只发生在 `worker/sync-vocadb.ts` 经 `src/lib/vocadb/` 调用时。`src/app/` 中的页面和 API 不访问 VocaDB，也不通过 HTTP 调用本站 API；Server Components 直接复用 repository。

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
- `SyncRun` / `SyncItem`：批次和单项同步结果。

声库角色当前通过通用 Artist credit 的 `categories`、`roles` 和 `effectiveRoles` 表示，没有独立 `Vocal` 模型。未来用户、收藏和歌单模型尚未创建。

## VocaDB client 与同步行为

- 固定请求 `Artists,Names,PVs,Tags,MainPicture,CultureCodes`。
- 仅网络错误、超时、408/425/429 和 5xx 可重试；404、其他 4xx、非法 JSON 和契约错误不重试。
- 已请求关系字段缺失时拒绝写入，避免错误清空已有数据。
- 每首歌曲独立事务并按 `vocadbId` upsert；重复同步保留本地 UUID。
- 404 将已有歌曲标记为 `SOURCE_MISSING`；成功响应中的 `deleted: true` 标记为 `SOURCE_DELETED`。
- `sourceUpdatedAt` 只保存可信上游更新时间；本地抓取时间使用 `lastSyncedAt`。
- 上游枚举/flags 以字符串/字符串数组保存，允许新增值。
- Custom artist credit 即使没有 Artist 实体也保留。
- 仅保留 HTTP/HTTPS PV；disabled PV 不进入公开详情 API 或页面。

## 媒体与来源政策

VocaDB 元数据需要保留来源署名。数据库会保存部分封面和 PV 缩略图 URL，但这不等同于获得第三方图片的热链、代理、缓存或再分发许可。在核实授权、署名、限流与缓存要求前，页面不展示这些远程图片，也不复制歌词。

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

1. 研究并实现 VocaDB 增量游标、全量 seed 与删除事件处理。
2. 核实远程图片授权、署名、热链和缓存策略。
3. 用 5,000–20,000 首真实数据测量搜索与作者作品查询，按结果评估 `pg_trgm` 和关系索引。
4. 独立同步 artist detail，再扩展作者别名、简介和资料图片。
5. 接入 Auth.js，设计 User/Favorite/Playlist 模型和功能。
6. 在真实数据和用户行为基础上评估标签页、推荐、Redis、AI 与社区能力。
