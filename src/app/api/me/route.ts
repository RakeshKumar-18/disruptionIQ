import { currentUser } from "@/lib/auth";
import { route } from "@/lib/http";

export const GET = route(async () => ({ user: await currentUser() }));
