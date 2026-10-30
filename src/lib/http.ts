import { Prisma } from "@prisma/client";
import { ZodError } from "zod";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

// Wraps a route so thrown errors become JSON { error } responses with the right status code.
export function route<C = unknown>(fn: (req: Request, ctx: C) => Promise<unknown>) {
  return async (req: Request, ctx: C) => {
    try {
      return Response.json(await fn(req, ctx));
    } catch (e) {
      if (e instanceof ApiError) return Response.json({ error: e.message }, { status: e.status });
      if (e instanceof ZodError) {
        const msg = e.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; ");
        return Response.json({ error: `Invalid request. ${msg}` }, { status: 400 });
      }
      console.error(e);
      return Response.json({ error: "Something went wrong on the server." }, { status: 500 });
    }
  };
}

export async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw new ApiError(400, "Request body must be valid JSON.");
  }
}

export const isUniqueViolation = (e: unknown) =>
  e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";
