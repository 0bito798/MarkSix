const LEGACY_REASON_LABELS: Array<[RegExp, string]> = [
  [/\bmarkov transition\b/gi, "马尔科夫转移"],
  [/\bMarkov\b/g, "开奖转移"],
  [/\bspecial transition\b/gi, "特别号转移"],
  [/\bsecond order\b/gi, "二阶转移"],
  [/\bphase\b/gi, "阶段节奏"],
  [/\bscore=/gi, "综合分="],
  [/\bscore\b/gi, "综合分"],
];

export function formatPredictionReason(reason: string): string {
  return LEGACY_REASON_LABELS.reduce(
    (formatted, [pattern, replacement]) => formatted.replace(pattern, replacement),
    reason,
  );
}
