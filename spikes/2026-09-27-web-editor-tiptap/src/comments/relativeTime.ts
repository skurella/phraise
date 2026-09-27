// Brief 06 (comments, gate F), task 4: "messages with author and relative
// time". Pure so it's unit-testable without a DOM.
export function formatRelativeTime(atMs: number, nowMs: number): string {
  const deltaS = Math.round((nowMs - atMs) / 1000);
  if (deltaS < 45) return 'just now';
  const deltaM = Math.round(deltaS / 60);
  if (deltaM < 60) return `${deltaM}m ago`;
  const deltaH = Math.round(deltaM / 60);
  if (deltaH < 24) return `${deltaH}h ago`;
  const deltaD = Math.round(deltaH / 24);
  if (deltaD < 30) return `${deltaD}d ago`;
  return new Date(atMs).toISOString().slice(0, 10);
}
