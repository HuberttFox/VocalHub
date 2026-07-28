import NextAuth from "next-auth";
import GitHub from "next-auth/providers/github";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { getDb } from "@/lib/db";

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(getDb()),
  providers: [GitHub],
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
