import { describe, expect, it } from "vitest";

import { formatPhone, normalizePhone } from "./phone";

describe("normalizePhone", () => {
  it("accepts Iranian mobile numbers in common forms", () => {
    expect(normalizePhone("09123456789")).toBe("+989123456789");
    expect(normalizePhone("9123456789")).toBe("+989123456789");
    expect(normalizePhone("+98 912 345 6789")).toBe("+989123456789");
    expect(normalizePhone("00989123456789")).toBe("+989123456789");
  });
  it("accepts Persian digits", () => {
    expect(normalizePhone("۰۹۱۲۳۴۵۶۷۸۹")).toBe("+989123456789");
  });
  it("rejects incomplete or non-mobile Iranian numbers", () => {
    expect(normalizePhone("0912345")).toBeNull();
    expect(normalizePhone("02112345678")).toBeNull();
    expect(normalizePhone("+982112345678")).toBeNull();
  });
  it("keeps international numbers with a country code", () => {
    expect(normalizePhone("+14155550123")).toBe("+14155550123");
  });
});

describe("formatPhone", () => {
  it("shows Iranian numbers in local form", () => {
    expect(formatPhone("+989123456789")).toBe("0912 345 6789");
  });
});
