// The five roles: what each one does, what it can do, and what it sees.
// Used by the server (permission checks) and by the UI (role instructions). Change roles here only.

export type Permission =
  | "view_network" // network map, disruptions and affected orders
  | "recommend" // ask the rules engine for recovery options
  | "submit" // send a recovery plan for approval
  | "review_stock" // approve plans that move stock
  | "review_spend" // approve plans that spend money
  | "execute" // carry out approved plans
  | "stock" // look up stock levels
  | "simulate" // send carrier events, reset the demo
  | "import" // import CSV/JSON data
  | "admin"; // event log, audit trail, users

export type RoleName =
  | "Operations Analyst"
  | "Supply Chain Manager"
  | "Procurement Approver"
  | "Warehouse Operator"
  | "Administrator";

export type RoleInfo = {
  name: RoleName;
  oneLine: string;
  steps: string[];
  cannot: string;
  permissions: Permission[];
};

export const ROLES: Record<RoleName, RoleInfo> = {
  "Operations Analyst": {
    name: "Operations Analyst",
    oneLine: "Finds out which customer orders a disruption puts at risk, and proposes how to recover each one.",
    steps: [
      "Open an active disruption from the list.",
      "Check the at-risk orders. The riskiest are at the top, and each score shows its reasons.",
      "For each order, pick a recovery option the rules engine has checked against real stock, and send it for approval.",
      "Track your plans under “My plans”. If an approver proposes a change, accept or withdraw it.",
    ],
    cannot: "You can’t approve or carry out plans, including your own.",
    permissions: ["view_network", "recommend", "submit"],
  },
  "Supply Chain Manager": {
    name: "Supply Chain Manager",
    oneLine: "Approves recovery plans that move stock: reallocating stock between warehouses and splitting orders.",
    steps: [
      "Open a plan waiting for you. You’ll see the order, its risk, the cost and a live stock check.",
      "Approve it, reject it with a reason, or propose a different stock option.",
      "If you propose a change, the analyst who requested the plan must accept it before it goes ahead.",
    ],
    cannot: "You can’t review a plan you requested, and spending plans go to the Procurement Approver.",
    permissions: ["review_stock"],
  },
  "Procurement Approver": {
    name: "Procurement Approver",
    oneLine: "Approves recovery plans that spend money: expediting shipments and buying from an alternative supplier.",
    steps: [
      "Open a plan waiting for you. You’ll see the order, its risk, the extra cost and the supplier.",
      "Approve it, reject it with a reason, or propose a different spending option.",
      "If you propose a change, the analyst who requested the plan must accept it before it goes ahead.",
    ],
    cannot: "You can’t review a plan you requested, and stock plans go to the Supply Chain Manager.",
    permissions: ["review_spend"],
  },
  "Warehouse Operator": {
    name: "Warehouse Operator",
    oneLine: "Carries out approved plans after the system rechecks that the stock is still there.",
    steps: [
      "Open an approved plan. The system rechecks stock and shipment status right now.",
      "If the check passes, press “Execute”. This is a simulation: stock moves in this app only.",
      "If the check fails, the plan is blocked and goes back to the analyst with the reason.",
    ],
    cannot: "You can’t create or approve plans.",
    permissions: ["execute", "stock"],
  },
  Administrator: {
    name: "Administrator",
    oneLine: "Full access: can use every screen and do every job, and also runs the system (simulator, logs, import, demo reset).",
    steps: [
      "Use the Simulator to send a carrier event, exactly as a real carrier would. The rules engine reacts to it.",
      "Step in for any role when needed: send plans, approve stock or spending plans, or execute approved plans.",
      "Check the Event log and Audit trail to see every event and every decision.",
      "Import CSV/JSON data, or reset the demo to its starting state.",
    ],
    cannot: "Even with full access, you can’t approve a plan you sent yourself. Separation of duties still applies.",
    permissions: ["view_network", "recommend", "submit", "review_stock", "review_spend", "execute", "stock", "simulate", "import", "admin"],
  },
};

export const ROLE_ORDER: RoleName[] = [
  "Operations Analyst",
  "Supply Chain Manager",
  "Procurement Approver",
  "Warehouse Operator",
  "Administrator",
];

export const PERMISSION_TEXT: Record<Permission, string> = {
  view_network: "view the network and disruptions",
  recommend: "generate recovery options",
  submit: "submit recovery plans",
  review_stock: "approve stock plans",
  review_spend: "approve spending plans",
  execute: "execute plans",
  stock: "look up stock",
  simulate: "use the simulator",
  import: "import data",
  admin: "view the logs and users",
};

export function permissionsFor(role: string): Permission[] {
  return (ROLES as Record<string, RoleInfo>)[role]?.permissions ?? [];
}

export function can(role: string, permission: Permission): boolean {
  return permissionsFor(role).includes(permission);
}

// Which role must approve each kind of plan.
export const PLAN_KINDS = ["Reallocate stock", "Split order", "Expedite shipment", "Alternative supplier"] as const;
export type PlanKind = (typeof PLAN_KINDS)[number];

export const APPROVER_FOR: Record<PlanKind, RoleName> = {
  "Reallocate stock": "Supply Chain Manager",
  "Split order": "Supply Chain Manager",
  "Expedite shipment": "Procurement Approver",
  "Alternative supplier": "Procurement Approver",
};

// The approver queues a role works on (the Administrator covers both).
export function reviewRolesFor(role: string): RoleName[] {
  const out: RoleName[] = [];
  if (can(role, "review_stock")) out.push("Supply Chain Manager");
  if (can(role, "review_spend")) out.push("Procurement Approver");
  return out;
}
