export function formatMs(value: number): string {
  return `${value.toFixed(2)}ms`;
}

export function formatPct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}
