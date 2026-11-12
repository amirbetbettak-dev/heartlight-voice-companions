// Lightweight, local mood cue for the robot face. It only drives animation, never the AI reply.
export type FaceExpression = "neutral" | "happy" | "empathetic" | "concerned" | "curious";

const CUES: Array<{ expression: FaceExpression; words: string[] }> = [
  {
    expression: "empathetic",
    words: ["غمگین", "ناراحت", "تنها", "گریه", "دلم گرفته", "دلتنگ", "افسرده", "خسته", "شکست", "از دست دادم", "فوت", "دلشکسته", "بغض", "پوچ", "sad", "lonely", "cry", "tired", "depressed"],
  },
  {
    expression: "concerned",
    words: ["استرس", "می‌ترسم", "میترسم", "ترس", "نگران", "اضطراب", "عصبانی", "عصبی", "حرصم", "دعوا", "خشم", "بی‌خوابی", "anxious", "scared", "angry", "worried", "stress"],
  },
  {
    expression: "happy",
    words: ["خوشحال", "عالی", "خیلی خوب", "خندیدم", "موفق شدم", "قبول شدم", "عاشق", "دوستت دارم", "ممنون", "مرسی", "هورا", "ذوق", "happy", "great", "thanks", "love"],
  },
];

export function detectExpression(text: string): FaceExpression {
  const normalized = text.toLowerCase().replace(/\u200c/g, " ");
  for (const { expression, words } of CUES) {
    if (words.some((word) => normalized.includes(word.replace(/\u200c/g, " ")))) return expression;
  }
  if (/[؟?]\s*$/.test(text.trim())) return "curious";
  return "neutral";
}
