import assert from "node:assert/strict";
import test from "node:test";
import { type PrismaClient } from "@prisma/client";
import { generatePredictionsForIssueWithClient } from "@/lib/prediction-service";
import { KILL_TEN_SCORED_VERSION } from "@/lib/strategies";

function makeDraws() {
  return Array.from({ length: 20 }, (_, index) => ({
    id: index + 1,
    issueNo: `2026${String(207 - index).padStart(3, "0")}`,
    drawDate: new Date(Date.UTC(2026, 6, 27 - index)),
    numbersJson: JSON.stringify([1, 2, 3, 4, 5, 6]),
    specialNumber: ((index * 7) % 49) + 1,
    source: "test",
    createdAt: new Date(0),
    updatedAt: new Date(0),
  }));
}

for (const scenario of [
  { issueNo: "2026208", label: "legacy pending" },
  { issueNo: "2026209", label: "legacy-pool scored reviewed" },
]) {
  test(`existing ${scenario.label} kill-ten run is preserved without persistence writes`, async () => {
    const draws = makeDraws();
    const existingRunId = scenario.issueNo === "2026208" ? 208 : 209;
    const calls = {
      findExisting: 0,
      upsertRun: 0,
      deletePicks: 0,
      createPicks: 0,
      deleteWave: 0,
      deleteZodiac: 0,
    };
    let findExistingArgs: unknown;
    const client = {
      draw: {
        findMany: async () => draws,
      },
      predictionRun: {
        findFirst: async (args: unknown) => {
          calls.findExisting += 1;
          findExistingArgs = args;
          return { id: existingRunId };
        },
        upsert: async () => {
          calls.upsertRun += 1;
          return { id: 999 };
        },
      },
      predictionPick: {
        deleteMany: async () => {
          calls.deletePicks += 1;
          return { count: 0 };
        },
        createMany: async () => {
          calls.createPicks += 1;
          return { count: 10 };
        },
      },
      wavePredictionDetail: {
        deleteMany: async () => {
          calls.deleteWave += 1;
          return { count: 0 };
        },
      },
      zodiacPredictionDetail: {
        deleteMany: async () => {
          calls.deleteZodiac += 1;
          return { count: 0 };
        },
      },
    } as unknown as PrismaClient;

    const runIds = await generatePredictionsForIssueWithClient(client, scenario.issueNo, ["kill_ten_special_v1"]);

    assert.deepEqual(runIds, []);
    assert.equal(calls.findExisting, 1);
    assert.deepEqual(findExistingArgs, {
      where: { issueNo: scenario.issueNo, strategy: "kill_ten_special_v1" },
      select: { id: true },
    });
    assert.equal(calls.upsertRun, 0);
    assert.equal(calls.deletePicks, 0);
    assert.equal(calls.createPicks, 0);
    assert.equal(calls.deleteWave, 0);
    assert.equal(calls.deleteZodiac, 0);
  });
}

test("a new issue 2026209 kill-ten run persists the legacy-pool scored version and ten exclusions", async () => {
  const draws = makeDraws();
  let upsertArgs: unknown;
  let createPicksArgs: { data: Array<{ number: number; rank: number; score: number; reason: string }> } | undefined;
  const client = {
    draw: {
      findMany: async () => draws,
    },
    predictionRun: {
      findFirst: async () => null,
      upsert: async (args: unknown) => {
        upsertArgs = args;
        return { id: 209 };
      },
    },
    predictionPick: {
      deleteMany: async () => ({ count: 0 }),
      createMany: async (args: typeof createPicksArgs) => {
        createPicksArgs = args;
        return { count: args?.data.length ?? 0 };
      },
    },
    wavePredictionDetail: {
      deleteMany: async () => ({ count: 0 }),
    },
    zodiacPredictionDetail: {
      deleteMany: async () => ({ count: 0 }),
    },
  } as unknown as PrismaClient;

  const runIds = await generatePredictionsForIssueWithClient(client, "2026209", ["kill_ten_special_v1"]);

  assert.deepEqual(runIds, [209]);
  const persisted = upsertArgs as {
    where: unknown;
    update: { createdAt: Date; selectionMode: string; status: string; hitCount: null; hitRate: null; reviewedAt: null };
    create: unknown;
    select: unknown;
  };
  assert.ok(persisted.update.createdAt instanceof Date);
  assert.deepEqual({
    ...persisted,
    update: { ...persisted.update, createdAt: undefined },
  }, {
    where: {
      issueNo_strategy_strategyVersion: {
        issueNo: "2026209",
        strategy: "kill_ten_special_v1",
        strategyVersion: KILL_TEN_SCORED_VERSION,
      },
    },
    update: {
      createdAt: undefined,
      selectionMode: "EXCLUDE",
      status: "PENDING",
      hitCount: null,
      hitRate: null,
      reviewedAt: null,
    },
    create: {
      issueNo: "2026209",
      strategy: "kill_ten_special_v1",
      strategyVersion: KILL_TEN_SCORED_VERSION,
      selectionMode: "EXCLUDE",
    },
    select: { id: true },
  });
  assert.equal(createPicksArgs?.data.length, 10);
  assert.deepEqual(createPicksArgs?.data.map((pick) => pick.rank), Array.from({ length: 10 }, (_, index) => index + 1));
  assert.ok(createPicksArgs?.data.every((pick) => /^杀码分 \d\.\d{3}/.test(pick.reason)));
});
