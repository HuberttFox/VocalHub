import { performance } from "node:perf_hooks";
import {
  digestValue,
  summarizeDurations,
  type TimingSummary,
} from "./measure";

export type PairOrder = "AB" | "BA";

export interface PairedBenchmarkArm<T> {
  warmups: number;
  run(): Promise<T>;
  beforeMeasure?(): void;
  afterMeasure?(): void;
}

export interface PairedMeasurementOptions<T> {
  a: PairedBenchmarkArm<T>;
  b: PairedBenchmarkArm<T>;
  repeats: number;
  digest?: (value: T) => string;
  observePair?: PairedMeasurementObserver<T>;
}

export interface PairedMeasurement {
  pairIndex: number;
  order: PairOrder;
  aDurationMs: number;
  bDurationMs: number;
  bChangePercent: number;
}

export interface PairedMeasurementResult<T> extends PairedMeasurement {
  aValue: T;
  bValue: T;
}

export type PairedMeasurementObserver<T> = (
  result: PairedMeasurementResult<T>,
) => void | Promise<void>;

export interface PairedMeasurementSummary {
  a: TimingSummary;
  b: TimingSummary;
  medianPairedChangePercent: number;
  bWinCount: number;
  bWinRate: number;
  bFirstMedianPairedChangePercent: number | null;
  bSecondMedianPairedChangePercent: number | null;
}

export interface PairedComparison {
  warmups: number;
  repeats: number;
  pairs: PairedMeasurement[];
  summary: PairedMeasurementSummary;
}

export interface AlternatingBlockScheduleOptions {
  cycles: number;
  blockRepeats: number;
}

export interface AlternatingStateBlock {
  cycleIndex: number;
  order: PairOrder;
  position: 0 | 1;
  state: "A" | "B";
  repeats: number;
}

export interface AlternatingStateSuiteOptions<Item, Result> extends AlternatingBlockScheduleOptions {
  warmups: number;
  items: readonly Item[];
  key(item: Item): string;
  setState(state: "A" | "B"): Promise<void>;
  prepareState?(state: "A" | "B"): Promise<void>;
  run(item: Item): Promise<Result>;
  digest?: (value: Result) => string;
}

/** Measures all scenarios inside shared A/B state blocks to avoid per-scenario DDL churn. */
export async function measureAlternatingStateSuite<Item, Result>(
  options: AlternatingStateSuiteOptions<Item, Result>,
): Promise<Map<string, PairedComparison>> {
  validateAlternatingBlockSchedule(options);
  assertCount("warmups", options.warmups, true);
  if (options.items.length === 0) throw new Error("State-block suite requires at least one item");

  const schedule = createAlternatingBlockSchedule(options);
  const digest = options.digest ?? digestValue;
  const expectedDigests = new Map<string, string>();
  const pairs = new Map<string, PairedMeasurement[]>();

  try {
    for (let cycleIndex = 0; cycleIndex < options.cycles; cycleIndex += 1) {
      const blocks = schedule.slice(cycleIndex * 2, cycleIndex * 2 + 2);
      const durations = new Map<string, Partial<Record<"A" | "B", number>>>();

      for (const block of blocks) {
        await options.setState(block.state);
        await options.prepareState?.(block.state);
        for (const item of options.items) {
          const key = options.key(item);
          for (let index = 0; index < options.warmups; index += 1) await options.run(item);
          const samples: number[] = [];
          for (let index = 0; index < block.repeats; index += 1) {
            const measured = await timeCall(() => options.run(item));
            samples.push(measured.durationMs);
            const actualDigest = digest(measured.value);
            const expectedDigest = expectedDigests.get(key) ?? actualDigest;
            expectedDigests.set(key, expectedDigest);
            if (actualDigest !== expectedDigest) {
              throw new Error(
                `State-block benchmark result digest mismatch for ${key} at cycle ${cycleIndex}: expected ${expectedDigest}, received ${actualDigest}`,
              );
            }
          }
          const stateDurations = durations.get(key) ?? {};
          stateDurations[block.state] = summarizeDurations(samples).medianMs;
          durations.set(key, stateDurations);
        }
      }

      for (const item of options.items) {
        const key = options.key(item);
        const stateDurations = durations.get(key) ?? {};
        const aDurationMs = requireStateDuration(stateDurations.A, "A", cycleIndex);
        const bDurationMs = requireStateDuration(stateDurations.B, "B", cycleIndex);
        const measurements = pairs.get(key) ?? [];
        measurements.push({
          pairIndex: cycleIndex,
          order: pairOrder(cycleIndex),
          aDurationMs,
          bDurationMs,
          bChangePercent: percentChange(aDurationMs, bDurationMs),
        });
        pairs.set(key, measurements);
      }
    }
  } finally {
    await options.setState("A");
  }

  return new Map([...pairs].map(([key, measurements]) => [key, {
    warmups: options.warmups,
    repeats: options.blockRepeats,
    pairs: measurements,
    summary: summarizePairedMeasurements(measurements),
  }]));
}

