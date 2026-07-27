import assert from "node:assert/strict";
import test from "node:test";
import {
  KILL_TEN_FULL49_VERSION,
  allStrategies,
  buildFullRankKillTenPicks,
  generateStrategyResult,
  rankAllNumberSupport,
  scheduledStrategies,
} from "@/lib/strategies";
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

test("kill_ten_special_v1 preserves the legacy candidate-pool formula through issue 2026208", () => {
  const strategy: StrategyId = "kill_ten_special_v1";
  const issueNo = "2026208";
  const hotSupport = normalizedSupport(generateStrategyResult("hot_special_v1", draws, issueNo).picks);
  const coldSupport = normalizedSupport(generateStrategyResult("cold_special_v1", draws, issueNo).picks);
  const knowledgeSupport = normalizedSupport(generateStrategyResult("knowledge_mix_v1", draws, issueNo).picks);
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

  const result = generateStrategyResult(strategy, draws, issueNo);
  const repeated = generateStrategyResult(strategy, draws, issueNo);

  assert.equal(result.strategy, strategy);
  assert.equal(result.strategyVersion, strategy);
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

test("full-field support ranks all 49 numbers and shares average ranks for equal raw scores", () => {
  const scores = new Map(Array.from({ length: 49 }, (_, index) => [index + 1, 49 - index]));
  scores.set(11, scores.get(10) ?? 0);

  const ranked = rankAllNumberSupport(scores);

  assert.equal(ranked.ranks.get(1), 1);
  assert.equal(ranked.support.get(1), 1);
  assert.equal(ranked.ranks.get(10), 10.5);
  assert.equal(ranked.ranks.get(11), 10.5);
  assert.equal(ranked.support.get(10), 39.5 / 49);
  assert.equal(ranked.support.get(11), 39.5 / 49);
  assert.equal(ranked.ranks.get(49), 49);
  assert.equal(ranked.support.get(49), 1 / 49);
});

test("full-field kill-ten uses weighted support and comprehensive-rank tie breaking", () => {
  const hotScores = new Map(Array.from({ length: 49 }, (_, index) => [index + 1, 49 - index]));
  const coldScores = new Map(hotScores);
  const knowledgeScores = new Map(hotScores);
  knowledgeScores.set(48, 0);
  knowledgeScores.set(49, 1);

  const picks = buildFullRankKillTenPicks(hotScores, coldScores, knowledgeScores);

  assert.equal(picks.length, 10);
  assert.equal(new Set(picks.map((pick) => pick.number)).size, 10);
  assert.ok(picks.every((pick) => pick.number >= 1 && pick.number <= 49));
  assert.deepEqual(picks.map((pick) => pick.rank), Array.from({ length: 10 }, (_, index) => index + 1));
  assert.equal(picks[0].number, 48);
  assert.equal(picks[1].number, 49);
  assert.equal(picks[0].score, picks[1].score);
  assert.equal(picks[0].score, (194 - 4) / 196);
  assert.match(picks[0].reason, /^杀码分 \d\.\d{3} · 综合保护 \d\.\d{3}（第49）/);
  assert.match(picks[0].reason, /热门保护 \d\.\d{3}（第48）/);
  assert.match(picks[0].reason, /冷门保护 \d\.\d{3}（第48）$/);
});

test("kill_ten_special_v1 switches to the full-field version from issue 2026209", () => {
  const result = generateStrategyResult("kill_ten_special_v1", draws, "2026209");
  const repeated = generateStrategyResult("kill_ten_special_v1", draws, "2026209");

  assert.equal(result.strategyVersion, KILL_TEN_FULL49_VERSION);
  assert.equal(result.selectionMode, "EXCLUDE");
  assert.equal(result.picks.length, 10);
  assert.equal(new Set(result.picks.map((pick) => pick.number)).size, 10);
  assert.ok(result.picks.every((pick) => pick.score < 1));
  assert.ok(new Set(result.picks.map((pick) => pick.score.toFixed(3))).size > 1);
  assert.ok(result.picks.every((pick) => /^杀码分 \d\.\d{3}/.test(pick.reason)));
  assert.deepEqual(repeated.picks, result.picks);
});

test("kill_ten_special_v1 is available to default and scheduled generation", () => {
  const strategy: StrategyId = "kill_ten_special_v1";

  assert.ok(allStrategies().includes(strategy));
  assert.ok(scheduledStrategies().includes(strategy));
});
