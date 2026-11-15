import { createFileRoute } from "@tanstack/react-router";
import { createUIMessageStreamResponse, streamText, type UIMessageChunk } from "ai";
import { z } from "zod";

import {
  AiConfigError,
  chatModel,
  describeAiError,
  type ChatProviderConfig,
} from "@/lib/ai-provider.server";
import {
  ConversationNotFoundError,
  loadCompanionContext,
  textInstructions,
  textProvider,
  toModelMessages,
} from "@/lib/companion.server";
import {
  createLovableAiGatewayRunIdFetch,
  withLovableAiGatewayRunIdHeader,
} from "@/lib/run-id.server";
import { bearerToken, getUserClient, UnauthorizedError } from "@/lib/supabase-user.server";

const bodySchema = z.object({
  text: z.string().trim().min(1).max(4000),
  conversationId: z.string().uuid(),
  source: z.enum(["text", "voice"]).optional(),
});

const EMPTY_REPLY_ERROR = "پاسخی نیامد. دوباره امتحان کنید.";

const CHAT_FIRST_CHUNK_TIMEOUT_MS = 90_000;
const CHAT_CHUNK_TIMEOUT_MS = 45_000;

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
  const source = parsed.data.source ?? "text";

  // Resolve the AI service before saving anything, so a missing key fails fast with a clear message.
  let provider: ChatProviderConfig;
  try {
    provider = textProvider();
  } catch (error) {
    if (error instanceof AiConfigError) return jsonError(503, error.message);
    throw error;
  }

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
    source,
  });
  if (userInsert.error) {
    console.error("Saving user message failed", userInsert.error);
    return jsonError(500, "ذخیره‌ی پیام ممکن نشد. دوباره تلاش کنید.");
  }

  const runIdFetch = createLovableAiGatewayRunIdFetch();
  const { model, providerOptions } = chatModel(
    provider,
    provider.kind === "lovable" ? runIdFetch.fetch : undefined,
  );
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

  let replyText = "";
  let finished = false;
  let failed = false;
  let saved = false;
  const saveReply = async () => {
    const text = replyText.trim();
    if (saved || !text) return;
    saved = true;
    const insert = await supabase.from("messages").insert({
      user_id: userId,
      conversation_id: conversationId,
      role: "assistant",
      content: text,
      persona_id: persona.id,
      source,
    });
    if (insert.error) console.error("Saving assistant message failed", insert.error);
  };

  // Once reply text has arrived, a late hiccup from the AI service (a dropped connection or a
  // trailing error event) must not surface as an error: drop it and finish the stream cleanly.
  const safeStream = result
    .toUIMessageStream({
      sendReasoning: false,
      onError: (error) => {
        console.error("Chat stream failed", provider.kind, error);
        return describeAiError(error, provider.kind);
      },
    })
    .pipeThrough(
      new TransformStream<UIMessageChunk, UIMessageChunk>({
        transform(chunk, controller) {
          if (chunk.type === "text-delta") replyText += chunk.delta;
          if (chunk.type === "error") {
            if (replyText.trim()) {
              console.warn("Ignoring AI error after a complete reply", chunk.errorText);
              return;
            }
            failed = true;
          }
          if (chunk.type === "finish") {
            finished = true;
            if (!replyText.trim() && !failed) controller.enqueue({ type: "error", errorText: EMPTY_REPLY_ERROR });
          }
          controller.enqueue(chunk);
        },
        async flush(controller) {
          if (replyText.trim() && !finished) controller.enqueue({ type: "finish", finishReason: "stop" });
          await saveReply();
        },
      }),
    );
  const response = createUIMessageStreamResponse({ stream: safeStream });
  // The run-id header only exists on Lovable AI; waiting for it with another service would hang forever.
  return provider.kind === "lovable"
    ? withLovableAiGatewayRunIdHeader(response, runIdFetch)
    : response;
}

export const Route = createFileRoute("/api/chat")({
  server: { handlers: { POST: ({ request }) => handleChat(request) } },
});
