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
  exclusionLabel,
}: {
  hit: boolean;
  actualNumber: number;
  exclusionLabel: string;
}): { status: "杀码成功" | "误杀特码"; detail: string } {
  const actual = String(actualNumber).padStart(2, "0");
  const relation = hit ? "未落入" : "落入";

  return {
    status: hit ? "杀码成功" : "误杀特码",
    detail: `特码 ${actual} ${relation}${exclusionLabel}`,
  };
}

export function formatZodiacExclusionReviewResult({
  hit,
  actualZodiac,
  exclusionLabel,
}: {
  hit: boolean;
  actualZodiac: string;
  exclusionLabel: string;
}): { status: "杀肖成功" | "误杀生肖"; detail: string } {
  const relation = hit ? "未落入" : "落入";

  return {
    status: hit ? "杀肖成功" : "误杀生肖",
    detail: `实际生肖：${actualZodiac}，${relation}${exclusionLabel}`,
  };
}
