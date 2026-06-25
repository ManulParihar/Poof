// Veil payment requests — a shareable `veil:` URI (and QR payload) that encodes a
// recipient's shielded meta-address plus an optional amount/currency/memo/label.
// The sender's wallet parses it and prefills the Send form: the "Venmo, but
// shielded" flow. Nothing here touches the chain — a payment link is purely a
// request; paying it is an ordinary private transfer.
//
// Wire format:
//   veil:<pubkey>.<encPubHex>?amount=<human>&currency=<id>&memo=<text>&label=<text>
// The address half (`pubkey.encPubHex`) is byte-identical to the address the
// Receive page already shows, so old plain-address pastes keep working too.

import { currencyById, CURRENCIES } from "./currencies";

export const VEIL_URI_SCHEME = "veil:";

export interface PaymentRequest {
  /** Recipient shielded spend pubkey (decimal field element). */
  pubkey: string;
  /** Recipient x25519 encryption pubkey (64-hex). */
  encPub: string;
  /** Optional requested amount, as a human string in the currency's units. */
  amount?: string;
  /** Optional on-chain currency id (registry index). Defaults to 0 (XLM). */
  currencyId?: number;
  /** Optional human note shown to the payer (not encrypted, not on-chain). */
  label?: string;
  /** Optional private memo to attach to the payment (encrypted to the recipient). */
  memo?: string;
}

const PUBKEY_RE = /^[0-9]+$/;
const ENCPUB_RE = /^[0-9a-fA-F]{64}$/;
/** human decimal: digits with at most one dot. */
const AMOUNT_RE = /^\d+(\.\d+)?$/;

/** Validate the address half of a request. Returns a reason string or null. */
export function addressError(pubkey: string, encPub: string): string | null {
  if (!PUBKEY_RE.test(pubkey)) return "address pubkey must be a decimal field element";
  if (!ENCPUB_RE.test(encPub)) return "address encPub must be 64 hex chars";
  return null;
}

/** Build a `veil:` payment-request URI from a request. Throws on a bad address. */
export function encodePaymentLink(req: PaymentRequest): string {
  const err = addressError(req.pubkey, req.encPub);
  if (err) throw new Error(err);
  const params = new URLSearchParams();
  if (req.amount && req.amount.trim() && req.amount.trim() !== "0") {
    if (!AMOUNT_RE.test(req.amount.trim())) throw new Error("amount must be a positive decimal");
    params.set("amount", req.amount.trim());
  }
  if (req.currencyId != null && req.currencyId !== 0) params.set("currency", String(req.currencyId));
  if (req.label && req.label.trim()) params.set("label", req.label.trim());
  if (req.memo && req.memo.trim()) params.set("memo", req.memo.trim());
  const qs = params.toString();
  return `${VEIL_URI_SCHEME}${req.pubkey}.${req.encPub}${qs ? `?${qs}` : ""}`;
}

/**
 * Parse a payment input into a request. Accepts:
 *   - a full `veil:` URI (with or without query params),
 *   - a bare `pubkey.encPub` address (back-compat with the old paste format).
 * Returns null when the address half is missing or malformed, so callers can show
 * a single "invalid address" error instead of guessing.
 */
export function parsePaymentLink(input: string): PaymentRequest | null {
  if (!input) return null;
  let raw = input.trim();
  if (raw.toLowerCase().startsWith(VEIL_URI_SCHEME)) raw = raw.slice(VEIL_URI_SCHEME.length);
  // Tolerate an accidental `//` after the scheme (veil://addr).
  raw = raw.replace(/^\/+/, "");

  const qIdx = raw.indexOf("?");
  const addrPart = qIdx === -1 ? raw : raw.slice(0, qIdx);
  const queryPart = qIdx === -1 ? "" : raw.slice(qIdx + 1);

  const dot = addrPart.indexOf(".");
  if (dot === -1) return null;
  const pubkey = addrPart.slice(0, dot);
  const encPub = addrPart.slice(dot + 1);
  if (addressError(pubkey, encPub)) return null;

  const out: PaymentRequest = { pubkey, encPub };
  if (queryPart) {
    const p = new URLSearchParams(queryPart);
    const amount = p.get("amount");
    if (amount && AMOUNT_RE.test(amount)) out.amount = amount;
    const currency = p.get("currency");
    if (currency != null && /^\d+$/.test(currency)) {
      const id = Number(currency);
      // only accept a currency the wallet actually knows about
      if (CURRENCIES.some((c) => c.id === id)) out.currencyId = id;
    }
    const label = p.get("label");
    if (label) out.label = label.slice(0, 120);
    const memo = p.get("memo");
    if (memo) out.memo = memo.slice(0, 192);
  }
  return out;
}

/** Human one-liner describing what a request is asking for (for confirm UIs). */
export function describeRequest(req: PaymentRequest): string {
  if (!req.amount) return "Open-ended request";
  const sym = currencyById(req.currencyId ?? 0).symbol;
  return `Requesting ${req.amount} ${sym}`;
}
