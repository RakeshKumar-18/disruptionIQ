// Role permissions. This is the single source of truth: every API route checks it on the server.
export const ROLES = [
  "Operations Analyst",
  "Supply Chain Manager",
  "Warehouse Operator",
  "Procurement Approver",
  "Administrator",
] as const;
export type Role = (typeof ROLES)[number];

export type Permission = "view" | "import" | "recommend" | "submit" | "approve" | "modify" | "execute" | "admin";

export const PERMISSIONS: Record<Role, Permission[]> = {
  "Operations Analyst": ["view", "import", "recommend", "submit"],
  "Supply Chain Manager": ["view", "approve", "modify"],
  "Warehouse Operator": ["view", "execute"],
  "Procurement Approver": ["view", "approve", "modify"],
  Administrator: ["view", "import", "recommend", "submit", "approve", "modify", "execute", "admin"],
};

export function permissionsFor(role: string): Permission[] {
  return (PERMISSIONS as Record<string, Permission[]>)[role] ?? [];
}

export function can(role: string, permission: Permission): boolean {
  return permissionsFor(role).includes(permission);
}
