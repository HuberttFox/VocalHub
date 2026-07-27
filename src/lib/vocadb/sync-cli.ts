import type { SyncRunMode } from "@/generated/prisma/enums";

type SongScheduledMode = Extract<
  SyncRunMode,
  "SEED" | "INCREMENTAL" | "RECONCILE"
>;

export type SyncCliRequest =
  | { mode: "IDS"; ids: number[] }
  | { mode: SongScheduledMode }
  | { mode: "AUTO"; target: SongScheduledMode }
  | { mode: "RESUME" }
  | {
      entity: "ARTIST";
      mode: "IDS";
      ids: number[];
    }
  | {
      entity: "ARTIST";
      mode: "REFRESH" | "RESUME";
    }
  | {
      entity: "ARTIST";
      mode: "AUTO";
      target: "REFRESH";
    };

export function parseSyncArgs(args: string[]): SyncCliRequest {
  if (args[0] === "artists") return parseArtistArgs(args.slice(1));

  const [mode, ...flags] = args;
  if (mode === "auto") {
    if (flags.length !== 1) {
      throw new Error("auto mode requires exactly one target mode");
    }
    const target = parseScheduledMode(flags[0]);
    if (!target) {
      throw new Error("auto target must be seed, incremental, or reconcile");
    }
    return { mode: "AUTO", target };
  }

  const idsArguments = flags.filter((argument) => argument.startsWith("--ids="));
  const unknownFlags = flags.filter((argument) => !argument.startsWith("--ids="));

  if (unknownFlags.length > 0) {
    throw new Error(`Unknown sync option: ${unknownFlags[0]}`);
  }

  if (mode === "ids") {
    if (idsArguments.length !== 1) {
      throw new Error("ids mode requires exactly one --ids= argument");
    }
    return {
      mode: "IDS",
      ids: parseIds(idsArguments[0].slice("--ids=".length)),
    };
  }

  if (idsArguments.length > 0) {
    throw new Error("--ids is only supported by ids mode");
  }

  const scheduledMode = parseScheduledMode(mode);
  if (scheduledMode) return { mode: scheduledMode };
  if (mode === "resume") return { mode: "RESUME" };

  throw new Error(
    "Usage: sync-vocadb <ids|seed|incremental|reconcile|resume|auto> [target|--ids=...]",
  );
}

function parseScheduledMode(
  value: string | undefined,
): SongScheduledMode | undefined {
  if (value === "seed") return "SEED";
  if (value === "incremental") return "INCREMENTAL";
  if (value === "reconcile") return "RECONCILE";
  return undefined;
}

function parseArtistArgs(args: string[]): SyncCliRequest {
  const [mode, ...flags] = args;
  if (mode === "auto") {
    if (flags.length !== 1 || flags[0] !== "refresh") {
      throw new Error("artists auto requires exactly the refresh target");
    }
    return { entity: "ARTIST", mode: "AUTO", target: "REFRESH" };
  }
  if (mode === "resume" && flags.length === 0) {
    return { entity: "ARTIST", mode: "RESUME" };
  }
  if (mode === "refresh" && flags.length === 0) {
    return { entity: "ARTIST", mode: "REFRESH" };
  }
  if (mode === "ids" && flags.length === 1 && flags[0].startsWith("--ids=")) {
    return {
      entity: "ARTIST",
      mode: "IDS",
      ids: parseIds(flags[0].slice("--ids=".length)),
    };
  }
  throw new Error(
    "Usage: sync-vocadb artists <ids|refresh|resume|auto> [refresh|--ids=...]",
  );
}

function parseIds(value: string): number[] {
  const ids = value.split(",").map((part) => Number(part.trim()));
  if (
    ids.length === 0 ||
    ids.some((id) => !Number.isSafeInteger(id) || id <= 0)
  ) {
    throw new Error("--ids must contain comma-separated positive integers");
  }
  return [...new Set(ids)].sort((left, right) => left - right);
}
