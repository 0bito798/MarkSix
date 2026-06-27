export type WaveBadgeTone = "red" | "blue" | "green";

const WAVE_META: Record<string, { tone: WaveBadgeTone; label: string; title: string }> = {
  "红波": { tone: "red", label: "红", title: "红波" },
  "蓝波": { tone: "blue", label: "蓝", title: "蓝波" },
  "绿波": { tone: "green", label: "绿", title: "绿波" },
};

export function parseWaveList(text?: string | null): string[] {
  if (!text) return [];
  try {
    const value = JSON.parse(text);
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

export function waveTitle(wave?: string | null): string {
  if (!wave) return "未知波色";
  return WAVE_META[wave]?.title ?? wave;
}

export function WaveBadge({ wave, size = "md" }: { wave?: string | null; size?: "sm" | "md" }) {
  const meta = WAVE_META[wave ?? ""] ?? {
    tone: "green" as const,
    label: wave?.slice(0, 1) || "-",
    title: waveTitle(wave),
  };

  return (
    <span className={`wave-badge wave-badge-${meta.tone} ${size === "sm" ? "small" : ""}`} title={meta.title} aria-label={meta.title}>
      {meta.label}
    </span>
  );
}

export function WaveBadgeGroup({ waves, size = "md" }: { waves: string[]; size?: "sm" | "md" }) {
  return (
    <span className="wave-badge-group">
      {waves.map((wave) => (
        <WaveBadge key={wave} wave={wave} size={size} />
      ))}
    </span>
  );
}
