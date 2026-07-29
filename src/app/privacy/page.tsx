import type { Metadata } from "next";
import { PageContainer } from "@/components/page-container";

export const metadata: Metadata = {
  title: "隐私与数据保留",
  description: "VocalHub 账号、会话、私有资料库与远程媒体的数据处理说明",
};

export default function PrivacyPage() {
  return (
    <main id="main-content">
      <PageContainer className="py-12 sm:py-16">
        <p className="eyebrow">Privacy</p>
        <h1 className="mt-4 text-5xl font-bold">隐私与数据保留</h1>
        <div className="mt-10 space-y-6 text-[var(--text-secondary)]">
          <Policy title="GitHub 登录">
            VocalHub 保存 GitHub 提供的名称、邮箱、头像 URL 和 provider identity，用于识别账号。头像当前不展示或代理。OAuth token 只在登录 callback 中短暂使用，不持久化。删除 VocalHub 账号不会自动撤销 GitHub OAuth App authorization；可在 GitHub settings 中另行撤销。
          </Policy>
          <Policy title="Database sessions">
            Session 最长有效 30 天，活跃时约每日滚动更新。到达 expires 后立即视为无效；每日 maintenance job 以 5 分钟物理清理 grace 删除旧数据库记录。账号设置可随时撤销所有设备 session。
          </Policy>
          <Policy title="收藏与歌单">
            收藏和歌单是 owner-only 私有数据，保留到用户主动删除或删除账号。它们只引用本地 Song UUID，不写回 VocaDB。
          </Policy>
          <Policy title="账号删除">
            永久删除会从 live primary database 清除 User、GitHub Account identity、全部 Sessions、Favorites、Playlists 和 PlaylistSongs。公共 VocaDB-derived Song、Artist、Tag、PV 和同步数据继续保留。重新登录会创建新的空账号。
          </Policy>
          <Policy title="备份与运行日志">
            账号删除不承诺立即清除部署方的 backups、replicas 或基础设施日志；其 retention 和最终清理由实际生产运营政策决定。VocalHub 不在应用日志中记录 session token、OAuth token 或用户私有资料内容。
          </Policy>
          <Policy title="远程图片与外部链接">
            当前封面、作者头像和 PV 缩略图由浏览器直接访问 VocaDB 提供的远程 URL。远端主机可获得访客 IP、User-Agent 等正常连接信息。访问 VocaDB、GitHub 或 PV 外链时适用对应服务的隐私政策。
          </Policy>
        </div>
      </PageContainer>
    </main>
  );
}

function Policy({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="surface p-6">
      <h2 className="text-2xl font-semibold text-[var(--text-primary)]">{title}</h2>
      <p className="mt-3 leading-7">{children}</p>
    </section>
  );
}
