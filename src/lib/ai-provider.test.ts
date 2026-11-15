import { describe, expect, it } from "vitest";

import {
  AiConfigError,
  CHAT_MODEL,
  describeAiError,
  OPENROUTER_FALLBACK_MODELS,
  resolveChatProvider,
  withOpenRouterFallback,
} from "./ai-provider.server";

describe("resolveChatProvider", () => {
  it("uses Lovable AI when no custom key is set", () => {
    const config = resolveChatProvider({ LOVABLE_API_KEY: "lov" });
    expect(config.kind).toBe("lovable");
    expect(config.model).toBe(CHAT_MODEL);
  });

  it("uses OpenRouter when OPENROUTER_API_KEY is set, even with a Lovable key", () => {
    const config = resolveChatProvider({ LOVABLE_API_KEY: "lov", OPENROUTER_API_KEY: "sk-or-v1-or0123456789abcdef" });
    expect(config.kind).toBe("openrouter");
    expect(config.baseURL).toBe("https://openrouter.ai/api/v1");
    expect(config.key).toBe("sk-or-v1-or0123456789abcdef");
  });

  it("uses Groq when GROQ_API_KEY is set", () => {
    expect(resolveChatProvider({ GROQ_API_KEY: "gq" }).baseURL).toBe("https://api.groq.com/openai/v1");
  });

  it("uses OpenAI when OPENAI_API_KEY is set", () => {
    expect(resolveChatProvider({ OPENAI_API_KEY: "sk" }).baseURL).toBe("https://api.openai.com/v1");
  });

  it("AI_MODEL overrides the custom provider's default model", () => {
    expect(resolveChatProvider({ GROQ_API_KEY: "gq", AI_MODEL: "llama-3.3-70b-versatile" }).model).toBe(
      "llama-3.3-70b-versatile",
    );
  });

  it("ignores blank custom keys", () => {
    expect(resolveChatProvider({ OPENAI_API_KEY: "  ", LOVABLE_API_KEY: "lov" }).kind).toBe("lovable");
  });

  it("fails clearly when no key at all is configured", () => {
    expect(() => resolveChatProvider({})).toThrow(AiConfigError);
  });
});

describe("flexible OpenRouter secret names", () => {
  const KEY = "sk-or-v1-abcdef0123456789abcdef0123456789";
  for (const name of ["OPENROUTER_API_KEY", "OPENROUTER_", "OPENROUTER_KEY", "OPENROUTER"]) {
    it(`reads the key from ${name}`, () => {
      const config = resolveChatProvider({ LOVABLE_API_KEY: "lov", [name]: KEY });
      expect(config.kind).toBe("openrouter");
      expect(config.key).toBe(KEY);
    });
  }

  it("extracts the key when the secret has extra words around it", () => {
    expect(resolveChatProvider({ OPENROUTER_: `کلید من:\n${KEY} ممنون` }).key).toBe(KEY);
  });

  it("explains clearly when no key exists", () => {
    expect(() => resolveChatProvider({})).toThrow(AiConfigError);
  });
});

describe("describeAiError", () => {
  it("reports Lovable 402 as out of credits", () => {
    expect(describeAiError({ statusCode: 402 }, "lovable")).toContain("اعتبار");
  });
  it("names OpenRouter on a bad key", () => {
    expect(describeAiError({ statusCode: 401 }, "openrouter")).toContain("OpenRouter");
  });
  it("reports timeouts", () => {
    expect(describeAiError({ name: "TimeoutError", message: "x" }, "openrouter")).toContain("طول کشید");
  });
});

describe("describeAiError unwraps retry errors", () => {
  it("reports a rate limit hidden inside a retry error", () => {
    const retry = { name: "AI_RetryError", message: "Failed after 2 attempts", lastError: { statusCode: 429 } };
    expect(describeAiError(retry, "openrouter")).toContain("شلوغ");
  });
});

describe("OpenRouter fallback model", () => {
  it("tries the chosen model first, then the Persian-capable free backups (max 3)", async () => {
    let sent: { model?: string; models?: string[] } = {};
    const fake = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      sent = JSON.parse(String(init?.body));
      return new Response("{}");
    }) as typeof fetch;
    await withOpenRouterFallback(fake)("https://x", { method: "POST", body: JSON.stringify({ model: "google/gemma-4-31b-it:free" }) });
    expect(sent.models).toEqual(["google/gemma-4-31b-it:free", ...OPENROUTER_FALLBACK_MODELS]);
    expect(sent.models).toHaveLength(3);
  });
});
