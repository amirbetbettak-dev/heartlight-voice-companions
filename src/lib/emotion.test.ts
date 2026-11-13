import { describe, expect, it } from "vitest";

import { detectExpression } from "./emotion";
import { PERSONAS } from "./personas";

describe("detectExpression", () => {
  it("shows empathy for sadness", () => {
    expect(detectExpression("امروز خیلی دلم گرفته و تنهام")).toBe("empathetic");
  });
  it("shows concern for anxiety", () => {
    expect(detectExpression("از فردا خیلی استرس دارم")).toBe("concerned");
  });
  it("smiles for good news", () => {
    expect(detectExpression("بالاخره قبول شدم! خیلی خوشحالم")).toBe("happy");
  });
  it("looks curious for questions", () => {
    expect(detectExpression("تو چی فکر می‌کنی؟")).toBe("curious");
  });
});

describe("personas", () => {
  it("has two women and two men with four different voices", () => {
    expect(PERSONAS.filter((p) => p.gender === "female")).toHaveLength(2);
    expect(PERSONAS.filter((p) => p.gender === "male")).toHaveLength(2);
    expect(new Set(PERSONAS.map((p) => p.voice)).size).toBe(4);
    expect(PERSONAS.find((p) => p.id === "nazanin")?.voice).toBe("marin");
    expect(PERSONAS.find((p) => p.id === "taraneh")?.voice).toBe("gleam");
    expect(PERSONAS.find((p) => p.id === "arash")?.voice).toBe("stone");
    expect(PERSONAS.find((p) => p.id === "kian")?.voice).toBe("meridian");
  });
  it("keeps every spoken opening within the 480-byte voice limit", () => {
    for (const persona of PERSONAS) {
      expect(persona.openings.length).toBeGreaterThan(0);
      for (const opening of persona.openings) {
        expect(new TextEncoder().encode(opening).length).toBeLessThanOrEqual(480);
      }
    }
  });
});
