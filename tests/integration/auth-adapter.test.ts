import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";
import { PrismaAdapter } from "@auth/prisma-adapter";

const connectionString =
  process.env.TEST_DATABASE_URL ??
  "postgresql://vocalhub:vocalhub@localhost:5433/vocalhub_test";
process.env.DATABASE_URL = connectionString;
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
const adapter = PrismaAdapter(db);

beforeAll(async () => db.$connect());

async function cleanDatabase() {
  await db.session.deleteMany();
  await db.account.deleteMany();
  await db.user.deleteMany();
}

beforeEach(cleanDatabase);
afterAll(async () => {
  await cleanDatabase();
  await db.$disconnect();
});

describe("Auth.js Prisma adapter", () => {
  it("generates a user ID and persists linked accounts and sessions", async () => {
    const user = await adapter.createUser!({
      id: "adapter-discards-this-id",
      name: "Listener",
      email: "listener@example.com",
      emailVerified: null,
      image: null,
    });
    expect(user.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(user.id).not.toBe("adapter-discards-this-id");

    await adapter.linkAccount!({
      id: crypto.randomUUID(),
      userId: user.id,
      type: "oauth",
      provider: "github",
      providerAccountId: "12345",
      access_token: "secret",
    });
    const session = await adapter.createSession!({
      sessionToken: "opaque-session-token",
      userId: user.id,
      expires: new Date("2026-08-27T00:00:00Z"),
    });

    expect(await adapter.getUserByAccount!({
      provider: "github",
      providerAccountId: "12345",
    })).toMatchObject({ id: user.id, email: "listener@example.com" });
    expect(await adapter.getSessionAndUser!(session.sessionToken)).toMatchObject({
      session: { userId: user.id },
      user: { id: user.id },
    });
  });

  it("cascades provider and session records when a user is deleted", async () => {
    const user = await adapter.createUser!({
      id: crypto.randomUUID(),
      name: null,
      email: "cascade@example.com",
      emailVerified: null,
      image: null,
    });
    await adapter.linkAccount!({
      id: crypto.randomUUID(),
      userId: user.id,
      type: "oauth",
      provider: "github",
      providerAccountId: "67890",
    });
    await adapter.createSession!({
      sessionToken: "another-session",
      userId: user.id,
      expires: new Date("2026-08-27T00:00:00Z"),
    });

    await adapter.deleteUser!(user.id);
    expect(await db.account.count()).toBe(0);
    expect(await db.session.count()).toBe(0);
  });
});
