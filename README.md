# VocalHub

## 产品定位

VocalHub 是一个面向中文用户的本地优先术曲资料目录。它从 [VocaDB](https://github.com/VocaDB/vocadb) 同步歌曲与作者元数据，经运行时校验与清洗后写入本地 PostgreSQL；网站页面与站内 API 只读取本地快照，不在访客请求期间调用 VocaDB。

## 可用功能

- 歌曲目录浏览与基础搜索、最新/热门排序、分页与歌曲详情；封面与公开 PV 缩略图展示，远程图片失败时保留稳定占位。
- 作者与标签浏览、搜索及详情页：作者详情展示独立 VocaDB detail refresh 补充的别名、简介、头像与公开外链；只关联公开歌曲的条目对外可见。
- 全站搜索：一次查询本地 PostgreSQL 快照中的歌曲、作者与标签，按组展示预览与准确总数。
- 发现页：匿名公开热门，登录后基于收藏与歌单的本地个性化推荐（详见「发现页与数据新鲜度」）。
- GitHub OAuth 登录与账号管理：私有收藏、可公开分享与协作编辑的有序歌单、跨设备 session 管理、账号删除与 JSON 数据导出。
- 公开歌单举报与部署侧 moderation 处置边界。

## 五分钟本地启动

要求 Node.js 20.19+、npm、Docker 与 Docker Compose：

```bash
npm ci
cp .env.example .env
docker compose up -d --wait postgres
npm run db:generate
npm run db:deploy
npm run sync:vocadb -- seed
npm run dev
```

`db:deploy` 应用仓库已提交的 migration。`sync:vocadb -- seed` 会联系 VocaDB 抓取完整歌曲目录并写入本地 PostgreSQL，因此 `.env` 必须配置 `VOCADB_USER_AGENT`。所有同步模式的详细说明见 [`worker/README.md`](worker/README.md)。

启动后访问 `http://localhost:3000/` 即可浏览目录。

## GitHub OAuth

登录使用 Auth.js 的 GitHub OAuth 与 PostgreSQL database session。创建 GitHub OAuth App 并将 callback 设为：

```text
http://localhost:3000/api/auth/callback/github
```

在 `.env` 中设置：

```env
AUTH_SECRET="使用密码学随机值"
AUTH_URL="http://localhost:3000"
AUTH_GITHUB_ID="GitHub OAuth Client ID"
AUTH_GITHUB_SECRET="GitHub OAuth Client Secret"
```

公开目录与 API 不要求登录。生产环境的 OAuth 与部署配置见 [`docs/production-deployment-runbook.md`](docs/production-deployment-runbook.md)。

## 发现页与数据新鲜度

匿名访问者获得公开热门结果。登录访问者在不暴露私人关系来源的前提下，获得基于收藏和歌单的本地个性化结果。快照读取由 `DISCOVERY_SNAPSHOT_READS_ENABLED` 控制，属于运营方分阶段启用功能；未启用或快照不新鲜时保留回退新鲜度状态。

## 文档导航

- [`docs/README.md`](docs/README.md)：技术文档索引，按角色指引贡献者、运营/审核者与性能工程师。
- [`docs/development.md`](docs/development.md)：贡献者开发指南，覆盖环境搭建、本地数据库、质量命令与测试隔离。
- [`docs/architecture.md`](docs/architecture.md)：本地优先架构、部署拓扑、隐私边界与路由域说明。
- [`worker/README.md`](worker/README.md)：VocaDB 同步 CLI 完整命令参考。
- [`docs/performance/README.md`](docs/performance/README.md)：性能证据与基准测试说明。
- [`docs/production-deployment-runbook.md`](docs/production-deployment-runbook.md)：生产部署、调度与运营手册。

部署资源供给与定时器激活由运营方负责，相关操作细节见 runbook。

## VocaDB 署名与媒体来源

VocalHub 已获得可追溯书面许可，允许展示 VocaDB 提供的歌曲封面、作者头像与 PV 缩略图。目录数据会同步进本地 PostgreSQL，而非在访客请求期间从 VocaDB 抓取。页面 footer 统一标明 VocaDB 来源，歌曲与作者详情页链接对应原条目；图片权利归各权利人。

参考：

- [VocaDB 源码](https://github.com/VocaDB/vocadb)
- [VocaDB Public API](https://wiki.vocadb.net/docs/development/public-api)
- [VocaDB Swagger](https://vocadb.net/swagger/index.html)
