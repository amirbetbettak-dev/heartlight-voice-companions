import { describe, expect, it } from "vitest";

import { cleanForSpeech, pickPersianVoice, takeSpeakable } from "./speech-text";

describe("takeSpeakable", () => {
  it("waits until a sentence is complete", () => {
    expect(takeSpeakable("سلام عزیزم، امروز", false)).toEqual({ speak: "", consumed: 0 });
  });
  it("speaks complete sentences and keeps the unfinished tail", () => {
    const pending = "سلام عزیزم! امروز چطور بود؟ بگو";
    const { speak, consumed } = takeSpeakable(pending, false);
    expect(speak).toBe("سلام عزیزم! امروز چطور بود؟");
    expect(pending.slice(consumed)).toBe("بگو");
  });
  it("starts a long unfinished sentence at its last comma", () => {
    const pending = "راستش رو بخوای من همیشه فکر می‌کردم آدم‌ها وقتی خسته‌ان بیشتر از هر چیزی یه گوش شنوا می‌خوان، نه نصیحت و راه‌حل و این حرفا، و تو هم";
    const { speak, consumed } = takeSpeakable(pending, false);
    expect(speak.endsWith("این حرفا،")).toBe(true);
    expect(pending.slice(consumed)).toBe(" و تو هم");
  });
  it("speaks the remainder when the reply is done", () => {
    expect(takeSpeakable("بگو ببینم", true)).toEqual({ speak: "بگو ببینم", consumed: 9 });
  });
});

describe("cleanForSpeech", () => {
  it("drops markdown and emoji", () => {
    expect(cleanForSpeech("**وای** چه خوب 😊")).toBe("وای چه خوب");
  });
});

describe("pickPersianVoice", () => {
  const voices = [
    { name: "Google US English", lang: "en-US" },
    { name: "Microsoft Farid Online (Natural) - Persian (Iran)", lang: "fa-IR" },
    { name: "Microsoft Dilara Online (Natural) - Persian (Iran)", lang: "fa-IR" },
  ];
  it("keeps women on a female Persian voice", () => {
    expect(pickPersianVoice(voices, "female")?.name).toContain("Dilara");
  });
  it("keeps men on a male Persian voice", () => {
    expect(pickPersianVoice(voices, "male")?.name).toContain("Farid");
  });
  it("returns null when there is no Persian voice", () => {
    expect(pickPersianVoice([voices[0]!], "female")).toBeNull();
  });
});
