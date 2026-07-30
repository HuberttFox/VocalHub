import Link from "next/link";
import { ErrorState } from "@/components/empty-state";
import { PageContainer } from "@/components/page-container";

export default function TagNotFound() {
  return (
    <main id="main-content">
      <PageContainer className="py-20">
        <ErrorState
          code="404"
          title="没有找到这个标签"
          description="标签可能不存在、没有公开关联歌曲，或同步快照不可用。"
          action={<Link className="button-secondary" href="/tags">返回标签目录</Link>}
        />
      </PageContainer>
    </main>
  );
}
