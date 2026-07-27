import assert from "node:assert/strict";
import test from "node:test";
import { type PrismaClient } from "@prisma/client";
import { generatePredictionsForIssueWithClient } from "@/lib/prediction-service";

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
  { issueNo: "2026209", label: "full-field reviewed" },
]) {
  test(`existing ${scenario.label} kill-ten run is returned without persistence writes`, async () => {
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
