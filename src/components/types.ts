// Shapes of the API responses the UI uses.
import type { Permission, PlanKind, RoleName } from "@/lib/roles";

export type User = { id: string; name: string; role: RoleName };
export type Me = { user: User | null; permissions?: Permission[]; badges?: Badges };
export type Badges = Partial<Record<"disruptions" | "myPlans" | "review" | "execute", number>>;

export type Factor = { key: string; label: string; points: number; max: number; detail: string };
export type Line = { productId: string; productName: string; needed: number; short: number; unitPrice: number };

export type DisruptionSummary = {
  id: string; type: string; typeLabel: string; title: string; description: string; severity: string; status: string;
  createdAt: string; location: string | null; shipmentId: string | null;
  supplier: { id: string; name: string; city: string } | null;
  warehouse: { id: string; name: string; city: string } | null;
  atRisk: number; approved: number; recovered: number; exposureInr: number; destinationCities: string[];
};

export type SignalLevel = "Critical" | "High" | "Medium" | "Recovering" | "Normal";

export type MapLocation = {
  city: string; state: string;
  warehouses: { id: string; name: string; status: string; onHand: number; free: number }[];
  suppliers: number; suppliersDown: number;
  stock: { onHand: number; free: number };
  inbound: { open: number; delayed: number };
  orders: { atRisk: number; approved: number; recovered: number };
  units: { atRisk: number; approved: number; recovered: number };
  exposureInr: number; disruptions: string[];
  signal: { level: SignalLevel; reason: string };
};

export type MapData = {
  summary: { cities: number; states: number; warehouses: number; suppliers: number };
  locations: MapLocation[];
  routes: { disruptionId: string; from: string; to: string; severity: string; label: string }[];
};

export type Overview = {
  kpis: {
    activeDisruptions: number; ordersAtRisk: number; unitsAtRisk: number; exposureInr: number;
    plansAwaitingApproval: number; ordersApproved: number; ordersRecovered: number;
  };
  map: MapData;
  disruptions: DisruptionSummary[];
};

export type AffectedOrder = {
  orderId: string; customerId: string; tier: string; priority: string; deadline: string; warehouse: string; deliveryCity: string;
  lines: Line[]; unitsShort: number; daysLate: number; exposureInr: number; riskScore: number; riskLevel: string;
  factors: Factor[]; status: string; plan: { id: string; kind: string; status: string } | null; canPlan: boolean;
};

export type DisruptionDetail = {
  id: string; type: string; typeLabel: string; title: string; description: string; severity: string; status: string;
  createdAt: string; location: string | null; delayDays: number;
  shipment: {
    id: string; carrier: string; status: string; eta: string | null;
    supplier: { id: string; name: string; city: string; reliabilityPct: number };
    warehouse: { id: string; name: string; city: string };
  } | null;
  orders: AffectedOrder[];
};

export type RecoveryOption = {
  kind: PlanKind; approverRole: RoleName; feasible: boolean; reason?: string; summary: string;
  details: Record<string, unknown>; costInr: number; readyBy: string | null; saves: "Fully" | "Partly";
};

export type PlanView = {
  id: string; kind: PlanKind; approverRole: RoleName; summary: string; details: Record<string, unknown>; costInr: number;
  note: string | null; status: string; proposed: RecoveryOption | null;
  createdBy: string; createdById: string; reviewedBy: string | null; executedBy: string | null;
  createdAt: string; reviewedAt: string | null; executedAt: string | null;
  disruption: { id: string; title: string; severity: string };
  order: { id: string; priority: string; deadline: string; deliveryCity: string; customerId: string; tier: string; warehouse: string };
  risk: { score: number; level: string; factors: Factor[]; exposureInr: number; unitsShort: number; lines: Line[]; status: string } | null;
  liveCheck: string | null;
};

export type Notification = { id: number; at: string; message: string; severity: string };
export type LogRow = { id: number; at: string; actor: string; action: string; entity: string; detail: string };
export type Paged<T> = { total: number; page: number; pages: number; rows: T[] };
