// Chooses which AI service answers text chat and maintains memory.
// A custom key (OpenRouter, Groq or OpenAI) set as a secret takes priority over Lovable AI,
// so the app keeps working without Lovable AI credits. Voice calls always use Lovable AI.
import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";

export const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1";
export const CHAT_MODEL = "openai/gpt-6-astra";

export type ProviderKind = "lovable" | "openrouter" | "groq" | "openai";

export type ChatProviderConfig = {
  kind: ProviderKind;
  baseURL: string;
  key: string;
  model: string;
};

type Env = Record<string, string | undefined>;

const CUSTOM_PROVIDERS: Array<{
  kind: Exclude<ProviderKind, "lovable">;
  envKeys: string[];
  baseURL: string;
  model: string;
}> = [
  {
    kind: "openrouter",
    envKeys: ["OPENROUTER_API_KEY", "OPENROUTER_", "OPENROUTER_KEY", "OPENROUTER"],
    baseURL: "https://openrouter.ai/api/v1",
    model: "google/gemma-4-31b-it:free",
  },
  { kind: "groq", envKeys: ["GROQ_API_KEY"], baseURL: "https://api.groq.com/openai/v1", model: "openai/gpt-oss-120b" },
  { kind: "openai", envKeys: ["OPENAI_API_KEY"], baseURL: "https://api.openai.com/v1", model: "gpt-5-mini" },
];

/** Raised when no usable AI key exists; `message` is shown to the user as-is. */
export class AiConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiConfigError";
  }
}

const KNOWN_KEY_PATTERN = /(?:sk-or-v1-|sk-or-|gsk_|sk-proj-|sk-)[A-Za-z0-9_-]{16,}/;

/**
 * Pull the usable key out of a saved secret. Pasted secrets sometimes carry extra words, quotes or
 * line breaks around the key; HTTP headers only accept plain ASCII, so anything else breaks every request.
 */
