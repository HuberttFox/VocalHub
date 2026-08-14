import "dotenv/config";
import { beforeAll, describe, expect, it } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

const connectionString =
  process.env.TEST_DATABASE_URL ??
  "postgresql://vocalhub:vocalhub@localhost:5432/vocalhub_test";
process.env.DATABASE_URL = connectionString;
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

type IndexMetadata = {
  accessMethod: string;
  isUnique: boolean;
  isValid: boolean;
  isReady: boolean;
  keyColumns: string[];
  predicate: string | null;
};

type ForeignKeyMetadata = {
  tableName: string;
  constraintName: string;
  deleteAction: string;
};

beforeAll(async () => {
  await db.$connect();
});

describe("catalog index migrations", () => {
  it("installs the partial reverse artist-credit index", async () => {
    const indexes = await db.$queryRaw<IndexMetadata[]>`
      SELECT
        access_method."amname"::text AS "accessMethod",
        index_metadata."indisunique" AS "isUnique",
        index_metadata."indisvalid" AS "isValid",
        index_metadata."indisready" AS "isReady",
        ARRAY(
          SELECT attribute."attname"::text
          FROM unnest(index_metadata."indkey") WITH ORDINALITY AS key("attnum", "position")
          JOIN pg_attribute AS attribute
            ON attribute."attrelid" = table_relation.oid
           AND attribute."attnum" = key."attnum"
          ORDER BY key."position"
        ) AS "keyColumns",
        pg_get_expr(index_metadata."indpred", index_metadata."indrelid")::text AS "predicate"
      FROM pg_class AS index_relation
      JOIN pg_namespace AS namespace
        ON namespace.oid = index_relation."relnamespace"
      JOIN pg_index AS index_metadata
        ON index_metadata."indexrelid" = index_relation.oid
      JOIN pg_class AS table_relation
        ON table_relation.oid = index_metadata."indrelid"
      JOIN pg_am AS access_method
        ON access_method.oid = index_relation."relam"
      WHERE namespace."nspname" = current_schema()
        AND table_relation."relname" = 'SongArtistCredit'
        AND index_relation."relname" = 'SongArtistCredit_artistId_songId_idx'
    `;

    expect(indexes).toHaveLength(1);
    expect(indexes[0]).toMatchObject({
      accessMethod: "btree",
      isUnique: false,
      isValid: true,
      isReady: true,
      keyColumns: ["artistId", "songId"],
    });
    expect(indexes[0]?.predicate?.replace(/[()"\s]/g, "")).toBe("artistIdISNOTNULL");
  });

  it("installs the reverse tag-song index", async () => {
    const indexes = await db.$queryRaw<IndexMetadata[]>`
      SELECT
        access_method."amname"::text AS "accessMethod",
        index_metadata."indisunique" AS "isUnique",
        index_metadata."indisvalid" AS "isValid",
        index_metadata."indisready" AS "isReady",
        ARRAY(
          SELECT attribute."attname"::text
          FROM unnest(index_metadata."indkey") WITH ORDINALITY AS key("attnum", "position")
          JOIN pg_attribute AS attribute
            ON attribute."attrelid" = table_relation.oid
           AND attribute."attnum" = key."attnum"
          ORDER BY key."position"
        ) AS "keyColumns",
        pg_get_expr(index_metadata."indpred", index_metadata."indrelid")::text AS "predicate"
      FROM pg_class AS index_relation
      JOIN pg_namespace AS namespace
        ON namespace.oid = index_relation."relnamespace"
      JOIN pg_index AS index_metadata
        ON index_metadata."indexrelid" = index_relation.oid
      JOIN pg_class AS table_relation
        ON table_relation.oid = index_metadata."indrelid"
      JOIN pg_am AS access_method
        ON access_method.oid = index_relation."relam"
      WHERE namespace."nspname" = current_schema()
        AND table_relation."relname" = 'SongTag'
        AND index_relation."relname" = 'SongTag_tagId_songId_idx'
    `;

    expect(indexes).toHaveLength(1);
  });

  it("installs discovery snapshot indexes and cascade constraints", async () => {
    const indexes = await db.$queryRaw<IndexMetadata[]>`
      SELECT
        access_method."amname"::text AS "accessMethod",
        index_metadata."indisunique" AS "isUnique",
        index_metadata."indisvalid" AS "isValid",
        index_metadata."indisready" AS "isReady",
        ARRAY(
          SELECT attribute."attname"::text
          FROM unnest(index_metadata."indkey") WITH ORDINALITY AS key("attnum", "position")
          JOIN pg_attribute AS attribute
            ON attribute."attrelid" = table_relation.oid
           AND attribute."attnum" = key."attnum"
          ORDER BY key."position"
        ) AS "keyColumns",
        pg_get_expr(index_metadata."indpred", index_metadata."indrelid")::text AS "predicate"
      FROM pg_class AS index_relation
      JOIN pg_namespace AS namespace ON namespace.oid = index_relation."relnamespace"
      JOIN pg_index AS index_metadata ON index_metadata."indexrelid" = index_relation.oid
      JOIN pg_class AS table_relation ON table_relation.oid = index_metadata."indrelid"
      JOIN pg_am AS access_method ON access_method.oid = index_relation."relam"
      WHERE namespace."nspname" = current_schema()
        AND index_relation."relname" IN (
          'DiscoveryProfile_currentSnapshotId_key',
          'DiscoveryProfile_requiredCatalogVersion_updatedAt_idx',
          'DiscoverySnapshot_userId_status_startedAt_idx',
          'DiscoverySnapshot_status_finishedAt_id_idx',
          'DiscoverySnapshotItem_snapshotId_songId_key'
        )
      ORDER BY index_relation."relname" ASC
    `;
    const constraints = await db.$queryRaw<ForeignKeyMetadata[]>`
      SELECT
        table_relation."relname"::text AS "tableName",
        constraint_relation."conname"::text AS "constraintName",
        constraint_relation."confdeltype"::text AS "deleteAction"
      FROM pg_constraint AS constraint_relation
      JOIN pg_class AS table_relation ON table_relation.oid = constraint_relation."conrelid"
      WHERE constraint_relation."contype" = 'f'
        AND constraint_relation."conname" IN (
          'DiscoveryProfile_userId_fkey',
          'DiscoveryProfile_currentSnapshotId_fkey',
          'DiscoverySnapshot_userId_fkey',
          'DiscoverySnapshotItem_snapshotId_fkey',
          'DiscoverySnapshotItem_songId_fkey'
        )
      ORDER BY constraint_relation."conname" ASC
    `;

    expect(indexes).toHaveLength(5);
    expect(indexes).toEqual(expect.arrayContaining([
      expect.objectContaining({ isUnique: true, isValid: true, isReady: true, keyColumns: ["currentSnapshotId"] }),
      expect.objectContaining({ isUnique: false, isValid: true, isReady: true, keyColumns: ["requiredCatalogVersion", "updatedAt"] }),
      expect.objectContaining({ isUnique: false, isValid: true, isReady: true, keyColumns: ["userId", "status", "startedAt"] }),
      expect.objectContaining({ isUnique: false, isValid: true, isReady: true, keyColumns: ["status", "finishedAt", "id"] }),
      expect.objectContaining({ isUnique: true, isValid: true, isReady: true, keyColumns: ["snapshotId", "songId"] }),
    ]));
    expect(constraints).toEqual([
      { tableName: "DiscoveryProfile", constraintName: "DiscoveryProfile_currentSnapshotId_fkey", deleteAction: "n" },
      { tableName: "DiscoveryProfile", constraintName: "DiscoveryProfile_userId_fkey", deleteAction: "c" },
      { tableName: "DiscoverySnapshotItem", constraintName: "DiscoverySnapshotItem_snapshotId_fkey", deleteAction: "c" },
      { tableName: "DiscoverySnapshotItem", constraintName: "DiscoverySnapshotItem_songId_fkey", deleteAction: "c" },
      { tableName: "DiscoverySnapshot", constraintName: "DiscoverySnapshot_userId_fkey", deleteAction: "c" },
    ]);
  });
});
