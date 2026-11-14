import { createFileRoute } from "@tanstack/react-router";
import { streamText } from "ai";
import { z } from "zod";

import { AiConfigError, chatModel, describeAiError, type ChatProviderConfig } from "@/lib/ai-provider.server";
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

const CHAT_FIRST_CHUNK_TIMEOUT_MS = 90_000;
const CHAT_CHUNK_TIMEOUT_MS = 45_000;

function jsonError(status: number, message: string) {
  return Response.json({ error: message }, { status });
}

async function handleChat(request: Request) {
  console.log('[chatdbg] start');
  let auth;
  try {
    auth = await getUserClient(bearerToken(request));
  } catch (error) {
    if (error instanceof UnauthorizedError) return jsonError(401, "لطفاً دوباره وارد شوید.");
    throw error;
  }
  console.log('[chatdbg] auth ok');
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError(400, "پیام نامعتبر است.");
  const { supabase, userId } = auth;
  const { conversationId } = parsed.data;

  // Resolve the AI service before saving anything, so a missing key fails fast with a clear message.
  let provider: ChatProviderConfig;
  try {
    provider = textProvider();
  } catch (error) {
    if (error instanceof AiConfigError) return jsonError(503, error.message);
    throw error;
  }

  console.log('[chatdbg] provider', provider.kind);
  let context;
  try {
    context = await loadCompanionContext(supabase, userId, conversationId);
  } catch (error) {
    if (error instanceof ConversationNotFoundError) return jsonError(404, "این گفت‌وگو پیدا نشد.");
    throw error;
  }
  console.log('[chatdbg] context ok');
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

  console.log('[chatdbg] user saved');
  const runIdFetch = createLovableAiGatewayRunIdFetch();
  const { model, providerOptions } = chatModel(provider, provider.kind === "lovable" ? runIdFetch.fetch : undefined);
  const result = streamText({
    model,
    instructions: textInstructions(persona, context.memory),
    messages: [...toModelMessages(context.history), { role: "user", content: parsed.data.text }],
    abortSignal: request.signal,
    // Inactivity limits, not a total deadline: give up only when the service goes silent.
    timeout: { firstChunkMs: CHAT_FIRST_CHUNK_TIMEOUT_MS, chunkMs: CHAT_CHUNK_TIMEOUT_MS },
    maxRetries: 1,
    providerOptions,
  });

  return withLovableAiGatewayRunIdHeader(
    result.toUIMessageStreamResponse({
      sendReasoning: false,
      onError: (error) => {
        console.error("Chat stream failed", provider.kind, error);
        return describeAiError(error, provider.kind);
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
