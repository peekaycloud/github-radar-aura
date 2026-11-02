export function formatNumber(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "—";
  const abs = Math.abs(n);
  const sign = n < 0 ? "−" : "";
  // Match GitHub’s compact star button: 364550 → "365k", 78270 → "78.3k".
  if (abs >= 1_000_000) {
    const m = abs / 1_000_000;
    const text = m >= 10 ? m.toFixed(0) : m.toFixed(1).replace(/\.0$/, "");
    return `${sign}${text}M`;
  }
  if (abs >= 100_000) {
    return `${sign}${Math.round(abs / 1_000)}k`;
  }
  if (abs >= 1_000) {
    const k = abs / 1_000;
    const text = k >= 10 ? k.toFixed(1).replace(/\.0$/, "") : k.toFixed(1);
    return `${sign}${text}k`;
  }
  return `${sign}${Math.round(abs).toLocaleString()}`;
}

export function formatDelta(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n) || n === 0) return "0";
  const sign = n > 0 ? "+" : "−";
  return `${sign}${formatNumber(Math.abs(n))}`;
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function formatDateShort(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d
    .toLocaleDateString("en-US", { month: "short", day: "numeric" })
    .toUpperCase();
}
