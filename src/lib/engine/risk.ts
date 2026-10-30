// The 5-factor risk score (0-100). Every point is explained, so a ranking never needs trusting blindly.
import { inr } from "../records";

export type Factor = { key: string; label: string; points: number; max: number; detail: string };

export type RiskInput = {
  daysToDeadline: number;
  unitsShort: number;
  unitsNeeded: number;
  tier: string;
  priority: string;
  exposureInr: number;
  reliabilityPct: number | null;
};

const PRIORITY_POINTS: Record<string, number> = { Critical: 7, High: 5, Normal: 2, Low: 0 };

export function riskLevel(score: number): string {
  return score >= 70 ? "Critical" : score >= 50 ? "High" : score >= 30 ? "Medium" : "Low";
}

export function scoreRisk(i: RiskInput): { score: number; level: string; factors: Factor[] } {
  const d = i.daysToDeadline;
  const slack = d <= 0 ? 30 : d === 1 ? 26 : d === 2 ? 22 : d === 3 ? 18 : d <= 5 ? 12 : d <= 8 ? 7 : 3;
  const ratio = i.unitsNeeded > 0 ? Math.min(1, i.unitsShort / i.unitsNeeded) : 0;
  const shortage = Math.round(ratio * 25);
  const customer = (i.tier === "Premium" ? 8 : 3) + (PRIORITY_POINTS[i.priority] ?? 0);
  const penalty = Math.round(20 * Math.min(1, i.exposureInr / 200_000));
  const supplier =
    i.reliabilityPct == null ? 5 : Math.min(10, Math.max(0, Math.round((100 - i.reliabilityPct) / 4)));

  const factors: Factor[] = [
    { key: "slack", label: "Days of slack", points: slack, max: 30, detail: d <= 0 ? "Due today" : `Due in ${d} day${d === 1 ? "" : "s"}` },
    { key: "shortage", label: "Size of shortage", points: shortage, max: 25, detail: `${i.unitsShort} of ${i.unitsNeeded} units short (${Math.round(ratio * 100)}%)` },
    { key: "customer", label: "Customer tier", points: customer, max: 15, detail: `${i.tier} customer, ${i.priority} priority order` },
    { key: "penalty", label: "Penalty exposure", points: penalty, max: 20, detail: `${inr(i.exposureInr)} penalty if late` },
    { key: "supplier", label: "Supplier reliability", points: supplier, max: 10, detail: i.reliabilityPct == null ? "Unknown supplier record" : `${i.reliabilityPct}% on-time record` },
  ];
  const score = factors.reduce((n, f) => n + f.points, 0);
  return { score, level: riskLevel(score), factors };
}
