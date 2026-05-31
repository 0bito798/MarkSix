import assert from "node:assert/strict";
import test from "node:test";
import { allStrategies, buildMarkovTransitionScores, generateStrategyResult, scheduledStrategies } from "@/lib/strategies";

function makeDraw(numbers: number[], specialNumber: number, day: number) {
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

const markovDraws = [
  makeDraw([1, 2, 3, 4, 5, 6], 7, 7),
  makeDraw([42, 10, 11, 12, 13, 14], 40, 6),
  makeDraw([7, 15, 16, 17, 18, 19], 7, 5),
  makeDraw([42, 20, 21, 22, 23, 24], 41, 4),
  makeDraw([7, 25, 26, 27, 28, 29], 7, 3),
  makeDraw([42, 30, 31, 32, 33, 34], 43, 2),
  makeDraw([7, 35, 36, 37, 38, 39], 7, 1),
];

test("Markov transition scores favor observed followers of the latest state", () => {
  const scores = buildMarkovTransitionScores(markovDraws);
  const ranked = [...scores.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]);

  assert.equal(ranked[0][0], 42);
  assert.ok((scores.get(42) ?? 0) > (scores.get(10) ?? 0));
});

test("Markov transition profile uses second-order chains", () => {
  const draws = [
    makeDraw([8, 1, 2, 3, 4, 5], 8, 8),
    makeDraw([7, 6, 9, 10, 11, 12], 7, 7),
    makeDraw([30, 13, 14, 15, 16, 17], 30, 6),
    makeDraw([8, 18, 19, 20, 21, 22], 8, 5),
    makeDraw([7, 23, 24, 25, 26, 27], 7, 4),
    makeDraw([30, 28, 29, 31, 32, 33], 30, 3),
    makeDraw([8, 34, 35, 36, 37, 38], 8, 2),
    makeDraw([7, 39, 40, 41, 42, 43], 7, 1),
  ];
  const profile = buildMarkovTransitionScores(draws, { includeProfile: true });

  assert.ok(profile.secondOrderScores.get(30)! > profile.secondOrderScores.get(31)!);
  assert.ok(profile.attributeScores.get(30)! >= 0);
});

test("markov_special_v1 stays separate from the default strategy list", () => {
  assert.ok(!allStrategies().includes("markov_special_v1"));

  const result = generateStrategyResult("markov_special_v1", markovDraws, "2026008");

  assert.equal(result.strategy, "markov_special_v1");
  assert.equal(result.picks.length, 18);
  assert.equal(result.picks[0].number, 42);
  assert.ok(result.picks.every((pick) => pick.number >= 1 && pick.number <= 49));
});

test("scheduled generation includes Markov without changing defaults", () => {
  assert.ok(!allStrategies().includes("markov_special_v1"));
  assert.ok(scheduledStrategies().includes("markov_special_v1"));
});
