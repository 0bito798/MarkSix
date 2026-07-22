import assert from "node:assert/strict";
import test from "node:test";
import { allStrategies, generateStrategyResult, rankZodiacScores, scheduledStrategies } from "@/lib/strategies";
import { type StrategyId } from "@/lib/types";

function makeDraw(specialNumber: number, day: number) {
  return {
    id: day,
    issueNo: `2026${String(day).padStart(3, "0")}`,
    drawDate: new Date(Date.UTC(2026, 0, day)),
    numbersJson: JSON.stringify([3, 8, 12, 20, 31, 42]),
    specialNumber,
    source: "test",
    createdAt: new Date(Date.UTC(2026, 0, day)),
    updatedAt: new Date(Date.UTC(2026, 0, day)),
  };
}

const zodiacDraws = Array.from({ length: 36 }, (_, index) => {
  const specialNumber = index < 14 ? 1 : index < 23 ? 2 : index < 30 ? 3 : 4;
  return makeDraw(specialNumber, 36 - index);
});

function generateZodiacSelection(strategy: StrategyId) {
  const result = generateStrategyResult(strategy, zodiacDraws, "2026037");
  assert.equal(result.picks.length, 0);
  assert.ok(result.zodiacSelection);
  return result.zodiacSelection;
}

test("pure zodiac strategies use the shared ranking and never emit number picks", () => {
  const ranked = rankZodiacScores(zodiacDraws, "2026037").map((item) => item.zodiac);
  const nine = generateZodiacSelection("zodiac_nine_v1");
  const six = generateZodiacSelection("zodiac_six_v1");
  const killTwo = generateZodiacSelection("zodiac_kill_two_v1");
  const killOne = generateZodiacSelection("zodiac_kill_one_v1");

  assert.equal(nine.mode, "RECOMMEND");
  assert.deepEqual(nine.zodiacs.map((item) => item.zodiac), ranked.slice(0, 9));
  assert.equal(six.mode, "RECOMMEND");
  assert.deepEqual(six.zodiacs.map((item) => item.zodiac), ranked.slice(0, 6));
  assert.equal(killTwo.mode, "EXCLUDE");
  assert.deepEqual(killTwo.zodiacs.map((item) => item.zodiac), ranked.slice(-2).reverse());
  assert.equal(killOne.mode, "EXCLUDE");
  assert.deepEqual(killOne.zodiacs.map((item) => item.zodiac), ranked.slice(-1));
});

test("all default and scheduled strategy sets include every pure zodiac strategy", () => {
  const zodiacStrategies: StrategyId[] = ["zodiac_nine_v1", "zodiac_six_v1", "zodiac_kill_two_v1", "zodiac_kill_one_v1"];

  for (const strategy of zodiacStrategies) {
    assert.ok(allStrategies().includes(strategy));
    assert.ok(scheduledStrategies().includes(strategy));
  }
});
