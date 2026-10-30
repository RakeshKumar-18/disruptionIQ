import { requirePermission } from "@/lib/auth";
import { route } from "@/lib/http";
import { overview } from "@/lib/views";

export const GET = route(async () => {
  await requirePermission("view_network");
  return overview();
});