export interface AlternatingStateComparisonOptions<T> extends AlternatingBlockScheduleOptions {
  warmups: number;
  prepareState?(state: "A" | "B"): Promise<void>;
  setState(state: "A" | "B"): Promise<void>;
  run(): Promise<T>;
  digest?: (value: T) => string;
  beforeBlock?(block: AlternatingStateBlock): void;
  afterBlock?(block: AlternatingStateBlock): void;
}

/** Measures alternating baseline/candidate state blocks and always restores baseline state. */
export async function measureAlternatingStateBlocks<T>(
  options: AlternatingStateComparisonOptions<T>,
): Promise<PairedComparison> {
  validateAlternatingBlockSchedule(options);
  assertCount("warmups", options.warmups, true);
  const digest = options.digest ?? digestValue;
  const pairs: PairedMeasurement[] = [];
  const schedule = createAlternatingBlockSchedule(options);
  let expectedDigest: string | undefined;

  try {
    for (let cycleIndex = 0; cycleIndex < options.cycles; cycleIndex += 1) {
      const offset = cycleIndex * 2;
      const blocks = schedule.slice(offset, offset + 2);
      const durations: Partial<Record<"A" | "B", number>> = {};

      for (const block of blocks) {
        await options.setState(block.state);
        await options.prepareState?.(block.state);
        options.beforeBlock?.(block);
        try {
          for (let index = 0; index < options.warmups; index += 1) await options.run();
          const samples: number[] = [];
          for (let index = 0; index < block.repeats; index += 1) {
            const measured = await timeCall(options.run);
            samples.push(measured.durationMs);
            const actualDigest = digest(measured.value);
            expectedDigest ??= actualDigest;
            if (actualDigest !== expectedDigest) {
              throw new Error(
                `State-block benchmark result digest mismatch at cycle ${cycleIndex}: expected ${expectedDigest}, received ${actualDigest}`,
              );
            }
          }
          durations[block.state] = summarizeDurations(samples).medianMs;
        } finally {
          options.afterBlock?.(block);
        }
      }

      const aDurationMs = requireStateDuration(durations.A, "A", cycleIndex);
      const bDurationMs = requireStateDuration(durations.B, "B", cycleIndex);
      pairs.push({
        pairIndex: cycleIndex,
        order: pairOrder(cycleIndex),
        aDurationMs,
        bDurationMs,
        bChangePercent: percentChange(aDurationMs, bDurationMs),
      });
    }
  } finally {
    await options.setState("A");
  }

  return {
    warmups: options.warmups,
    repeats: options.blockRepeats,
    pairs,
    summary: summarizePairedMeasurements(pairs),
  };
}

/**
 * Measures complete asynchronous A and B calls in alternating AB/BA pairs.
 * A pair is deliberately sequential so its percentage compares neighboring calls.
 */
export async function measurePairedAlternating<T>(
  options: PairedMeasurementOptions<T>,
): Promise<PairedComparison> {
  validatePairedMeasurementOptions(options);

  for (let pairIndex = 0; pairIndex < options.a.warmups; pairIndex += 1) {
    await runPair(options.a.run, options.b.run, pairOrder(pairIndex));
  }

  const digest = options.digest ?? digestValue;
  const pairs: PairedMeasurement[] = [];

  for (let pairIndex = 0; pairIndex < options.repeats; pairIndex += 1) {
    const order = pairOrder(pairIndex);
    const pair = await measurePair(options.a, options.b, order);
    const aDigest = digest(pair.a.value);
    const bDigest = digest(pair.b.value);

    if (aDigest !== bDigest) {
      throw new Error(
        `Paired benchmark result digest mismatch at pair ${pairIndex}: A=${aDigest}, B=${bDigest}`,
      );
    }

    const measurement = {
      pairIndex,
      order,
      aDurationMs: pair.a.durationMs,
      bDurationMs: pair.b.durationMs,
      bChangePercent: percentChange(pair.a.durationMs, pair.b.durationMs),
    };
    pairs.push(measurement);
    await options.observePair?.({
      ...measurement,
      aValue: pair.a.value,
      bValue: pair.b.value,
    });
  }

  return {
    warmups: options.a.warmups,
    repeats: options.repeats,
    pairs,
    summary: summarizePairedMeasurements(pairs),
  };
}

