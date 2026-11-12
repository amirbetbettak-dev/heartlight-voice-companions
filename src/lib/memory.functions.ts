import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const refreshMemoryFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ force: z.boolean().optional() }).parse(input ?? {}))
  .handler(async ({ data, context }) => {
    const { refreshMemory } = await import("@/lib/companion.server");
    try {
      return await refreshMemory(context.supabase as never, context.userId, { force: data.force });
    } catch (error) {
      console.error("Memory refresh failed", error);
      return { updated: false };
    }
  });
