# VocalHub 全站搜索设计

## 目标

新增独立全站搜索入口，为歌曲、作者和标签提供分组预览与完整分页索引。保持现有 `/songs` 页面和 `GET /api/songs` 契约不变，不引入模糊匹配、分词、拼音、转写、相关度评分或外部搜索引擎。

首版同时补齐作者索引、标签索引和标签详情/作品页，使搜索结果都有准确、可浏览的落点。

## 范围

### 页面

- `/search?q=miku`：歌曲、作者、标签分组预览。
- `/artists?q=miku&page=1&pageSize=24`：作者索引和搜索。
- `/tags?q=rock&page=1&pageSize=24`：标签索引和搜索。
- `/tags/{localUuid}?page=1&pageSize=24&sort=latest`：标签详情与公开歌曲。
- 现有 `/songs`、`/artists/{localUuid}` 保持现有职责和契约。

### API

- `GET /api/artists`
- `GET /api/tags`
- `GET /api/tags/{localUuid}`
- `GET /api/tags/{localUuid}/songs`

本轮不新增 `/api/search`。`/search` Server Component 直接调用聚合 repository。出现真实外部消费者后，再把同一 DTO 暴露为 API。

### 明确不做

- 模糊匹配、拼音、转写、分词、同义词。
- 跨实体相关度评分或统一混排。
- Cursor pagination。
- 外部搜索服务。
- 没有 benchmark 证据的生产索引。

## 产品契约

### 导航入口

全局 `SiteHeader` 增加“全站搜索”链接，目标为 `/search`；保留现有“歌曲目录”链接。歌曲目录中的专用搜索继续提交到 `/songs`，不被全站搜索替代。

`/search` 的查询表单提交到 `/search?q=...`；分组“查看全部”链接必须 URL-encode 当前有效 query，并分别进入 `/songs`、`/artists`、`/tags`。无有效 query 时不生成查看全部链接。

### 聚合搜索

固定：

```ts
export const SEARCH_PREVIEW_LIMIT = 6;
```

`/search` 每类最多展示 6 项，返回该类 `totalItems` 和 `hasMore`。查看全部分别进入：

- `/songs?q=...`
- `/artists?q=...`
- `/tags?q=...`

无 `q`、空字符串或纯空白 `q` 时，页面只显示搜索框和提示，不执行三类 list/count 查询，也不展示全量预览。

`/search` 使用独立 query parser，规则如下：

- 只接受一个 `q`；重复 `q` 视为 invalid query。
- `q` trim 后最长 100 字符；超过上限视为 invalid query。
- 缺失或 trim 后为空不是错误，进入空搜索提示状态。
- 未知参数保持忽略，与现有列表端点一致。
- Server Component 对 invalid query 显示稳定错误提示且不执行 repository；未来若暴露 `/api/search`，同一 parser 映射为 `400 INVALID_QUERY`。

预览 `hasMore`：

```ts
hasMore = totalItems > SEARCH_PREVIEW_LIMIT;
```

### 分页索引

`/artists` 和 `/tags` 在没有有效 `q` 时进入可浏览索引；有 `q` 时显示筛选结果。

参数限制与现有歌曲列表一致：

- `q` 最长 100 字符。
- `page` 默认 1，最大 10,000。
- `pageSize` 默认 24，最大 50。
- 已知参数重复出现时拒绝，不静默采用第一个值。
- 未知参数继续忽略。
- 超出真实结果的深页返回空 `items` 和真实 totals。

普通分页 `hasMore`：

```ts
hasMore = page * pageSize < totalItems;
```

### 排序

作者和标签统一采用：

1. `publicSongCount DESC`
2. `lower(displayName) COLLATE "C" ASC`
3. local UUID 升序

固定 `"C"` collation，避免部署数据库 locale 改变名称顺序、深分页和 benchmark checksum。`publicSongCount` 必须是关联公开歌曲的去重计数。歌曲列表继续使用现有 `latest` / `popular` 排序。

### Artist 展示字段

Artist list/search DTO 的 `displayName` 固定取 `Artist.name`，与现有详情主标题一致；`defaultName` 只参与搜索，不覆盖主标题。

`displayAliases` 复用现有详情映射语义：

1. 先遍历按持久化 `ArtistName` 顺序取得的 localized names。
2. 再遍历 `Artist.additionalNames` 的原始数组顺序。
3. 每项 `trim()`，删除空值。
4. 以 `displayName` 作为初始 seen value，按 trim 后精确、大小写敏感值保留首次出现。
5. 不包含 `defaultName`，不排序，不做大小写折叠。

## 可见性

### Song

所有歌曲候选、计数和 hydrate 都复用 `PUBLIC_SONG_WHERE` 的语义：

