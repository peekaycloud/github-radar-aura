import type { DiscoveryRow } from "@/lib/db";

export type RadarSignal = {
  label: string;
  value: string;
  tone?: "signal" | "ink" | "muted";
};

export function buildWhyItMatters(repo: DiscoveryRow): RadarSignal[] {
  const signals: RadarSignal[] = [];

  const growth30 = repo.stars_pct_growth_30d ?? repo.stars_pct_growth_7d;
  if (growth30 != null && Number.isFinite(growth30) && growth30 !== 0) {
    const period = repo.stars_pct_growth_30d != null ? "this month" : "this week";
    signals.push({
      label: "Trajectory",
      value: `${growth30 > 0 ? "↑" : "↓"} ${Math.abs(growth30).toFixed(0)}% star growth ${period}`,
      tone: growth30 >= 15 ? "signal" : "ink",
    });
  } else if (repo.stars_gained_7d != null && repo.stars_gained_7d !== 0) {
    signals.push({
      label: "Trajectory",
      value: `${repo.stars_gained_7d > 0 ? "+" : ""}${Math.round(repo.stars_gained_7d).toLocaleString()} ★ / 7d`,
      tone: repo.stars_gained_7d >= 50 ? "signal" : "ink",
    });
  } else if ((repo.stars_gained_30d ?? 0) > 0) {
    signals.push({
      label: "Trajectory",
      value: `+${Math.round(repo.stars_gained_30d!).toLocaleString()} ★ / 30d`,
      tone: "ink",
    });
  }

  const mentions = Number(repo.mention_count ?? 0);
  if (mentions >= 1) {
    signals.push({
      label: "Community",
      value:
        mentions === 1
          ? "1 Telegram mention"
          : `${mentions} Telegram mentions`,
      tone: mentions >= 3 ? "signal" : "ink",
    });
  }

  if (repo.days_to_discovery != null && repo.days_to_discovery >= 0) {
    const days = Math.round(repo.days_to_discovery);
    signals.push({
      label: "Discovery lead",
      value:
        days === 0
          ? "Discovered same day as creation"
          : days <= 14
            ? `Discovered ${days} days after creation`
            : `${days} days after creation`,
      tone: days <= 30 ? "signal" : "muted",
    });
  }

  if (repo.stars_at_discovery != null && repo.stars != null && repo.stars_at_discovery > 0) {
    const multiple = repo.stars / repo.stars_at_discovery;
    if (multiple >= 1.25) {
      signals.push({
        label: "Since discovery",
        value: `${multiple.toFixed(1)}× star growth`,
        tone: "signal",
      });
    } else if (repo.stars_at_discovery < 1000) {
      signals.push({
        label: "At discovery",
        value: `Under 1K stars (${Math.round(repo.stars_at_discovery).toLocaleString()} ★)`,
        tone: "signal",
      });
    }
  }

  if (signals.length === 0 && repo.stars != null) {
    signals.push({
      label: "Scale",
      value: `${Math.round(repo.stars).toLocaleString()} stars on GitHub`,
      tone: "muted",
    });
  }

  if (signals.length === 0) {
    signals.push({
      label: "Signal",
      value: "On the radar",
      tone: "muted",
    });
  }

  return signals.slice(0, 3);
}

export function signalLevel(repo: DiscoveryRow): "High" | "Rising" | "Watch" {
  const growth = repo.stars_pct_growth_7d ?? repo.stars_pct_growth_30d ?? 0;
  const early =
    repo.days_to_discovery != null &&
    repo.days_to_discovery >= 0 &&
    repo.days_to_discovery <= 30;
  if ((growth != null && growth >= 25) || early) return "High";
  if ((growth != null && growth >= 8) || (repo.stars_gained_7d ?? 0) >= 40) return "Rising";
  return "Watch";
}
