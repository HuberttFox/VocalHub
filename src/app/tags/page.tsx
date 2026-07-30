import type { Metadata } from "next";
import Link from "next/link";
import { TagCard } from "@/components/tag-card";
import { EmptyState, ErrorState } from "@/components/empty-state";
import { PageContainer } from "@/components/page-container";
import { PageIntro } from "@/components/page-intro";
import { Pagination } from "@/components/pagination";
import {
  parseEntityListQuery,
  type EntityListQuery,
  type EntityListSearchParams,
} from "@/lib/catalog/entity-list-query";
import { listTags } from "@/lib/tags/repository";

export const metadata: Metadata = {
  title: "标签目录",
  description: "浏览和搜索拥有公开歌曲的本地标签",
};

export default async function TagsPage({
  searchParams,
}: {
  searchParams: Promise<EntityListSearchParams>;
}) {
  const parsed = parseEntityListQuery(await searchParams);
  if (!parsed.success) {
    return (
      <main id="main-content">
        <PageContainer className="py-20">
          <ErrorState
            code="400"
            title="标签列表参数无效"
            description="请检查页码和每页数量参数。"
            action={<Link className="button-secondary" href="/tags">返回标签目录</Link>}
          />
        </PageContainer>
      </main>
    );
  }

  const result = await listTags(parsed.data);
  return (
    <main id="main-content">
      <PageContainer className="py-12 sm:py-16">
        <PageIntro
          eyebrow="Tag library"
          title="标签目录"
          description="浏览和搜索本地标签。只有拥有公开歌曲的标签会显示在这里。"
        />
        <SearchForm query={parsed.data} />
        <div className="mt-8 flex flex-wrap items-center justify-between gap-3 text-sm text-[var(--text-muted)]">
          <p>
            {parsed.data.q
              ? `“${parsed.data.q}” 找到 ${result.pagination.totalItems} 个标签`
              : `共 ${result.pagination.totalItems} 个公开标签`}
          </p>
          {parsed.data.q && <Link className="text-[var(--accent-soft)] hover:text-white" href="/tags">清除搜索</Link>}
        </div>

        {result.items.length > 0 ? (
          <div className="mt-6 grid gap-4 md:grid-cols-2">
            {result.items.map((tag) => <TagCard tag={tag} key={tag.id} />)}
          </div>
        ) : result.pagination.totalItems > 0 ? (
          <EmptyState
            eyebrow="Page unavailable"
            title="这一页没有标签"
            description="页码超过当前结果范围。"
            href={tagPageHref(parsed.data, 1)}
            action="返回第一页"
          />
        ) : (
          <EmptyState
            eyebrow="No results"
            title={parsed.data.q ? "没有匹配的标签" : "还没有公开标签"}
            description={parsed.data.q ? "尝试更短的标签名或精确别名。" : "公开歌曲同步后，关联的标签会出现在这里。"}
            href={parsed.data.q ? "/tags" : undefined}
            action={parsed.data.q ? "清除搜索" : undefined}
          />
        )}
        <Pagination
          current={result.pagination.page}
          total={result.pagination.totalPages}
          label="标签分页"
          hrefForPage={(page) => tagPageHref(parsed.data, page)}
        />
      </PageContainer>
    </main>
  );
}

function SearchForm({ query }: { query: EntityListQuery }) {
  return (
    <form className="surface mt-10 flex flex-wrap items-end gap-4 p-5" method="get">
      <div className="min-w-0 flex-1">
        <label className="text-sm font-medium" htmlFor="q">关键词</label>
        <input name="pageSize" type="hidden" value={query.pageSize} />
        <input
          className="mt-2 w-full rounded-xl border border-[var(--border-subtle)] bg-black/20 px-4 py-3 placeholder:text-[var(--text-muted)]"
          defaultValue={query.q ?? ""}
          id="q"
          maxLength={100}
          name="q"
          placeholder="标签名或精确别名"
          type="search"
        />
      </div>
      <button className="button-primary" type="submit">搜索</button>
    </form>
  );
}

export function tagPageHref(query: EntityListQuery, page: number): string {
  const params = new URLSearchParams();
  if (query.q) params.set("q", query.q);
  if (query.pageSize !== 24) params.set("pageSize", String(query.pageSize));
  if (page !== 1) params.set("page", String(page));
  return params.size ? `/tags?${params}` : "/tags";
}
