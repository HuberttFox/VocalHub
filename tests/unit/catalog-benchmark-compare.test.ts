import { describe, expect, it, vi } from "vitest";
import {
  createAlternatingBlockSchedule,
  measureAlternatingStateBlocks,
  measurePairedAlternating,
  pairOrder,
  summarizePairedMeasurements,
  validateAlternatingBlockSchedule,
  type PairedMeasurement,
} from "../../benchmarks/catalog/compare";

describe("catalog benchmark paired comparison", () => {
  it("warms and measures equal arms in balanced alternating order", async () => {
    const calls: string[] = [];
    const run = (arm: "A" | "B") => async () => {
      calls.push(arm);
      return { ids: [1, 2] };
    };

    const result = await measurePairedAlternating({
      a: { warmups: 2, run: run("A") },
      b: { warmups: 2, run: run("B") },
      repeats: 4,
    });

    expect(calls).toEqual([
      "A", "B", "B", "A",
      "A", "B", "B", "A", "A", "B", "B", "A",
    ]);
    expect(result.warmups).toBe(2);
    expect(result.repeats).toBe(4);
    expect(result.pairs.map(({ pairIndex, order }) => ({ pairIndex, order }))).toEqual([
      { pairIndex: 0, order: "AB" },
      { pairIndex: 1, order: "BA" },
      { pairIndex: 2, order: "AB" },
      { pairIndex: 3, order: "BA" },
    ]);
    expect(result.pairs.every(
      ({ aDurationMs, bDurationMs }) => aDurationMs >= 0 && bDurationMs >= 0,
    )).toBe(true);
  });

  it("awaits each complete asynchronous call before starting the next", async () => {
    const events: string[] = [];
    const deferred: Array<() => void> = [];
    const run = (arm: "A" | "B") => async () => {
      events.push(`${arm}:start`);
      await new Promise<void>((resolve) => deferred.push(resolve));
      events.push(`${arm}:end`);
      return "same";
    };

    const measurement = measurePairedAlternating({
      a: { warmups: 0, run: run("A") },
      b: { warmups: 0, run: run("B") },
      repeats: 1,
    });

    await vi.waitFor(() => expect(events).toEqual(["A:start"]));
    deferred.shift()?.();
    await vi.waitFor(() => expect(events).toEqual(["A:start", "A:end", "B:start"]));
    deferred.shift()?.();
    await measurement;

    expect(events).toEqual(["A:start", "A:end", "B:start", "B:end"]);
  });

  it.each([
    [{ a: -1, b: -1, repeats: 1 }, "A warmups"],
    [{ a: 0.5, b: 0.5, repeats: 1 }, "A warmups"],
    [{ a: 0, b: 1, repeats: 1 }, "warmups must be equal"],
    [{ a: 0, b: 0, repeats: 0 }, "repeats"],
    [{ a: 0, b: 0, repeats: 1.5 }, "repeats"],
  ] as const)("rejects invalid measurement counts %#", async (counts, message) => {
    await expect(measurePairedAlternating({
      a: { warmups: counts.a, run: async () => 1 },
      b: { warmups: counts.b, run: async () => 1 },
      repeats: counts.repeats,
    })).rejects.toThrow(message);
  });

  it("requires A and B digest parity within every pair", async () => {
    let value = 0;

    await expect(measurePairedAlternating({
      a: { warmups: 0, run: async () => ({ value: value++ }) },
      b: { warmups: 0, run: async () => ({ value: value++ }) },
      repeats: 1,
      digest: ({ value: result }) => String(result),
    })).rejects.toThrow("digest mismatch at pair 0");
  });

  it("observes each verified pair with both values", async () => {
    const observed: unknown[] = [];
    await measurePairedAlternating({
      a: { warmups: 0, run: async () => ({ ids: [1] }) },
      b: { warmups: 0, run: async () => ({ ids: [1] }) },
      repeats: 1,
      observePair: (pair) => { observed.push(pair); },
    });
    expect(observed).toEqual([
      expect.objectContaining({
        pairIndex: 0,
        order: "AB",
        aValue: { ids: [1] },
        bValue: { ids: [1] },
      }),
    ]);
  });

  it("summarizes arm durations, paired changes, wins, and order strata", () => {
    const pairs: PairedMeasurement[] = [
      pair(0, "AB", 10, 5),
      pair(1, "BA", 10, 20),
      pair(2, "AB", 20, 10),
      pair(3, "BA", 20, 30),
    ];

    expect(summarizePairedMeasurements(pairs)).toEqual({
      a: { minMs: 10, medianMs: 10, p95Ms: 20, maxMs: 20, meanMs: 15 },
      b: { minMs: 5, medianMs: 10, p95Ms: 30, maxMs: 30, meanMs: 16.25 },
      medianPairedChangePercent: -50,
      bWinCount: 2,
      bWinRate: 0.5,
      bFirstMedianPairedChangePercent: 50,
      bSecondMedianPairedChangePercent: -50,
    });
  });

  it("rejects an empty paired summary", () => {
    expect(() => summarizePairedMeasurements([])).toThrow("empty paired measurement");
  });

  it("measures alternating state blocks and restores baseline", async () => {
    const states: string[] = [];
    let state: "A" | "B" = "A";
    const result = await measureAlternatingStateBlocks({
      cycles: 2,
      blockRepeats: 2,
      warmups: 1,
      async setState(next) {
        state = next;
        states.push(next);
      },
      async run() {
        return { result: "same", state };
      },
      digest: ({ result }) => result,
    });

    expect(result.pairs.map(({ order }) => order)).toEqual(["AB", "BA"]);
    expect(result.pairs).toHaveLength(2);
    expect(states).toEqual(["A", "B", "B", "A", "A"]);
    expect(state).toBe("A");
  });

  it("restores baseline when a state-block call fails", async () => {
    const states: string[] = [];
    await expect(measureAlternatingStateBlocks({
      cycles: 2,
      blockRepeats: 1,
      warmups: 0,
      async setState(state) {
        states.push(state);
      },
      async run() {
        throw new Error("run failed");
      },
    })).rejects.toThrow("run failed");
    expect(states.at(-1)).toBe("A");
  });

  it("creates a deterministic balanced even-cycle state-block schedule", () => {
    expect(createAlternatingBlockSchedule({ cycles: 4, blockRepeats: 3 })).toEqual([
      { cycleIndex: 0, order: "AB", position: 0, state: "A", repeats: 3 },
      { cycleIndex: 0, order: "AB", position: 1, state: "B", repeats: 3 },
      { cycleIndex: 1, order: "BA", position: 0, state: "B", repeats: 3 },
      { cycleIndex: 1, order: "BA", position: 1, state: "A", repeats: 3 },
      { cycleIndex: 2, order: "AB", position: 0, state: "A", repeats: 3 },
      { cycleIndex: 2, order: "AB", position: 1, state: "B", repeats: 3 },
      { cycleIndex: 3, order: "BA", position: 0, state: "B", repeats: 3 },
      { cycleIndex: 3, order: "BA", position: 1, state: "A", repeats: 3 },
    ]);
    expect(pairOrder(0)).toBe("AB");
    expect(pairOrder(1)).toBe("BA");
  });

  it.each([
    [{ cycles: 1, blockRepeats: 1 }, "between 2 and 20"],
    [{ cycles: 3, blockRepeats: 1 }, "must be even"],
    [{ cycles: 22, blockRepeats: 1 }, "between 2 and 20"],
    [{ cycles: 2, blockRepeats: 0 }, "between 1 and 20"],
    [{ cycles: 2, blockRepeats: 21 }, "between 1 and 20"],
    [{ cycles: 2, blockRepeats: 1.5 }, "between 1 and 20"],
  ] as const)("validates bounded even schedules %#", (options, message) => {
    expect(() => validateAlternatingBlockSchedule(options)).toThrow(message);
  });

  it("accepts schedule boundaries", () => {
    expect(() => validateAlternatingBlockSchedule({ cycles: 2, blockRepeats: 1 })).not.toThrow();
    expect(() => validateAlternatingBlockSchedule({ cycles: 20, blockRepeats: 20 })).not.toThrow();
  });
});

function pair(
  pairIndex: number,
  order: "AB" | "BA",
  aDurationMs: number,
  bDurationMs: number,
): PairedMeasurement {
  return {
    pairIndex,
    order,
    aDurationMs,
    bDurationMs,
    bChangePercent: ((bDurationMs - aDurationMs) / aDurationMs) * 100,
  };
}
