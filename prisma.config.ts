import "dotenv/config";
import { defineConfig } from "prisma/config";

const directUrl = process.env.DIRECT_URL?.trim();
const databaseUrl = directUrl || process.env.DATABASE_URL?.trim();

if (!databaseUrl) {
  throw new Error("DIRECT_URL or DATABASE_URL must be set for Prisma commands");
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: databaseUrl,
  },
});
