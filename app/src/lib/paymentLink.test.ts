import { describe, it, expect } from "vitest";
import { encodePaymentLink, parsePaymentLink, describeRequest, VEIL_URI_SCHEME } from "./paymentLink";

const PUB = "1234567890";
const ENC = "a".repeat(64);

describe("paymentLink", () => {
  it("round-trips a full request", () => {
    const link = encodePaymentLink({ pubkey: PUB, encPub: ENC, amount: "1.5", currencyId: 1, label: "Coffee", memo: "thanks" });
    expect(link.startsWith(VEIL_URI_SCHEME)).toBe(true);
    const back = parsePaymentLink(link);
    expect(back).toEqual({ pubkey: PUB, encPub: ENC, amount: "1.5", currencyId: 1, label: "Coffee", memo: "thanks" });
  });

  it("encodes a bare address with no params", () => {
    const link = encodePaymentLink({ pubkey: PUB, encPub: ENC });
    expect(link).toBe(`${VEIL_URI_SCHEME}${PUB}.${ENC}`);
  });

  it("parses a bare pubkey.encpub address (back-compat)", () => {
    const back = parsePaymentLink(`${PUB}.${ENC}`);
    expect(back).toEqual({ pubkey: PUB, encPub: ENC });
  });

  it("tolerates veil:// double slash", () => {
    expect(parsePaymentLink(`veil://${PUB}.${ENC}`)).toEqual({ pubkey: PUB, encPub: ENC });
  });

  it("rejects a malformed address", () => {
    expect(parsePaymentLink("not-an-address")).toBeNull();
    expect(parsePaymentLink(`${PUB}.zzzz`)).toBeNull();
    expect(parsePaymentLink(`abc.${ENC}`)).toBeNull();
  });

  it("drops an unknown currency id", () => {
    const back = parsePaymentLink(`${VEIL_URI_SCHEME}${PUB}.${ENC}?currency=999`);
    expect(back?.currencyId).toBeUndefined();
  });

  it("ignores a non-numeric amount", () => {
    const back = parsePaymentLink(`${VEIL_URI_SCHEME}${PUB}.${ENC}?amount=abc`);
    expect(back?.amount).toBeUndefined();
  });

  it("throws on a bad address when encoding", () => {
    expect(() => encodePaymentLink({ pubkey: "xx", encPub: ENC })).toThrow();
  });

  it("describes a request", () => {
    expect(describeRequest({ pubkey: PUB, encPub: ENC, amount: "2", currencyId: 0 })).toBe("Requesting 2 XLM");
    expect(describeRequest({ pubkey: PUB, encPub: ENC })).toBe("Open-ended request");
  });
});
