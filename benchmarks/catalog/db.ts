import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type Prisma } from "@/generated/prisma/client";
import type { ArtistWorksDb } from "@/lib/artists/repository";
import type { SongListDb } from "@/lib/songs/repository";

export type CatalogBenchmarkDb = SongListDb & ArtistWorksDb;

export type CatalogQueryEvent = {
  timestamp: string;
  query: string;
  params: string;
  durationMs: number;
  target: string;
};

export type CatalogQueryEventSink = (event: CatalogQueryEvent) => void;

export type CatalogBenchmarkClient = PrismaClient<"query">;

export function createCatalogBenchmarkClient(
  connectionString: string,
  onQuery: CatalogQueryEventSink,
): CatalogBenchmarkClient;
export function createCatalogBenchmarkClient(
  connectionString: string,
): PrismaClient;
export function createCatalogBenchmarkClient(
  connectionString: string,
  onQuery?: CatalogQueryEventSink,
): CatalogBenchmarkClient | PrismaClient {
  const adapter = new PrismaPg({ connectionString });
  if (!onQuery) return new PrismaClient({ adapter });

  const client = new PrismaClient({
    adapter,
    log: [{ emit: "event", level: "query" }],
  });

  client.$on("query", (event: Prisma.QueryEvent) => {
    onQuery({
      timestamp: event.timestamp.toISOString(),
      query: event.query,
      params: event.params,
      durationMs: event.duration,
      target: event.target,
    });
  });

  return client;
}

export type CatalogQueryEventCollector = {
  onQuery: CatalogQueryEventSink;
  clear(): void;
  snapshot(): CatalogQueryEvent[];
};

export function createCatalogQueryEventCollector(): CatalogQueryEventCollector {
  const events: CatalogQueryEvent[] = [];

  return {
    onQuery(event) {
      events.push({ ...event });
    },
    clear() {
      events.length = 0;
    },
    snapshot() {
      return events.map((event) => ({ ...event }));
    },
  };
}
