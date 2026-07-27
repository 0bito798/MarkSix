import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const detail = {
  mode: "RECOMMEND",
  zodiacsJson: JSON.stringify([{ zodiac: "马", rank: 1, score: 0.9 }]),
};

test("zodiac prediction badges reuse the number-ball style of their surface", async () => {
  (globalThis as typeof globalThis & { React: typeof React }).React = React;
  const { ZodiacSelectionBadges } = await import("@/components/zodiac-selection");
  const predictionMarkup = renderToStaticMarkup(React.createElement(ZodiacSelectionBadges, { detail, variant: "prediction" }));
  const historyMarkup = renderToStaticMarkup(React.createElement(ZodiacSelectionBadges, { detail, variant: "history" }));

  assert.match(predictionMarkup, /zodiac-token[^\"]*ball/);
  assert.match(predictionMarkup, /zodiac-token-prediction/);
  assert.match(historyMarkup, /zodiac-token[^\"]*history-ball/);
  assert.match(historyMarkup, /zodiac-token-history/);
});