- `sourceDeleted = false`
- `lastSyncedAt IS NOT NULL`
- `syncStatus IN (SYNCED, FAILED)`

不能只在 hydrate 阶段过滤公开性。

### Artist

作者索引和搜索统一复用 `PUBLIC_ARTIST_WHERE`：作者自身满足公开快照规则，并至少关联一首公开歌曲。

### Tag

新增共享 `PUBLIC_TAG_WHERE`，定义为至少存在一个 `SongTag.song` 满足 `PUBLIC_SONG_WHERE`。

以下入口必须使用同一 Tag 可见性：

- `/tags`
- `/tags/{id}`
- `/search` 标签预览和总数
- `GET /api/tags`
- `GET /api/tags/{id}`
- `GET /api/tags/{id}/songs`

只关联隐藏歌曲的 Tag 对外视为不存在；详情页面进入 not found，详情 API 返回 404。

## 搜索语义

### 标量名称

使用大小写不敏感 literal substring：

- Artist：`name`、`defaultName`、`ArtistName.value`
- Tag：`name`
- Song：保持现有搜索字段和规则

实现必须转义 `%`、`_` 和反斜杠，使其按普通字符匹配，而不是 SQL wildcard。

### 数组别名

采用大小写敏感的精确数组成员匹配：

- `Artist.additionalNames`
- `Tag.additionalNames`

SQL 语义：

```sql
"additionalNames" @> ARRAY[query]::text[]
```

数组 alias substring 不命中。当前歌曲搜索中的 Tag alias 保持同一语义。

本轮不搜索 `Artist.summaryAdditionalNames`。该字段是歌曲 embedded summary observation，不是 canonical 作者索引字段，避免作者搜索结果随 fallback observation 变化。

Custom artist credit 可继续命中歌曲，但不生成 Artist 结果。

### Tag alias 展示

`Tag.additionalNames` DTO 映射：

1. 保持上游原始数组顺序。
2. 每项 `trim()`。
3. 删除空值。
4. 按 trim 后精确值保留首次出现。
5. 不排序，不做大小写折叠。

展示规范化不改变数据库搜索语义。

## 模块边界

```text
src/lib/search/
  query.ts
  repository.ts
  dto.ts

src/lib/artists/
  list-query.ts
  list-repository.ts
  list-dto.ts

src/lib/tags/
  query.ts
  repository.ts
  dto.ts
```

### Artist list domain

负责：

- 作者索引。
- 作者搜索。
- 公开歌曲去重计数。
- 稳定排序和分页。

不把列表逻辑放入现有作者作品查询模块。

### Tag domain

负责：

- Tag 索引和搜索。
- Tag 详情。
- Tag 关联公开歌曲分页。
- Tag alias DTO 规范化。

Tag songs 复用现有 `SongListItemDto`、歌曲 list select/mapping、`SongCard`、`latest/popular` 排序和分页组件。

### Search domain

`search/repository.ts` 只编排三个领域的受限 list primitive，不复制实体搜索 SQL。输出每组：

```ts
{
  items,
  totalItems,
  hasMore
}
```

聚合 repository 不成为通用搜索 SQL 层；实体搜索语义仍归 Song、Artist、Tag 各自 domain。

## 查询与一致性

### 单一候选定义

每个 Artist/Tag list primitive 使用一个 `RepeatableRead` interactive transaction。事务中：

1. 参数化候选 CTE 定义搜索、公开可见性和 `publicSongCount`。
2. 候选关系必须在 count、排序和分页前保证一个实体 UUID 只有一行；关联名称匹配使用 `EXISTS`，或在候选层按实体 ID 分组。禁止让多个 `ArtistName` 命中制造重复作者。
3. 从该候选定义计算 `totalItems`。
4. 从同一候选定义取得当前页和稳定排序字段。
5. 必要时按当前页 ID hydrate DTO。

PostgreSQL CTE 不能跨 statement 复用，因此 count 与 page statement 调用同一个 query builder，生成完全相同的候选谓词。`RepeatableRead` 保证两条 statement 读取同一快照。

使用：

```ts
tx.$queryRaw(Prisma.sql`...`)
```

禁止 `$queryRawUnsafe`，禁止拼接用户查询值。

### 可组合事务 primitive

Song、Artist 和 Tag list domain 各自提供两层接口：

- 公开 wrapper：接收普通 Prisma client，自行开启 `RepeatableRead` transaction。
- transaction primitive：接收 `Prisma.TransactionClient`，只执行当前 transaction 内的 count/page/hydrate，不再开启 transaction。

现有 Song list/search 需要先抽取 transaction primitive；保持 `listSongs()` 和现有 API 的公开签名、结果和查询语义不变。该重构必须有现有 broad/decomposed search 等价测试保护。

