import assert from "node:assert/strict";
import test from "node:test";
import { allStrategies, generateStrategyResult, scheduledStrategies } from "@/lib/strategies";
import { type StrategyId, type StrategyResult } from "@/lib/types";

function makeDraw(specialNumber: number, day: number) {
  const numbers = Array.from({ length: 6 }, (_, index) => ((day * 7 + index * 11) % 49) + 1);
  return {
    id: day,
    issueNo: `2026${String(day).padStart(3, "0")}`,
    drawDate: new Date(Date.UTC(2026, 0, day)),
    numbersJson: JSON.stringify(numbers),
    specialNumber,
    source: "test",
    createdAt: new Date(Date.UTC(2026, 0, day)),
    updatedAt: new Date(Date.UTC(2026, 0, day)),
  };
}

const draws = Array.from({ length: 90 }, (_, index) => {
  const day = 90 - index;
  return makeDraw(((day * 13 + (day % 7) * 5) % 49) + 1, day);
});

function normalizedSupport(picks: StrategyResult["picks"]): Map<number, number> {
  const poolSize = picks.length;
  return new Map(picks.map((pick) => [pick.number, (poolSize - pick.rank + 1) / poolSize]));
}

test("kill_ten_special_v1 ranks exactly ten exclusions from hot, cold, and doubled knowledge support", () => {
  const strategy: StrategyId = "kill_ten_special_v1";
  const hotSupport = normalizedSupport(generateStrategyResult("hot_special_v1", draws, "2026091").picks);
  const coldSupport = normalizedSupport(generateStrategyResult("cold_special_v1", draws, "2026091").picks);
  const knowledgeSupport = normalizedSupport(generateStrategyResult("knowledge_mix_v1", draws, "2026091").picks);
  const expected = Array.from({ length: 49 }, (_, index) => index + 1)
    .map((number) => {
      const protection =
        (hotSupport.get(number) ?? 0) +
        (coldSupport.get(number) ?? 0) +
        2 * (knowledgeSupport.get(number) ?? 0);
      return { number, score: 1 - protection / 4 };
    })
    .sort((a, b) => b.score - a.score || a.number - b.number)
    .slice(0, 10);

  const result = generateStrategyResult(strategy, draws, "2026091");
  const repeated = generateStrategyResult(strategy, draws, "2026091");

  assert.equal(result.strategy, strategy);
  assert.equal(result.selectionMode, "EXCLUDE");
  assert.equal(result.picks.length, 10);
  assert.equal(new Set(result.picks.map((pick) => pick.number)).size, 10);
  assert.ok(result.picks.every((pick) => pick.number >= 1 && pick.number <= 49));
  assert.deepEqual(result.picks.map((pick) => pick.number), expected.map((pick) => pick.number));
  assert.deepEqual(result.picks.map((pick) => pick.rank), Array.from({ length: 10 }, (_, index) => index + 1));
  result.picks.forEach((pick, index) => assert.ok(Math.abs(pick.score - expected[index].score) < 1e-12));
  assert.ok(result.picks.every((pick) => pick.reason.trim().length > 0));
  assert.deepEqual(repeated.picks, result.picks);
});

test("kill_ten_special_v1 is available to default and scheduled generation", () => {
  const strategy: StrategyId = "kill_ten_special_v1";

  assert.ok(allStrategies().includes(strategy));
  assert.ok(scheduledStrategies().includes(strategy));
});
