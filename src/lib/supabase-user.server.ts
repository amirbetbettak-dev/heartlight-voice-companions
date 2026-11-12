// Server-only: a Supabase client that acts as the signed-in user (RLS applies).
// Used by the streaming chat route and the voice relay, which sit outside server-function middleware.
import { createClient } from "@supabase/supabase-js";
import process from "node:process";

import type { Database } from "@/integrations/supabase/types";

export class UnauthorizedError extends Error {}

function supabaseFetch(key: string): typeof fetch {
  return (input, init) => {
    const headers = new Headers(typeof Request !== "undefined" && input instanceof Request ? input.headers : undefined);
    if (init?.headers) new Headers(init.headers).forEach((value, name) => headers.set(name, value));
    if ((key.startsWith("sb_publishable_") || key.startsWith("sb_secret_")) && headers.get("Authorization") === `Bearer ${key}`) {
      headers.delete("Authorization");
    }
    headers.set("apikey", key);
    return fetch(input, { ...init, headers });
  };
}

export async function getUserClient(token: string | null | undefined) {
  const url = process.env["SUPABASE_URL"];
  const key = process.env["SUPABASE_PUBLISHABLE_KEY"];
  if (!url || !key) throw new Error("Backend is not configured");
  if (!token || token.split(".").length !== 3) throw new UnauthorizedError("Sign in required");
  const supabase = createClient<Database>(url, key, {
    global: { fetch: supabaseFetch(key), headers: { Authorization: `Bearer ${token}` } },
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await supabase.auth.getClaims(token);
  const userId = data?.claims?.sub;
  if (error || !userId) throw new UnauthorizedError("Sign in required");
  return { supabase, userId };
}

export type UserClient = Awaited<ReturnType<typeof getUserClient>>["supabase"];

export function bearerToken(request: Request) {
  const header = request.headers.get("authorization") ?? "";
  return header.startsWith("Bearer ") ? header.slice(7) : null;
}
