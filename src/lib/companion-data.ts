// Browser-side reads/writes for the signed-in user's companion data (RLS-scoped).
import { queryOptions } from "@tanstack/react-query";
import type { UIMessage } from "ai";

import { supabase } from "@/integrations/supabase/client";
import { DEFAULT_PERSONA_ID, isPersonaId, type PersonaId } from "@/lib/personas";

export type ChatMessage = UIMessage<{ source: "text" | "voice"; personaId: string }>;

type Row = { id: string; role: string; content: string; source: string; persona_id: string };

export function rowToMessage(row: Row): ChatMessage {
  return {
    id: row.id,
    role: row.role === "assistant" ? "assistant" : "user",
    parts: [{ type: "text", text: row.content }],
    metadata: { source: row.source === "voice" ? "voice" : "text", personaId: row.persona_id },
  };
}

async function requireUser() {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) throw new Error("Sign in required");
  return data.user;
}

export async function fetchMessages(limit = 120): Promise<ChatMessage[]> {
  const user = await requireUser();
  const { data, error } = await supabase
    .from("messages")
    .select("id, role, content, source, persona_id")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []).reverse().map(rowToMessage);
}

export const companionQuery = queryOptions({
  queryKey: ["companion"],
  queryFn: async () => {
    const user = await requireUser();
    const [settings, messages] = await Promise.all([
      supabase.from("user_settings").select("persona_id").eq("user_id", user.id).maybeSingle(),
      fetchMessages(),
    ]);
    const personaId: PersonaId = isPersonaId(settings.data?.persona_id) ? settings.data.persona_id : DEFAULT_PERSONA_ID;
    return {
      userId: user.id,
      email: user.email ?? "",
      name: (user.user_metadata?.["full_name"] as string | undefined) ?? (user.user_metadata?.["name"] as string | undefined) ?? "",
      avatarUrl: (user.user_metadata?.["avatar_url"] as string | undefined) ?? "",
      personaId,
      messages,
    };
  },
  staleTime: Infinity,
});

export const memoryQuery = queryOptions({
  queryKey: ["memory"],
  queryFn: async () => {
    const user = await requireUser();
    const { data, error } = await supabase.from("user_memory").select("summary, updated_at").eq("user_id", user.id).maybeSingle();
    if (error) throw error;
    return { summary: data?.summary ?? "", updatedAt: data?.updated_at ?? null };
  },
});

export async function savePersona(personaId: PersonaId) {
  const user = await requireUser();
  const { error } = await supabase
    .from("user_settings")
    .upsert({ user_id: user.id, persona_id: personaId, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
  if (error) throw error;
}

export async function clearMemory() {
  const user = await requireUser();
  const { error } = await supabase.from("user_memory").delete().eq("user_id", user.id);
  if (error) throw error;
}

export async function clearConversation() {
  const user = await requireUser();
  const { error } = await supabase.from("messages").delete().eq("user_id", user.id);
  if (error) throw error;
}
