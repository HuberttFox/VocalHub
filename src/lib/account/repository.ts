import { getDb } from "@/lib/db";

export type AccountSettingsDto = {
  name: string | null;
  email: string | null;
  createdAt: string;
  providers: string[];
};

export async function getAccountSettings(userId: string): Promise<AccountSettingsDto | null> {
  const user = await getDb().user.findUnique({
    where: { id: userId },
    select: {
      name: true,
      email: true,
      createdAt: true,
      accounts: { select: { provider: true }, orderBy: { provider: "asc" } },
    },
  });
  return user
    ? {
        name: user.name,
        email: user.email,
        createdAt: user.createdAt.toISOString(),
        providers: [...new Set(user.accounts.map((account) => account.provider))],
      }
    : null;
}

export async function revokeUserSessions(userId: string): Promise<number> {
  return (await getDb().session.deleteMany({ where: { userId } })).count;
}

export async function deleteUserAccount(userId: string): Promise<boolean> {
  return (await getDb().user.deleteMany({ where: { id: userId } })).count > 0;
}
