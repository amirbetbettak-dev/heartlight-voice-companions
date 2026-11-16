import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { synthesizeSpeech } from "@/lib/edge-tts.server";
import { PERSONAS, getPersona, type PersonaId } from "@/lib/personas";
import { bearerToken, getUserClient, UnauthorizedError } from "@/lib/supabase-user.server";

const bodySchema = z.object({
  text: z.string().trim().min(1).max(800),
  personaId: z.enum(PERSONAS.map((persona) => persona.id) as [PersonaId, ...PersonaId[]]),
});

function jsonError(status: number, message: string) {
  return Response.json({ error: message }, { status });
}

// Signed-in users only: speaks one sentence in the persona's fixed voice and returns MP3.
async function handleTts(request: Request) {
  try {
    await getUserClient(bearerToken(request));
  } catch (error) {
    if (error instanceof UnauthorizedError) return jsonError(401, "لطفاً دوباره وارد شوید.");
    throw error;
  }
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError(400, "متن نامعتبر است.");
  const persona = getPersona(parsed.data.personaId);
  let audio: Uint8Array;
  try {
    audio = await synthesizeSpeech(parsed.data.text, persona.tts);
  } catch (error) {
    console.warn("Speech synthesis failed, retrying once", error);
    try {
      audio = await synthesizeSpeech(parsed.data.text, persona.tts);
    } catch (retryError) {
      console.error("Speech synthesis failed", retryError);
      return jsonError(502, "ساخت صدا ممکن نشد.");
    }
  }
  return new Response(audio as BodyInit, {
    headers: { "content-type": "audio/mpeg", "cache-control": "no-store" },
  });
}

export const Route = createFileRoute("/api/tts")({
  server: { handlers: { POST: ({ request }) => handleTts(request) } },
});
