function fieldMatches(field: string, value: number): boolean {
  if (field === "*") return true;
  return field.split(",").some((part) => {
    if (part.includes("/")) {
      const [range, stepStr] = part.split("/");
      const step = Number(stepStr);
      const [start, end] = range === "*" ? [0, Infinity] : range.split("-").map(Number);
      return value >= start && (end === undefined || value <= end) && (value - start) % step === 0;
    }
    if (part.includes("-")) {
      const [start, end] = part.split("-").map(Number);
      return value >= start && value <= end;
    }
    return Number(part) === value;
  });
}

/** Standard 5-field cron: minute hour day-of-month month day-of-week. */
export default function cronMatches(expr: string | undefined, date: Date): boolean {
  if (!expr) return false;
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return false;
  const [min, hour, dom, month, dow] = parts;
  return (
    fieldMatches(min, date.getUTCMinutes()) &&
    fieldMatches(hour, date.getUTCHours()) &&
    fieldMatches(dom, date.getUTCDate()) &&
    fieldMatches(month, date.getUTCMonth() + 1) &&
    fieldMatches(dow, date.getUTCDay())
  );
}
