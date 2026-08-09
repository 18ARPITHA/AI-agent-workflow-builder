export default function QuotaIndicator({
  used,
  allowed,
  resetAt,
}: {
  used: number;
  allowed: number;
  resetAt: string;
}) {
  const pct = Math.min(100, Math.round((used / Math.max(allowed, 1)) * 100));
  const color = pct > 90 ? "#ef4444" : pct > 70 ? "#f59e0b" : "#3b82f6";
  return (
    <div className="card" style={{ minWidth: 220 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 6 }}>
        <span>Usage this period</span>
        <span>
          {used} / {allowed}
        </span>
      </div>
      <div style={{ background: "#0b0d12", borderRadius: 6, height: 8, overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, background: color, height: "100%" }} />
      </div>
      <div style={{ fontSize: 11, opacity: 0.6, marginTop: 6 }}>
        Resets {new Date(resetAt).toLocaleDateString()}
      </div>
    </div>
  );
}
