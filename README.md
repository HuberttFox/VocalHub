# VocalHub（术曲星图）

面向中文用户的现代术曲发现平台。项目基于 [VocaDB](https://github.com/VocaDB/vocadb) 数据，围绕 Vocaloid、Synthesizer V、UTAU 等音乐内容提供浏览、搜索、收藏和歌单能力。

项目当前已初始化为 Next.js 全栈应用。首期重点是完成 VocaDB 数据接入和基础浏览闭环，AI 与社区功能留到后续阶段。

## 项目定位

VocalHub 希望解决中文术曲用户面临的几类问题：

- 歌曲、作者、声库角色和视频资料分散在多个平台。
- 日文、英文资料较多，中文搜索与介绍不足。
- 用户难以从一首歌曲继续发现相似作品。
- 收藏和整理体验分散。

核心价值：

- 聚合歌曲、作者、声库角色、标签和视频入口。
- 支持原文标题、罗马音、译名和别名搜索。
- 通过标签、作者和声库角色帮助用户发现歌曲。
- 为用户提供收藏和歌单能力。

## 数据来源

核心数据来自 VocaDB Web API：

- 源码仓库：[github.com/VocaDB/vocadb](https://github.com/VocaDB/vocadb)
- Public API 文档：[wiki.vocadb.net/docs/development/public-api](https://wiki.vocadb.net/docs/development/public-api)
- Swagger：[vocadb.net/swagger/index.html](https://vocadb.net/swagger/index.html)

网站不应在每次页面请求时直接依赖上游 API。推荐先同步并清洗数据，再从本地数据库提供页面和站内 API。

使用 VocaDB 数据和图片前，需要进一步核对其 API 使用条款、授权、署名要求、限流规则和缓存要求。

## 可行性

项目整体可行。主要技术难点不在页面，而在数据层：

1. **数据映射**：歌曲、作者、声库角色、标签和 PV 存在多对多关系。
2. **多语言检索**：需要同时处理原文、罗马音、英文名、中文译名和别名。
3. **数据同步**：需要支持初始导入、增量更新、失败重试和删除状态。
4. **视频入口**：VocaDB 不保证覆盖每首歌曲的 Bilibili 链接。
5. **推荐质量**：初期缺少用户行为数据，应该先采用标签和关系规则推荐。

## MVP 范围

第一版目标：完成“同步数据、浏览搜索、登录收藏”的产品闭环。

### 必做

- 首页
  - 热门歌曲
  - 最新歌曲
  - 标签入口
  - 规则推荐
- 歌曲详情
  - 多语言标题
  - 作者和声库角色
  - 封面、发布时间、时长
  - 标签和视频入口
  - 相关歌曲
- 作者页面
  - 名称、简介、代表作品和作品列表
- 搜索
  - 歌曲、作者、标签
  - 原文、罗马音、译名和别名
- 用户功能
  - 登录
  - 收藏歌曲
  - 创建和管理歌单
- VocaDB 同步
  - 歌曲、作者、声库角色、标签和 PV
  - 初始导入和增量同步

### 暂缓

- AI 推荐和 AI 中文介绍
- 评论、评分和投稿
- 用户协作标签维护
- 会员和商业化
- 创作者数据分析和粉丝画像

这些功能依赖真实用户、内容审核、运营机制或足够的数据规模。放进 MVP 会延迟核心闭环。

## 技术栈

| 模块 | 技术 |
| --- | --- |
| Web | Next.js 16、React 19、TypeScript |
| 样式 | Tailwind CSS 4 |
| 数据库 | PostgreSQL |
| ORM | Prisma |
| 鉴权 | Auth.js |
| 缓存 | Redis / Upstash |
| 同步任务 | Node.js worker 或独立 cron worker |
| 部署 | Vercel、Supabase、Upstash、Railway/Fly.io |

当前仓库只完成 Next.js、TypeScript、Tailwind CSS 和 ESLint 初始化。PostgreSQL、Prisma、Auth.js、Redis 尚未接入。

## 本地开发

要求：

- Node.js 20.9 或更高版本
- npm

安装依赖并启动开发服务器：

```bash
npm install
npm run dev
```

访问 [http://localhost:3000](http://localhost:3000)。

常用命令：

```bash
npm run dev
npm run lint
npm run build
npm start
```

## 数据模型草案

核心实体：

- `User`：用户
- `Song`：歌曲
- `Artist`：作者或 P 主
- `Vocal`：声库角色
- `Tag`：标签
- `PV`：视频入口
- `Favorite`：收藏
- `Playlist`：歌单
- `PlaylistSong`：歌单歌曲关系

必要关系表：

- `SongArtist`：歌曲和作者多对多
- `SongVocal`：歌曲和声库角色多对多
- `SongTag`：歌曲和标签多对多
- `SongPV`：歌曲和视频入口一对多或多对多

本地实体应保存 `vocadbId`、`sourceUpdatedAt` 和同步状态，便于幂等导入与增量更新。不要把 VocaDB ID 直接当成本地业务主键。

## 数据同步策略

```text
VocaDB Web API
  -> Sync Worker
  -> 校验与数据清洗
  -> PostgreSQL
  -> Next.js API / Server Components
  -> 用户界面
```

### 初始导入

- 先导入 5,000 到 20,000 首活跃或热门歌曲，不以全量数据为首个里程碑。
- 同步歌曲关联的作者、声库角色、标签和 PV。
- 保存上游更新时间和同步游标。

### 增量同步

- 按更新时间或稳定分页游标增量拉取。
- 使用 `vocadbId` 做幂等更新。
- 加入限流、超时、重试和失败记录。
- 热门榜单与内容更新任务分开运行。

### 推荐策略

MVP 不使用生成式 AI。先根据以下关系计算相关推荐：

- 相同作者
- 相同声库角色
- 重合标签
- 相近发布时间
- VocaDB 评分或热门度

## API 草案

```http
GET /api/songs?page=1&tag=rock&vocal=miku
GET /api/songs/{id}
GET /api/artists/{id}
GET /api/artists/{id}/songs
GET /api/search?q=miku

POST /api/favorites
DELETE /api/favorites/{songId}
GET /api/me/favorites

GET /api/me/playlists
POST /api/me/playlists
POST /api/me/playlists/{id}/songs
DELETE /api/me/playlists/{id}/songs/{songId}
```

站内 API 路径统一使用复数资源名，例如 `/api/songs/{id}`，避免 `/api/song/{id}` 与 `/api/songs` 混用。

## 目录结构

```text
vocalhub/
├── src/
│   ├── app/
│   │   ├── page.tsx
│   │   ├── songs/[id]/page.tsx
│   │   ├── artists/[id]/page.tsx
│   │   └── api/
│   ├── components/
│   └── lib/
│       ├── db.ts
│       ├── auth.ts
│       └── vocadb/
├── prisma/
│   └── schema.prisma
├── worker/
│   └── sync-vocadb.ts
├── public/
└── README.md
```

`prisma/`、`worker/` 和大部分业务目录会随开发阶段创建。

## 开发路线

### Phase 0：基础框架

- [x] 初始化 Next.js、React、TypeScript 和 Tailwind CSS。
- [x] 建立基础首页。
- [ ] 接入 PostgreSQL 和 Prisma。
- [ ] 定义环境变量和本地数据库运行方式。

### Phase 1：VocaDB 数据闭环

- 调研并封装 VocaDB API client。
- 建立歌曲、作者、声库角色、标签和 PV 数据模型。
- 实现小批量、幂等同步脚本。
- 实现首页、歌曲详情和作者页面。
- 实现基础搜索。

### Phase 2：用户功能

- 接入 Auth.js。
- 实现收藏。
- 实现歌单创建和管理。

### Phase 3：发现能力

- 实现标签页、热门榜单和规则推荐。
- 增加中文简介字段和人工编辑流程。
- 根据真实数据评估搜索方案与缓存需求。

### Phase 4：AI 与社区

只有在积累数据和用户行为后，再评估 AI 推荐、AI 简介、评论、评分和用户投稿。

## MVP 完成标准

- 可稳定同步一批高质量 VocaDB 数据。
- 可搜索歌曲、作者和标签。
- 歌曲详情展示基础资料和可用视频入口。
- 作者页展示作品列表。
- 用户可登录、收藏歌曲和管理歌单。
- 首页提供热门、最新和相关推荐。
- 手机端可正常使用。

## 下一步

1. 调研 VocaDB API 响应结构、鉴权、限流和授权要求。
2. 接入 PostgreSQL 与 Prisma。
3. 定义核心 schema 和同步游标。
4. 实现最小 VocaDB API client。
5. 同步少量测试数据并完成歌曲详情页。

## 结论

VocalHub 方向成立，目标用户和核心数据源明确。第一版应专注“数据同步 + 浏览搜索 + 收藏歌单”，避免过早引入 AI、社区审核和商业化负担。
