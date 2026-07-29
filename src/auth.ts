import NextAuth from "next-auth";
import GitHub from "next-auth/providers/github";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { getDb } from "@/lib/db";
import { stripOAuthTokens } from "@/lib/auth/account-policy";

const adapter = PrismaAdapter(getDb());
const deleteSession = adapter.deleteSession;
adapter.deleteSession = async (sessionToken) => {
  if (!deleteSession) return undefined;
  try {
    return (await deleteSession(sessionToken)) ?? undefined;
  } catch (error) {
    if (isMissingRecordError(error)) return undefined;
    throw error;
  }
};

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter,
  providers: [GitHub({ account: stripOAuthTokens })],
  pages: { signIn: "/signin" },
  session: {
    strategy: "database",
    maxAge: 30 * 24 * 60 * 60,
    updateAge: 24 * 60 * 60,
  },
  callbacks: {
    session({ session, user }) {
      session.user.id = user.id;
      return session;
    },
  },
});

function isMissingRecordError(error: unknown): boolean {
  return Boolean(
    error && typeof error === "object" && "code" in error && error.code === "P2025",
  );
}
