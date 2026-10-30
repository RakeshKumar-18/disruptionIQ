export const PLAN_KINDS = ["Reallocate stock", "Expedite", "Alternative supplier", "Split order"] as const;
export type PlanKind = (typeof PLAN_KINDS)[number];
