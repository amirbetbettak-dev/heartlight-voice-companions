import { createFileRoute } from "@tanstack/react-router";
import { streamText } from "ai";
import { z } from "zod";

import {
  CHAT_MODEL,
  createGatewayProvider,
  gatewayKey,
  loadCompanionContext,
  reasoningOptions,
  textInstructions,
  toModelMessages,
} from "@/lib/companion.server";
import { getPersona, isPersonaId } from "@/lib/personas";
import { createLovableAiGatewayRunIdFetch, withLovableAiGatewayRunIdHeader } from "@/lib/run-id.server";
import { bearerToken, getUserClient, UnauthorizedError } from "@/lib/supabase-user.server";

const bodySchema = z.object({
  text: z.string().trim().min(1).max(4000),
  personaId: z.string().refine(isPersonaId),
});

function jsonError(status: number, message: string) {
  return Response.json({ error: message }, { status });
}

async function handleChat(request: Request) {
  let auth;
  try {
    auth = await getUserClient(bearerToken(request));
  } catch (error) {
    if (error instanceof UnauthorizedError) return jsonError(401, "لطفاً دوباره وارد شوید.");
    throw error;
  }
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError(400, "پیام نامعتبر است.");
  const { supabase, userId } = auth;
  const persona = getPersona(parsed.data.personaId);

  const context = await loadCompanionContext(supabase, userId);
  const userInsert = await supabase
    .from("messages")
    .insert({ user_id: userId, role: "user", content: parsed.data.text, persona_id: persona.id, source: "text" });
  if (userInsert.error) {
    console.error("Saving user message failed", userInsert.error);
    return jsonError(500, "ذخیره‌ی پیام ممکن نشد. دوباره تلاش کنید.");
  }

  const runIdFetch = createLovableAiGatewayRunIdFetch();
  const result = streamText({
    model: createGatewayProvider(gatewayKey(), runIdFetch.fetch).responses(CHAT_MODEL),
    instructions: textInstructions(persona, context.memory),
    messages: [...toModelMessages(context.history), { role: "user", content: parsed.data.text }],
    abortSignal: request.signal,
    providerOptions: reasoningOptions,
  });

  return withLovableAiGatewayRunIdHeader(
    result.toUIMessageStreamResponse({
      sendReasoning: false,
      onError: (error) => {
        console.error("Chat stream failed", error);
        const status = (error as { statusCode?: number })?.statusCode;
        if (status === 402) return "اعتبار هوش مصنوعی تمام شده است.";
        if (status === 429) return "الان شلوغ است؛ چند لحظه بعد دوباره امتحان کنید.";
        return "پاسخ کامل نشد. دوباره امتحان کنید.";
      },
      onFinish: async ({ responseMessage }) => {
        const text = responseMessage.parts
          .map((part) => (part.type === "text" ? part.text : ""))
          .join("")
          .trim();
        if (!text) return;
        const saved = await supabase
          .from("messages")
          .insert({ user_id: userId, role: "assistant", content: text, persona_id: persona.id, source: "text" });
        if (saved.error) console.error("Saving assistant message failed", saved.error);
      },
    }),
    runIdFetch,
  );
}

export const Route = createFileRoute("/api/chat")({
  server: { handlers: { POST: ({ request }) => handleChat(request) } },
});
