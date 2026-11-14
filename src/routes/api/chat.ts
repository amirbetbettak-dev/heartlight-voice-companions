import { createFileRoute } from "@tanstack/react-router";
import { streamText } from "ai";
import { z } from "zod";

import { chatModel } from "@/lib/ai-provider.server";
import {
  ConversationNotFoundError,
  loadCompanionContext,
  textInstructions,
  textProvider,
  toModelMessages,
} from "@/lib/companion.server";
import { createLovableAiGatewayRunIdFetch, withLovableAiGatewayRunIdHeader } from "@/lib/run-id.server";
import { bearerToken, getUserClient, UnauthorizedError } from "@/lib/supabase-user.server";

const bodySchema = z.object({
  text: z.string().trim().min(1).max(4000),
  conversationId: z.string().uuid(),
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
  const { conversationId } = parsed.data;

  let context;
  try {
    context = await loadCompanionContext(supabase, userId, conversationId);
  } catch (error) {
    if (error instanceof ConversationNotFoundError) return jsonError(404, "این گفت‌وگو پیدا نشد.");
    throw error;
  }
  const persona = context.persona;
  const userInsert = await supabase.from("messages").insert({
    user_id: userId,
    conversation_id: conversationId,
    role: "user",
    content: parsed.data.text,
    persona_id: persona.id,
    source: "text",
  });
  if (userInsert.error) {
    console.error("Saving user message failed", userInsert.error);
    return jsonError(500, "ذخیره‌ی پیام ممکن نشد. دوباره تلاش کنید.");
  }

  const provider = textProvider();
  const runIdFetch = createLovableAiGatewayRunIdFetch();
  const { model, providerOptions } = chatModel(provider, provider.kind === "lovable" ? runIdFetch.fetch : undefined);
  const result = streamText({
    model,
    instructions: textInstructions(persona, context.memory),
    messages: [...toModelMessages(context.history), { role: "user", content: parsed.data.text }],
    abortSignal: request.signal,
    providerOptions,
  });

  return withLovableAiGatewayRunIdHeader(
    result.toUIMessageStreamResponse({
      sendReasoning: false,
      onError: (error) => {
        console.error("Chat stream failed", error);
        const status = (error as { statusCode?: number })?.statusCode;
        if (status === 401 || status === 403) return "کلید هوش مصنوعی نامعتبر است.";
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
          .insert({
            user_id: userId,
            conversation_id: conversationId,
            role: "assistant",
            content: text,
            persona_id: persona.id,
            source: "text",
          });
        if (saved.error) console.error("Saving assistant message failed", saved.error);
      },
    }),
    runIdFetch,
  );
}

export const Route = createFileRoute("/api/chat")({
  server: { handlers: { POST: ({ request }) => handleChat(request) } },
});
