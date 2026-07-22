import assert from "node:assert/strict";
import test from "node:test";
import { reviewPredictionRun, reviewWaveExclusion } from "@/lib/prediction-review";

test("wave exclusion review misses when excluded wave equals the actual wave", () => {
  const outcome = reviewWaveExclusion("红波", "红波");

  assert.equal(outcome.hit, false);
  assert.equal(outcome.hitCount, 0);
  assert.equal(outcome.hitRate, 0);
  assert.deepEqual(outcome.matchedNumbers, []);
});

test("wave exclusion review hits when excluded wave differs from the actual wave", () => {
  const outcome = reviewWaveExclusion("红波", "蓝波");

  assert.equal(outcome.hit, true);
  assert.equal(outcome.hitCount, 1);
  assert.equal(outcome.hitRate, 1);
  assert.deepEqual(outcome.matchedNumbers, []);
});

test("wave strategy review requires wave detail instead of falling back to number picks", () => {
  assert.throws(
    () => reviewPredictionRun({
      strategy: "wave_special_v1",
      picks: [1],
      winningSpecial: 1,
      actualWave: "红波",
      waveDetail: null,
    }),
    /Missing wave prediction detail/,
  );
});

test("legacy wave strategy review infers wave detail from old wave-color picks", () => {
  const outcome = reviewPredictionRun({
    strategy: "wave_special_v1",
    picks: [1, 3],
    winningSpecial: 1,
    actualWave: "绿波",
    waveDetail: null,
  });

  assert.equal(outcome.hit, false);
  assert.equal(outcome.hitCount, 0);
  assert.equal(outcome.hitRate, 0);
  assert.deepEqual(outcome.matchedNumbers, []);
});

test("zodiac recommendation and exclusion strategies use opposite hit rules", () => {
  const cases = [
    { strategy: "zodiac_nine_v1", mode: "RECOMMEND", actualZodiac: "\u9a6c", expectedHit: true },
    { strategy: "zodiac_six_v1", mode: "RECOMMEND", actualZodiac: "\u9f20", expectedHit: false },
    { strategy: "zodiac_kill_two_v1", mode: "EXCLUDE", actualZodiac: "\u9f20", expectedHit: true },
    { strategy: "zodiac_kill_one_v1", mode: "EXCLUDE", actualZodiac: "\u9a6c", expectedHit: false },
  ] as const;

  for (const item of cases) {
    const outcome = reviewPredictionRun({
      strategy: item.strategy,
      picks: [],
      winningSpecial: 1,
      actualWave: "\u7ea2\u6ce2",
      actualZodiac: item.actualZodiac,
      zodiacDetail: {
        mode: item.mode,
        zodiacsJson: JSON.stringify([{ zodiac: "\u9a6c", rank: 1, score: 0.9 }]),
      },
    });

    assert.equal(outcome.hit, item.expectedHit);
    assert.equal(outcome.hitCount, item.expectedHit ? 1 : 0);
    assert.equal(outcome.hitRate, item.expectedHit ? 1 : 0);
    assert.deepEqual(outcome.matchedNumbers, []);
  }
});