export function summarizePairedMeasurements(
  pairs: readonly PairedMeasurement[],
): PairedMeasurementSummary {
  if (pairs.length === 0) throw new Error("Cannot summarize an empty paired measurement set");

  const changes = pairs.map(({ bChangePercent }) => bChangePercent);
  const bFirstChanges = pairs
    .filter(({ order }) => order === "BA")
    .map(({ bChangePercent }) => bChangePercent);
  const bSecondChanges = pairs
    .filter(({ order }) => order === "AB")
    .map(({ bChangePercent }) => bChangePercent);
  const bWinCount = pairs.filter(({ bDurationMs, aDurationMs }) => bDurationMs < aDurationMs).length;

  return {
    a: summarizeDurations(pairs.map(({ aDurationMs }) => aDurationMs)),
    b: summarizeDurations(pairs.map(({ bDurationMs }) => bDurationMs)),
    medianPairedChangePercent: median(changes),
    bWinCount,
    bWinRate: bWinCount / pairs.length,
    bFirstMedianPairedChangePercent: nullableMedian(bFirstChanges),
    bSecondMedianPairedChangePercent: nullableMedian(bSecondChanges),
  };
}

export function pairOrder(pairIndex: number): PairOrder {
  if (!Number.isInteger(pairIndex) || pairIndex < 0) {
    throw new Error("pair index must be a non-negative integer");
  }
  return pairIndex % 2 === 0 ? "AB" : "BA";
}

/**
 * Builds deterministic state blocks for future comparisons that must install or
 * remove state between measurements. Even cycles balance AB and BA ordering.
 */
export function createAlternatingBlockSchedule(
  options: AlternatingBlockScheduleOptions,
): AlternatingStateBlock[] {
  validateAlternatingBlockSchedule(options);

  return Array.from({ length: options.cycles }, (_, cycleIndex) => {
    const order = pairOrder(cycleIndex);
    const states = order === "AB" ? (["A", "B"] as const) : (["B", "A"] as const);
    return states.map((state, position) => ({
      cycleIndex,
      order,
      position: position as 0 | 1,
      state,
      repeats: options.blockRepeats,
    }));
  }).flat();
}

export function validateAlternatingBlockSchedule(
  options: AlternatingBlockScheduleOptions,
): void {
  assertBoundedInteger("cycles", options.cycles, 2, 20);
  if (options.cycles % 2 !== 0) {
    throw new Error("cycles must be even to balance AB and BA ordering");
  }
  assertBoundedInteger("block repeats", options.blockRepeats, 1, 20);
}

function validatePairedMeasurementOptions<T>(options: PairedMeasurementOptions<T>): void {
  assertCount("A warmups", options.a.warmups, true);
  assertCount("B warmups", options.b.warmups, true);
  if (options.a.warmups !== options.b.warmups) {
    throw new Error("A and B warmups must be equal");
  }
  assertCount("repeats", options.repeats, false);
}

async function runPair<T>(
  runA: () => Promise<T>,
  runB: () => Promise<T>,
  order: PairOrder,
): Promise<void> {
  if (order === "AB") {
    await runA();
    await runB();
  } else {
    await runB();
    await runA();
  }
}

async function measurePair<T>(
  armA: PairedBenchmarkArm<T>,
  armB: PairedBenchmarkArm<T>,
  order: PairOrder,
): Promise<{
  a: TimedResult<T>;
  b: TimedResult<T>;
}> {
  if (order === "AB") {
    const a = await timeArm(armA);
    const b = await timeArm(armB);
    return { a, b };
  }

  const b = await timeArm(armB);
  const a = await timeArm(armA);
  return { a, b };
}

interface TimedResult<T> {
  value: T;
  durationMs: number;
}

async function timeArm<T>(arm: PairedBenchmarkArm<T>): Promise<TimedResult<T>> {
  arm.beforeMeasure?.();
  const startedAt = performance.now();
  try {
    const value = await arm.run();
    return { value, durationMs: performance.now() - startedAt };
  } finally {
    arm.afterMeasure?.();
  }
}

async function timeCall<T>(run: () => Promise<T>): Promise<TimedResult<T>> {
  const startedAt = performance.now();
  const value = await run();
  return { value, durationMs: performance.now() - startedAt };
}

function requireStateDuration(
  value: number | undefined,
  state: "A" | "B",
  cycleIndex: number,
): number {
  if (value === undefined) {
    throw new Error(`State-block benchmark omitted ${state} at cycle ${cycleIndex}`);
  }
  return value;
}

function median(values: number[]): number {
  return summarizeDurations(values).medianMs;
}

function nullableMedian(values: number[]): number | null {
  return values.length === 0 ? null : median(values);
}

function percentChange(baseline: number, next: number): number {
  return baseline === 0 ? 0 : ((next - baseline) / baseline) * 100;
}

function assertCount(name: string, value: number, allowZero: boolean): void {
  if (!Number.isInteger(value) || value < (allowZero ? 0 : 1)) {
    throw new Error(`${name} must be ${allowZero ? "a non-negative" : "a positive"} integer`);
  }
}

function assertBoundedInteger(name: string, value: number, minimum: number, maximum: number): void {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
}
