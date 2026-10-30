import { currentUser } from "@/lib/auth";
import { route } from "@/lib/http";
import { permissionsFor } from "@/lib/roles";
import { badges } from "@/lib/views";

export const GET = route(async () => {
  const user = await currentUser();
  if (!user) return { user: null };
  return { user, permissions: permissionsFor(user.role), badges: await badges(user) };
});
