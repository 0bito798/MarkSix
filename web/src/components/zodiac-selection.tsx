import { type ZodiacSelectionMode } from "@/lib/types";

export type ZodiacSelectionDetail = {
  mode: ZodiacSelectionMode | string;
  zodiacsJson: string;
};

export type ZodiacSelectionVariant = "compact" | "prediction" | "history";

type ZodiacEntry = {
  zodiac: string;
  rank: number;
  score: number;
};

export function parseZodiacSelection(text?: string | null): ZodiacEntry[] {
  if (!text) return [];

  try {
    const value: unknown = JSON.parse(text);
    if (!Array.isArray(value)) return [];
    return value.flatMap((item) => {
      if (!item || typeof item !== "object" || !("zodiac" in item) || typeof item.zodiac !== "string") {
        return [];
      }
      return [{
        zodiac: item.zodiac,
        rank: "rank" in item && typeof item.rank === "number" ? item.rank : 0,
        score: "score" in item && typeof item.score === "number" ? item.score : 0,
      }];
    });
  } catch {
    return [];
  }
}

export function zodiacSelectionLabel(mode?: string | null): string {
  return mode === "EXCLUDE" ? "\u6740\u8096" : "\u63a8\u8350\u8096";
}

export function ZodiacSelectionBadges({
  detail,
  actualZodiac,
  variant = "compact",
}: {
  detail: ZodiacSelectionDetail | null | undefined;
  actualZodiac?: string | null;
  variant?: ZodiacSelectionVariant;
}) {
  if (!detail) return null;
  const zodiacs = parseZodiacSelection(detail.zodiacsJson);
  if (zodiacs.length === 0) return null;
  const surfaceClass = variant === "prediction" ? "ball" : variant === "history" ? "history-ball" : "zodiac-token-compact";

  return (
    <div className="zodiac-summary">
      <span className="kv zodiac-summary-label">{zodiacSelectionLabel(detail.mode)}</span>
      <span className="zodiac-token-group">
        {zodiacs.map((item) => (
          <span
            key={item.zodiac}
            className={`zodiac-token zodiac-token-${variant} ${surfaceClass} ${detail.mode === "EXCLUDE" ? "is-excluded" : ""} ${actualZodiac === item.zodiac ? "is-actual" : ""}`}
            title={`#${item.rank} ${item.score.toFixed(2)}`}
          >
            {item.zodiac}
          </span>
        ))}
      </span>
    </div>
  );
}
