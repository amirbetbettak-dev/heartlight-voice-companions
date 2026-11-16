// Browser-safe helpers that turn a streaming reply into speakable sentences.

/** Strip markdown, emoji, links and odd spacing so the speech voice reads only words. */
export function cleanForSpeech(text: string) {
  return text
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[*_#`>~|[\]]/g, "")
    .replace(/\p{Extended_Pictographic}/gu, "")
    .replace(/[\u200d\ufe0f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

const LONG_CLAUSE = 110;
const SENTENCE_END = /[.!?؟…\n]+["'»)]*\s*/g;

/**
 * Split off the complete sentences in `pending` (text not yet spoken).
 * When the reply is `done`, the remainder is spoken too.
 * Returns the chunk to speak (may be empty) and how many characters it consumed.
 */
export function takeSpeakable(pending: string, done: boolean): { speak: string; consumed: number } {
  if (done) return { speak: cleanForSpeech(pending), consumed: pending.length };
  let end = 0;
  for (const match of pending.matchAll(SENTENCE_END)) end = (match.index ?? 0) + match[0].length;
  if (end === 0) {
    // A long sentence still streaming in: start speaking at its last comma so the voice isn't kept waiting.
    if (pending.length < LONG_CLAUSE) return { speak: "", consumed: 0 };
    const comma = Math.max(pending.lastIndexOf("،"), pending.lastIndexOf(","), pending.lastIndexOf("؛"));
    if (comma < 20) return { speak: "", consumed: 0 };
    return { speak: cleanForSpeech(pending.slice(0, comma + 1)), consumed: comma + 1 };
  }
  return { speak: cleanForSpeech(pending.slice(0, end)), consumed: end };
}

/** Prefer a Persian voice matching the persona's gender, then any Persian voice. */
export function pickPersianVoice<T extends { lang: string; name: string }>(voices: T[], gender: "female" | "male") {
  const persian = voices.filter((voice) => voice.lang.toLowerCase().replace("_", "-").startsWith("fa"));
  const female = /dilara|female|woman|zahra|sara|maryam|leila/i;
  const male = /farid|\bmale\b|\bman\b|reza|ali|amir/i;
  const match = persian.find((voice) => (gender === "female" ? female : male).test(voice.name));
  const neutral = persian.find((voice) => !(gender === "female" ? male : female).test(voice.name));
  return match ?? neutral ?? persian[0] ?? null;
}
