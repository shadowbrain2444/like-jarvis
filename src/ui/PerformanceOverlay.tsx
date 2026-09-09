/** Dev-mode latency overlay (spec section 5: "Development mode should display latency metrics"). */

import { useEffect, useState } from "react";
import { latencyMonitor, type MetricSnapshot } from "../performance/latencyMonitor";

export function PerformanceOverlay() {
  const [snapshot, setSnapshot] = useState<MetricSnapshot[]>([]);

  useEffect(() => {
    const interval = setInterval(() => setSnapshot(latencyMonitor.getSnapshot()), 500);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="veyra-perf-overlay">
      <div className="veyra-perf-overlay__title">Latency</div>
      {snapshot.length === 0 && <div>no samples yet</div>}
      {snapshot.map((m) => (
        <div className="veyra-perf-overlay__row" key={m.metric}>
          <span>{m.metric}</span>
          <span>
            {m.latestMs.toFixed(0)}ms (avg {m.averageMs.toFixed(0)})
          </span>
        </div>
      ))}
    </div>
  );
}
