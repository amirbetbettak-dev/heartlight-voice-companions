import { describe, expect, it } from "vitest";

import { CHAT_MODEL, resolveChatProvider } from "./ai-provider.server";

describe("resolveChatProvider", () => {
  it("uses Lovable AI when no custom key is set", () => {
    const config = resolveChatProvider({ LOVABLE_API_KEY: "lov" });
    expect(config.kind).toBe("lovable");
    expect(config.model).toBe(CHAT_MODEL);
  });

  it("uses OpenRouter when OPENROUTER_API_KEY is set, even with a Lovable key", () => {
    const config = resolveChatProvider({ LOVABLE_API_KEY: "lov", OPENROUTER_API_KEY: "or" });
    expect(config.kind).toBe("openrouter");
    expect(config.baseURL).toBe("https://openrouter.ai/api/v1");
    expect(config.key).toBe("or");
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
    expect(() => resolveChatProvider({})).toThrow("AI is not configured");
  });
});
