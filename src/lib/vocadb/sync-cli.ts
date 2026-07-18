import type { SyncRunMode } from "@/generated/prisma/enums";

export type SyncCliRequest =
  | { mode: "IDS"; ids: number[] }
  | { mode: Exclude<SyncRunMode, "IDS"> }
  | { mode: "RESUME" };

export function parseSyncArgs(args: string[]): SyncCliRequest {
  const [mode, ...flags] = args;
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

  if (mode === "seed") return { mode: "SEED" };
  if (mode === "incremental") return { mode: "INCREMENTAL" };
  if (mode === "reconcile") return { mode: "RECONCILE" };
  if (mode === "resume") return { mode: "RESUME" };

  throw new Error(
    "Usage: sync-vocadb <ids|seed|incremental|reconcile|resume> [--ids=...]",
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