export function cleanApiKey(raw: string | undefined): string | undefined {
  const value = raw?.trim();
  if (!value) return undefined;
  const known = value.match(KNOWN_KEY_PATTERN);
  if (known) return known[0];
  if (/^[\x21-\x7e]+$/.test(value)) return value;
  const token = value.match(/[\x21-\x7e]{16,}/);
  return token ? token[0].replace(/^["'`]+|["'`]+$/g, "") : undefined;
}

/** Pick the AI service from environment secrets. First usable custom key wins; otherwise Lovable AI. */
export function resolveChatProvider(env: Env): ChatProviderConfig {
  const modelOverride = env["AI_MODEL"]?.trim();
  let unusableKey = false;
  for (const provider of CUSTOM_PROVIDERS) {
    for (const envKey of provider.envKeys) {
      if (!env[envKey]?.trim()) continue;
      const key = cleanApiKey(env[envKey]);
      if (!key) {
        unusableKey = true;
        continue;
      }
      return { kind: provider.kind, baseURL: provider.baseURL, key, model: modelOverride || provider.model };
    }
  }
  const key = cleanApiKey(env["LOVABLE_API_KEY"]);
  if (key) return { kind: "lovable", baseURL: GATEWAY_URL, key, model: CHAT_MODEL };
  throw new AiConfigError(
    unusableKey
      ? "کلید هوش مصنوعی ذخیره‌شده قابل استفاده نیست. لطفاً کلید را دوباره و بدون متن اضافه ثبت کنید."
      : "کلید هوش مصنوعی پیدا نشد. لطفاً کلید OpenRouter را در تنظیمات ثبت کنید.",
  );
}

/** Turn any AI failure into a short Persian message the user can act on. */
export function describeAiError(error: unknown, kind?: ProviderKind): string {
  if (error instanceof AiConfigError) return error.message;
  const err = error as { name?: string; message?: string; statusCode?: number; responseBody?: string; cause?: unknown };
  const name = err?.name ?? "";
  const message = err?.message ?? "";
  const service = kind === "openrouter" ? "OpenRouter" : kind === "groq" ? "Groq" : kind === "openai" ? "OpenAI" : "هوش مصنوعی";
  if (/timeout/i.test(name) || /timed? ?out/i.test(message)) {
    return "پاسخ خیلی طول کشید و متوقف شد. دوباره امتحان کنید.";
  }
  if (/ByteString/i.test(message)) return "کلید هوش مصنوعی نامعتبر است. لطفاً کلید را دوباره ثبت کنید.";
  const status = err?.statusCode;
  if (status === 401 || status === 403) return `کلید ${service} نامعتبر است یا دسترسی ندارد.`;
  if (status === 402) {
    return kind && kind !== "lovable"
      ? `موجودی حساب ${service} کافی نیست.`
      : "اعتبار هوش مصنوعی Lovable تمام شده است. یک کلید اختصاصی ثبت کنید یا اعتبار را شارژ کنید.";
  }
  if (status === 429) return `${service} الان شلوغ است؛ چند لحظه بعد دوباره امتحان کنید.`;
  if (status === 404 || status === 400) {
    return `${service} این مدل را نپذیرفت. مدل انتخابی (AI_MODEL) را بررسی کنید.`;
  }
  if (typeof status === "number" && status >= 500) return `سرویس ${service} موقتاً در دسترس نیست. کمی بعد امتحان کنید.`;
  // Retry wrappers hide the real failure (status code) in `lastError`.
  const last = (error as { lastError?: unknown })?.lastError;
  if (last && last !== error) return describeAiError(last, kind);
  if (err?.cause && err.cause !== error) return describeAiError(err.cause, kind);
  return "پاسخ کامل نشد. دوباره امتحان کنید.";
}

/**
 * Free OpenRouter models with natural Persian, tried in order when the chosen model is busy or
 * rate-limited. The random `openrouter/free` router is avoided: some of its picks write broken Persian.
 * OpenRouter accepts at most 3 models per request.
 */
export const OPENROUTER_FALLBACK_MODELS = ["baidu/ernie-5.5-flash-preview:free", "google/gemma-4-26b-a4b-it:free"];

/**
 * Add OpenRouter's `models` fallback list to each request, so a rate-limited free model
 * (a common 429 on shared free pools) falls through to another free model instead of failing.
 */
export function withOpenRouterFallback(baseFetch: typeof fetch = fetch): typeof fetch {
  return (input, init) => {
    if (typeof init?.body === "string") {
      try {
        const body = JSON.parse(init.body) as { model?: string; models?: string[] };
        if (body.model && !body.models) {
          body.models = [...new Set([body.model, ...OPENROUTER_FALLBACK_MODELS])].slice(0, 3);
          init = { ...init, body: JSON.stringify(body) };
        }
      } catch {
        // Not JSON: send unchanged.
      }
    }
    return baseFetch(input, init);
  };
}

export const lovableReasoningOptions = {
  openai: {
    store: false,
    forceReasoning: true,
    reasoningEffort: "low",
    reasoningSummary: "auto",
    include: ["reasoning.encrypted_content"],
  },
} as const;

/** Build the language model (and provider options) for the chosen AI service. */
export function chatModel(config: ChatProviderConfig, fetchImpl?: typeof fetch) {
  if (config.kind === "lovable") {
    const provider = createOpenAI({
      baseURL: config.baseURL,
      apiKey: config.key,
      headers: { "Lovable-API-Key": config.key, "X-Lovable-AIG-SDK": "vercel-ai-sdk" },
      ...(fetchImpl ? { fetch: fetchImpl } : {}),
    });
    return {
      model: provider.responses(config.model) as LanguageModel,
      providerOptions: lovableReasoningOptions,
    };
  }
  const provider = createOpenAI({
    baseURL: config.baseURL,
    apiKey: config.key,
    headers:
      config.kind === "openrouter"
        ? { "HTTP-Referer": "https://heartlight-voice-companions.lovable.app", "X-Title": "Hamdam" }
        : {},
    ...(config.kind === "openrouter" ? { fetch: withOpenRouterFallback() } : {}),
  });
  return { model: provider.chat(config.model) as LanguageModel, providerOptions: {} };
}