### 聚合预览快照

`/search` 在一个外层 `RepeatableRead` transaction 中编排 Song、Artist、Tag 三类 transaction primitive，使三组预览和 totals 来自同一数据库快照。禁止在 interactive transaction 内嵌套 `$transaction`。

### 去重计数

Artist：

```sql
COUNT(DISTINCT "SongArtistCredit"."songId")
```

同一 Artist 可在一首歌中出现多个 credit，因此禁止直接计数 credit 行。

Tag：

```sql
COUNT(DISTINCT "SongTag"."songId")
```

列表总数、每项 `publicSongCount`、排序和页面候选必须使用同一公开可见性谓词，避免 totals、顺序、详情和 API 集合不一致。

## DTO

### Artist list item

至少包含：

- local UUID
- display name
- 可公开头像缩略图或 null
- 去重 display aliases
- `publicSongCount`

不返回 provider identity、同步错误或内部 observation 字段。

### Tag list/detail

至少包含：

- local UUID
- `name`
- 规范化 `additionalNames`
- `publicSongCount`

Tag 详情不返回 relation position、同步内部字段或隐藏歌曲信息。

## API 成功响应

### `GET /api/artists`

```ts
{
  items: ArtistListItemDto[];
  query: { q: string | null };
  pagination: {
    page: number;
    pageSize: number;
    totalItems: number;
    totalPages: number;
  };
}
```

### `GET /api/tags`

```ts
{
  items: TagListItemDto[];
  query: { q: string | null };
  pagination: {
    page: number;
    pageSize: number;
    totalItems: number;
    totalPages: number;
  };
}
```

### `GET /api/tags/{localUuid}`

返回 `TagDetailDto`：

```ts
{
  id: string;
  name: string;
  additionalNames: string[];
  publicSongCount: number;
}
```

### `GET /api/tags/{localUuid}/songs`

复用现有作者作品/歌曲列表 envelope：

```ts
{
  items: SongListItemDto[];
  query: { sort: "latest" | "popular" };
  pagination: {
    page: number;
    pageSize: number;
    totalItems: number;
    totalPages: number;
  };
}
```

List item property names固定如下：

```ts
type ArtistListItemDto = {
  id: string;
  name: string;
  aliases: Array<{ language: string | null; value: string }>;
  avatarUrl: string | null;
  publicSongCount: number;
};

type TagListItemDto = {
  id: string;
  name: string;
  additionalNames: string[];
  publicSongCount: number;
};
```

`q` 在响应中返回 trim 后的有效查询；无有效查询时为 `null`。空页保持相同 envelope，`items: []`。

## API 错误

保持现有结构：

```json
{
  "error": {
    "code": "INVALID_QUERY",
    "message": "..."
  }
}
```

- 非法 Tag UUID：`400 INVALID_TAG_ID`
- 重复、越界或非法 query：`400 INVALID_QUERY`
- 不存在或只关联隐藏歌曲的 Tag：`404 TAG_NOT_FOUND`
- Repository 异常：记录服务端错误，返回 `500 INTERNAL_ERROR`
- 深页无结果：`200`，返回空 items 和真实 totals

错误码沿用现有实体化 API 风格；现有 Artist API 继续使用 `INVALID_ARTIST_ID` / `ARTIST_NOT_FOUND`，Song API 继续使用对应 Song code，不统一成泛化 `INVALID_ID` / `NOT_FOUND`。

页面侧复用稳定 empty state、`not-found.tsx` 和 `error.tsx`。

## 数据库索引策略

### 已有生产索引

生产 migration 已存在：

```sql
CREATE INDEX "SongArtistCredit_artistId_songId_idx"
ON "SongArtistCredit"("artistId", "songId")
WHERE "artistId" IS NOT NULL;
```

该 partial index 只存在于 committed SQL migration，Prisma schema 无法准确表达 predicate。

### 待评估候选

- `SongTag(tagId, songId)`
- `GIN (Artist.name gin_trgm_ops)`
- `GIN (Artist.defaultName gin_trgm_ops)`
- `GIN (ArtistName.value gin_trgm_ops)`
- `GIN (Tag.name gin_trgm_ops)`
- `GIN (Artist.additionalNames)`
- `GIN (Tag.additionalNames)`

当前 production migrations 未启用 `pg_trgm`。不得假设部署数据库已有 extension。

候选索引先在隔离 benchmark DB 上执行：

- 5k、10k、20k 固定基线。
- 若 20k 低于预期生产规模或预计一年内上限，必须加入达到该生产量级或一年上限的数据集。
- `EXPLAIN (ANALYZE, BUFFERS)`。
- 交错 paired measurements。
- planner 实际索引使用检查。
- scan、buffer、sort 和 latency 比较。

