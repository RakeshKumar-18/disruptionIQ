import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

// PINs are stored as "salt:hash" using scrypt, never in plain text.
export function hashPin(pin: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(pin, salt, 32).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPin(pin: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const given = scryptSync(pin, salt, 32);
  const expected = Buffer.from(hash, "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}
