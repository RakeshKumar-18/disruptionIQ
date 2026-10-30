import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { db } from "./db";
import { ApiError } from "./http";
import { can, PERMISSION_TEXT, type Permission } from "./roles";

export const SESSION_COOKIE = "diq_session";
const SESSION_HOURS = 12;

export type SessionUser = { id: string; name: string; role: string };

export async function createSession(userId: string): Promise<void> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_HOURS * 3600_000);
  await db.session.create({ data: { token, userId, expiresAt } });
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
}

export async function endSession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await db.session.deleteMany({ where: { token } });
  jar.delete(SESSION_COOKIE);
}

export async function currentUser(): Promise<SessionUser | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const s = await db.session.findUnique({ where: { token }, include: { user: true } });
  if (!s || s.expiresAt < new Date()) return null;
  return { id: s.user.id, name: s.user.name, role: s.user.role };
}

export async function requireUser(): Promise<SessionUser> {
  const u = await currentUser();
  if (!u) throw new ApiError(401, "Sign in to continue.");
  return u;
}

// Throws 401 if nobody is signed in, 403 if the role lacks the permission.
export async function requirePermission(permission: Permission): Promise<SessionUser> {
  const u = await currentUser();
  if (!u) throw new ApiError(401, "Sign in to continue.");
  if (!can(u.role, permission)) throw new ApiError(403, `The ${u.role} role can’t ${PERMISSION_TEXT[permission]}.`);
  return u;
}
