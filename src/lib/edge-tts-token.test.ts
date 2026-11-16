import { describe, expect, it } from "vitest";

import { edgeSecMsGec } from "./edge-tts-token";
import { PERSONAS } from "./personas";

describe("edgeSecMsGec", () => {
  // Reference values produced by the edge-tts Python package (generate_sec_ms_gec_v2).
  it("matches the reference signature", () => {
    expect(edgeSecMsGec(1700000000)).toBe(
      "2CD23A2CA0B2595A-F3C846C370E05F9CC83ACC5F995C5F5D87A4D0F14CE8936A0F902E64099E38A2",
    );
    expect(edgeSecMsGec(1794816000)).toBe(
      "307855BC873AB228-2FB0DB918B80E7D76D481AED51CF0405FCD4FEDC7C5879B952C252B26CBCDD70",
    );
  });
  it("stays the same within a 5-minute window", () => {
    expect(edgeSecMsGec(1794816000 + 299)).toBe(edgeSecMsGec(1794816000));
  });
});

describe("persona voices", () => {
  it("women always speak with the female Persian voice", () => {
    for (const persona of PERSONAS.filter((p) => p.gender === "female")) {
      expect(persona.tts.voice).toBe("fa-IR-DilaraNeural");
    }
  });
  it("men always speak with the male Persian voice", () => {
    for (const persona of PERSONAS.filter((p) => p.gender === "male")) {
      expect(persona.tts.voice).toBe("fa-IR-FaridNeural");
    }
  });
});
