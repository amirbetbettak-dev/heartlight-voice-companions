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

const CUSTOM_PROVIDERS: Array<{ kind: Exclude<ProviderKind, "lovable">; envKey: string; baseURL: string; model: string }> = [
  { kind: "openrouter", envKey: "OPENROUTER_API_KEY", baseURL: "https://openrouter.ai/api/v1", model: "openrouter/free" },
  { kind: "groq", envKey: "GROQ_API_KEY", baseURL: "https://api.groq.com/openai/v1", model: "openai/gpt-oss-120b" },
  { kind: "openai", envKey: "OPENAI_API_KEY", baseURL: "https://api.openai.com/v1", model: "gpt-5-mini" },
];

/** Pick the AI service from environment secrets. First custom key found wins; otherwise Lovable AI. */
export function resolveChatProvider(env: Env): ChatProviderConfig {
  const modelOverride = env["AI_MODEL"]?.trim();
  for (const provider of CUSTOM_PROVIDERS) {
    const key = env[provider.envKey]?.trim();
    if (key) {
      return { kind: provider.kind, baseURL: provider.baseURL, key, model: modelOverride || provider.model };
    }
  }
  const key = env["LOVABLE_API_KEY"]?.trim();
  if (!key) throw new Error("AI is not configured");
  return { kind: "lovable", baseURL: GATEWAY_URL, key, model: CHAT_MODEL };
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
  });
  return { model: provider.chat(config.model) as LanguageModel, providerOptions: {} };
}
