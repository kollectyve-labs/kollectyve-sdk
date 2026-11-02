import { deflateSync, inflateSync, strFromU8, strToU8 } from 'fflate';
import type { KollectyveCredential } from "./credential.js";
import type { Presentation } from "./presentation.js";

/**
 * Codes exchanged by QR or link between issuers, holders and verifiers (Amaan): `KW1.<kind>.<base64url(deflate(JSON))>`.
 *
 * Deflate matters: a presentation carrying a diploma is ~1.6 KB of JSON and ~800 bytes
 * compressed, which keeps the QR at a density a phone camera reads across a table.
 */

export interface PresentationRequest {
  type: 'KollectyvePresentationRequest';
  challenge: string;
  audience: string;
}

export type Payload =
  | { kind: 'req'; value: PresentationRequest }
  | { kind: 'pres'; value: Presentation }
  | { kind: 'cred'; value: KollectyveCredential };

const PREFIX = 'KW1';
const KINDS = new Set(['req', 'pres', 'cred']);

export function encodePayload(p: Payload): string {
  const packed = deflateSync(strToU8(JSON.stringify(p.value)), { level: 9 });
  return `${PREFIX}.${p.kind}.${toBase64Url(packed)}`;
}

export class PayloadError extends Error {}

export function decodePayload(text: string): Payload {
  const [prefix, kind, body, ...rest] = text.trim().split('.');
  if (prefix !== PREFIX || !kind || !KINDS.has(kind) || !body || rest.length > 0) {
    throw new PayloadError('This is not a Kollectyve code');
  }
  let value: unknown;
  try {
    value = JSON.parse(strFromU8(inflateSync(fromBase64Url(body))));
  } catch {
    throw new PayloadError('This code is damaged or incomplete');
  }
  return { kind, value } as Payload;
}

export function newRequest(audience: string): PresentationRequest {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const challenge = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return { type: 'KollectyvePresentationRequest', challenge, audience };
}

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

function toBase64Url(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i]! << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    const chars = Math.min(4, Math.ceil(((bytes.length - i) * 8) / 6));
    for (let j = 0; j < chars; j++) out += ALPHABET[(n >> (18 - 6 * j)) & 63];
  }
  return out;
}

function fromBase64Url(text: string): Uint8Array {
  const out: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const c of text) {
    const v = ALPHABET.indexOf(c);
    if (v < 0) throw new PayloadError('Invalid character in code');
    buffer = (buffer << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((buffer >> bits) & 0xff);
    }
  }
  return Uint8Array.from(out);
}

