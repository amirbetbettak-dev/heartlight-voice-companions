// Browser-side reads/writes for the signed-in user's companion data (RLS-scoped).
import { queryOptions } from "@tanstack/react-query";
import type { UIMessage } from "ai";

import { supabase } from "@/integrations/supabase/client";
import { DEFAULT_PERSONA_ID, getPersona, isPersonaId, type PersonaId } from "@/lib/personas";

export type ChatMessage = UIMessage<{ source: "text" | "voice"; personaId: string }>;

type Row = { id: string; role: string; content: string; source: string; persona_id: string };

export type ConversationSummary = { id: string; personaId: PersonaId; title: string; updatedAt: string };

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

export const companionQuery = queryOptions({
  queryKey: ["companion"],
  queryFn: async () => {
    const user = await requireUser();
    const settings = await supabase.from("user_settings").select("persona_id").eq("user_id", user.id).maybeSingle();
    const personaId: PersonaId = isPersonaId(settings.data?.persona_id) ? settings.data.persona_id : DEFAULT_PERSONA_ID;
    const meta = user.user_metadata ?? {};
    return {
      userId: user.id,
      email: user.email ?? "",
      phone: user.phone ?? "",
      isAnonymous: Boolean(user.is_anonymous),
      name: (meta["full_name"] as string | undefined) ?? (meta["name"] as string | undefined) ?? "",
      personaId,
    };
  },
  staleTime: Infinity,
});

export async function fetchMessages(conversationId: string, limit = 150): Promise<ChatMessage[]> {
  const { data, error } = await supabase
    .from("messages")
    .select("id, role, content, source, persona_id")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []).reverse().map(rowToMessage);
}

export function conversationQuery(conversationId: string) {
  return queryOptions({
    queryKey: ["conversation", conversationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("conversations")
        .select("id, persona_id")
        .eq("id", conversationId)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      return { id: data.id, personaId: getPersona(data.persona_id).id, messages: await fetchMessages(conversationId) };
    },
    staleTime: 30_000,
  });
}

export const conversationsQuery = queryOptions({
  queryKey: ["conversations"],
  queryFn: async (): Promise<ConversationSummary[]> => {
    const { data, error } = await supabase
      .from("conversations")
      .select("id, persona_id, title, updated_at")
      .order("updated_at", { ascending: false })
      .limit(200);
    if (error) throw error;
    return (data ?? []).map((row) => ({
      id: row.id,
      personaId: getPersona(row.persona_id).id,
      title: row.title,
      updatedAt: row.updated_at,
    }));
  },
});

export async function createConversation(personaId: PersonaId) {
  const user = await requireUser();
  const { data, error } = await supabase
    .from("conversations")
    .insert({ user_id: user.id, persona_id: personaId })
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

/** The persona's most recent conversation, or a fresh one when it has none yet. */
export async function resolveConversation(personaId: PersonaId) {
  const { data, error } = await supabase
    .from("conversations")
    .select("id")
    .eq("persona_id", personaId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data?.id ?? createConversation(personaId);
}

export async function deleteConversation(conversationId: string) {
  const { error } = await supabase.from("conversations").delete().eq("id", conversationId);
  if (error) throw error;
}

export async function clearAllConversations() {
  const user = await requireUser();
  const { error } = await supabase.from("conversations").delete().eq("user_id", user.id);
  if (error) throw error;
}

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
