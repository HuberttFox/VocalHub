import type { Metadata } from "next";
import { signIn } from "@/auth";
import { PageContainer } from "@/components/page-container";
import { safeReturnPath } from "@/lib/auth/return-path";

export const metadata: Metadata = { title: "登录" };

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{
    callbackUrl?: string | string[];
    error?: string | string[];
  }>;
}) {
  const query = await searchParams;
  const callbackUrl = safeReturnPath(
    typeof query.callbackUrl === "string" ? query.callbackUrl : undefined,
  );

  return (
    <main id="main-content">
      <PageContainer className="py-16">
        <section className="surface mx-auto max-w-lg p-8 text-center">
          <p className="eyebrow">Account</p>
          <h1 className="mt-4 text-4xl font-bold">登录 VocalHub</h1>
          <p className="mt-4 text-[var(--text-secondary)]">
            使用 GitHub 登录后，可管理私人收藏和歌单。公开目录无需登录。
          </p>
          {query.error && (
            <p className="mt-4 text-sm text-red-300">登录未完成，请重试。</p>
          )}
          <form
            action={async () => {
              "use server";
              await signIn("github", { redirectTo: callbackUrl });
            }}
            className="mt-8"
          >
            <button className="button-primary" type="submit">使用 GitHub 登录</button>
          </form>
        </section>
      </PageContainer>
    </main>
  );
}
