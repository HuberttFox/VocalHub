import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageContainer } from "@/components/page-container";
import { AccountProviderDisconnectForm } from "@/components/account-provider-disconnect-form";
import { requireViewer } from "@/lib/auth/session";
import { ACCOUNT_DELETE_CONFIRMATION } from "@/lib/auth/account-policy";
import { deleteAccountAction, revokeAllSessionsAction } from "@/lib/account/actions";
import { getAccountSettings } from "@/lib/account/repository";

export const metadata: Metadata = { title: "账号设置" };

export default async function SettingsPage() {
  const viewer = await requireViewer("/settings");
  const account = await getAccountSettings(viewer.id);
  if (!account) notFound();

  return (
    <main id="main-content">
      <PageContainer className="py-12 sm:py-16">
        <p className="eyebrow">Account</p>
        <h1 className="mt-4 text-5xl font-bold">账号设置</h1>
        <section className="surface mt-10 p-6">
          <h2 className="text-2xl font-semibold">账号信息</h2>
          <dl className="mt-5 grid gap-4 sm:grid-cols-2">
            <div><dt className="text-sm text-[var(--text-muted)]">名称</dt><dd className="mt-1">{account.name ?? "未提供"}</dd></div>
            <div><dt className="text-sm text-[var(--text-muted)]">邮箱</dt><dd className="mt-1">{account.email ?? "未提供"}</dd></div>
            <div><dt className="text-sm text-[var(--text-muted)]">登录来源</dt><dd className="mt-1">{account.providers.join("、") || "GitHub"}</dd></div>
            <div><dt className="text-sm text-[var(--text-muted)]">创建时间</dt><dd className="mt-1">{new Date(account.createdAt).toLocaleDateString("zh-CN")}</dd></div>
          </dl>
          <p className="mt-5 text-sm text-[var(--text-muted)]">
            详情参见 <Link className="text-[var(--accent-soft)]" href="/privacy">隐私与数据保留</Link>。
          </p>
          <a className="button-secondary mt-5 inline-flex" download href="/api/account/export">
            下载我的数据
          </a>
          <p className="mt-3 text-sm text-[var(--text-muted)]">
            导出包含账号资料、收藏和私有歌单，不包含 OAuth token。
          </p>
        </section>

        <section className="surface mt-8 p-6">
          <h2 className="text-2xl font-semibold">登录来源</h2>
          <p className="mt-3 text-[var(--text-secondary)]">
            断开登录来源会删除 VocalHub 本地 provider identity 和全部 database sessions；不会撤销 GitHub OAuth App authorization。
          </p>
          <div className="mt-5 space-y-3">
            {account.providers.map((provider) => (
              <div className="flex flex-wrap items-center justify-between gap-3" key={provider}>
                <span>{provider}</span>
                {account.providers.length > 1 ? (
                  <AccountProviderDisconnectForm provider={provider} />
                ) : (
                  <span className="text-sm text-[var(--text-muted)]">最后一个登录来源不可断开</span>
                )}
              </div>
            ))}
          </div>
        </section>

        <section className="surface mt-8 p-6">
          <h2 className="text-2xl font-semibold">撤销所有设备登录</h2>
          <p className="mt-3 text-[var(--text-secondary)]">
            删除当前账号的全部 database sessions。当前浏览器也会退出；收藏和歌单不受影响。
          </p>
          <form action={revokeAllSessionsAction} className="mt-5">
            <button className="button-secondary" type="submit">撤销全部登录</button>
          </form>
        </section>

        <section className="danger-surface mt-8 p-6">
          <p className="eyebrow text-red-300">Danger zone</p>
          <h2 className="mt-3 text-2xl font-semibold">永久删除账号</h2>
          <p className="mt-3 text-red-100/80">
            立即删除 primary database 中的全部 provider identity、全部 sessions、收藏与歌单。操作不可恢复；公共 VocaDB catalog 不受影响。
          </p>
          <form action={deleteAccountAction} className="mt-6 max-w-lg">
            <label className="block" htmlFor="confirmation">
              <span className="text-sm text-red-100">输入“{ACCOUNT_DELETE_CONFIRMATION}”确认</span>
              <input
                autoComplete="off"
                className="field mt-2"
                id="confirmation"
                name="confirmation"
                required
              />
            </label>
            <button className="button-danger mt-4" type="submit">永久删除账号</button>
          </form>
        </section>
      </PageContainer>
    </main>
  );
}
