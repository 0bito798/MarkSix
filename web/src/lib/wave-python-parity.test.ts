import assert from "node:assert/strict";
import test from "node:test";
import fixture from "./wave-python-golden.fixture.json";
import { predictWaveFromHistory } from "@/lib/wave-python-parity";

type DrawFixture = {
  issueNo: string;
  drawDate: string;
  numbers: number[];
  specialNumber: number;
  specialWave: string;
};

type PredictionFixture = {
  strategy: string;
  predictedWaves: string[];
  excludedWave: string;
  risk: Record<string, number>;
  confidence: number;
  betLevel?: string | null;
  confidenceNote?: string | null;
  voterPattern: string[];
  recentCounts: Record<string, number>;
  features: Record<string, unknown>;
};

type GoldenCase = {
  id: string;
  kind: "low_history_fallback" | "walk_forward" | "latest_full_history";
  historyLength: number;
  historyLatestIssue: string;
  targetIssue: string | null;
  actualWave: string | null;
  expected: PredictionFixture;
};

const golden = fixture as {
  oracle: { strategy: string; minHistory: number };
  draws: DrawFixture[];
  cases: GoldenCase[];
};

test("wave Python golden fixture covers required parity scenarios", () => {
  assert.ok(golden.cases.some((row) => row.kind === "latest_full_history"));
  assert.ok(golden.cases.some((row) => row.kind === "low_history_fallback"));
  assert.ok(golden.cases.filter((row) => row.kind === "walk_forward" && row.historyLength >= golden.oracle.minHistory).length >= 5);
});

for (const row of golden.cases) {
  test(`wave parity matches Python oracle: ${row.id}`, () => {
    const history = golden.draws.slice(0, row.historyLength);
    const actual = predictWaveFromHistory(history, {
      strategy: golden.oracle.strategy,
      historyLatestIssue: row.historyLatestIssue,
      targetIssue: row.targetIssue,
    });

    assert.deepEqual(actual.predictedWaves, row.expected.predictedWaves);
    assert.equal(actual.excludedWave, row.expected.excludedWave);
    assert.equal(actual.confidence, row.expected.confidence);
    assert.deepEqual(actual.risk, row.expected.risk);
    assert.equal(actual.betLevel ?? null, row.expected.betLevel ?? null);
    assert.equal(actual.confidenceNote ?? null, row.expected.confidenceNote ?? null);
    assert.deepEqual(actual.voterPattern, row.expected.voterPattern);
    assert.deepEqual(actual.recentCounts, row.expected.recentCounts);
    assert.deepEqual(actual.features, row.expected.features);
  });
}