前置通配符 `ILIKE '%q%'` 在较小数据集上容易被顺序扫描成本掩盖，因此 20k 不能自动视为充分证据。只有 planner 在代表生产规模的数据集上实际使用候选，且改善超过执行顺序波动时，才创建独立 production migration。

若采用 `pg_trgm`，extension migration、数据库权限、部署、验证和回滚必须独立审核。功能查询与未经验证的生产索引不捆绑提交。

## 测试

### 查询参数

覆盖：

- 缺失、空字符串和纯空白 `q`
- 超过 100 字符
- 重复 `q`、`page`、`pageSize`、`sort`
- 未知参数保持忽略
- literal `%`、`_`、反斜杠
- 最大页码 10,000
- 超出结果的深页

### 搜索语义

覆盖：

- 标量名称大小写不敏感 substring
- Artist/Tag 数组 alias 精确且大小写敏感
- alias substring 不命中
- Custom credit 只产生 Song 结果
- Tag alias 展示保持顺序并 trim、去空、保留首个精确重复值

### 可见性和 SQL/Prisma 等价性

在同一 fixture 下比较 Prisma 可见性谓词和 raw SQL 候选集合：

- `SYNCED` 公开歌曲
- `FAILED` last-good snapshot
- `PENDING`、`SOURCE_MISSING`、`SOURCE_DELETED`
- `sourceDeleted = true`
- 从未同步歌曲
- `mergedToVocaDbId` 非空的 merged Artist
- 同一 Artist/歌曲多 credit
- 同一 Artist 有多个名称同时命中查询，候选、total 和页面项仍各出现一次
- 只关联隐藏歌曲的 Artist
- 只关联隐藏歌曲的 orphan Tag
- 同一 Tag 关联公开和隐藏歌曲

验证以下入口返回同一公开集合和计数：

- Artist/Tag 索引
- `/search` 分组预览和 totals
- Artist/Tag 详情
- Tag songs repository 和 API
- `PUBLIC_ARTIST_WHERE` / `PUBLIC_TAG_WHERE` 参考 Prisma 查询

### 排序、分页和预览

覆盖：

- `COUNT(DISTINCT songId)`
- 作品数相同后的名称和 UUID tie-break
- 稳定深分页
- preview `items < totalItems` 的查看全部链接
- 恰好 6 项时 `hasMore = false`
- 7 项时 `hasMore = true`
- 普通分页最后一页 `hasMore = false`

## 验证门

- Unit：query parsing、DTO mapping、alias normalization。
- PostgreSQL integration：集合、计数、排序、可见性、页面 repository 和 API contract。
- Benchmark：作者/标签主名、alias、无命中、高扇出 Tag、深页和聚合预览。
- Regression：unit、integration、TypeScript、lint、build、`git diff --check`。
- 生产索引只基于 benchmark 证据另行提交。

## 分阶段实施边界

完整设计拆为三个连续、各自可验证的实施计划，避免一个计划同时修改全部查询、页面和 benchmark：

### 阶段 A：Artist/Tag 可浏览面

- 共享 `PUBLIC_TAG_WHERE`、query contract 和 DTO。
- Artist index/search repository、transaction primitive、公开 wrapper、API 和 `/artists` 页面。
- Tag index/search/detail/song repository、transaction primitive、公开 wrapper、API、`/tags` 和 `/tags/{id}` 页面。
- 原始 SQL与 Prisma 可见性/集合等价测试。
- 普通 unit、integration、TypeScript、lint、build 门。

阶段 A 不修改生产索引；允许使用已存在的 Artist partial index。

### 阶段 B：全站聚合搜索

- 抽取现有 Song list/search transaction primitive，保持公开契约不变。
- 组合阶段 A 已提供的 Artist/Tag transaction primitive，不重写其查询。
- 新增 `/search` 聚合 repository、页面、分组预览和全局导航入口。
- 验证三组共享快照、固定 6 项预览、totals、`hasMore` 和查看全部链接。

### 阶段 C：Benchmark 与生产索引决策

- 扩展 synthetic data 和 scenario，覆盖 ArtistName、Artist/Tag alias、Tag 扇出、深页和聚合预览。
- 运行固定 5k/10k/20k；20k 低于生产量级或一年上限时继续扩大。
- 比较 `SongTag(tagId, songId)`、trigram 和 array GIN 候选。
- 记录脱敏 EXPLAIN 与 paired evidence。
- 仅对证据成立的候选另建 production migration 和部署说明。

每个阶段单独计划、实现、review 和验证。阶段 C 可以得出“不增加新索引”的结论。
