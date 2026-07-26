type ScoredPick = {
  score: number;
  rank: number;
};

export function orderPicksByScoreDesc<T extends ScoredPick>(picks: T[]): T[] {
  return [...picks].sort((left, right) => right.score - left.score || left.rank - right.rank);
}

export function formatExclusionReviewResult({
  hit,
  actualNumber,
  actualZodiac,
  exclusionLabel,
}: {
  hit: boolean;
  actualNumber: number;
  actualZodiac?: string;
  exclusionLabel: string;
}): { status: "杀码成功" | "误杀特码"; detail: string } {
  const actual = String(actualNumber).padStart(2, "0");
  const zodiac = actualZodiac ? `（${actualZodiac}）` : "";
  const separator = actualZodiac ? "" : " ";
  const relation = hit ? "未落入" : "落入";

  return {
    status: hit ? "杀码成功" : "误杀特码",
    detail: `特码 ${actual}${zodiac}${separator}${relation}${exclusionLabel}`,
  };
}
