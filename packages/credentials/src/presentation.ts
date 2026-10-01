import { verify as sr25519Verify } from "micro-sr25519";
import { bytesToHex, decodeSs58, hexToBytes, type H256Hex, type Hex, type IdentityId } from "@kollectyve/core";
import { canonicalize, credentialDigest } from "./canonical.js";
import type { KollectyveCredential } from "./credential.js";
import { identityDid, parseIdentityDid, type KollectyveDid } from "./did.js";
import type { ControllerKey } from "./keyring.js";
import {
  verifyCredential,
  type ChainReader,
  type CredentialVerification,
  type VerifyOptions,
} from "./verify.js";

/** What the holder signs. Binds the credentials to this verifier, this request, this moment. */
export interface PresentationPayload {
  type: "KollectyvePresentation";
  holder: KollectyveDid;
  credentials: H256Hex[];
  /** The verifier's one-time nonce — stops a presentation being replayed. */
  challenge: string;
  /** Who it is for, e.g. the verifier's origin — stops it being forwarded elsewhere. */
  audience: string;
  createdAt: number;
}

export interface Presentation {
  payload: PresentationPayload;
  /** SS58 address of the controller key that signed. */
  signer: string;
  signature: Hex;
  credentials: KollectyveCredential[];
}

/** Domain-separates presentation signatures from anything else the key ever signs. */
const SIGNING_PREFIX = "kollectyve:presentation:v1:";

function signingBytes(payload: PresentationPayload): Uint8Array {
  return new TextEncoder().encode(SIGNING_PREFIX + canonicalize(payload));
}

/** Holder side: present credentials, signed by the identity's current controller key. */
export function createPresentation(input: {
  key: ControllerKey;
  holder: IdentityId;
  credentials: KollectyveCredential[];
  challenge: string;
  audience: string;
  now?: number;
}): Presentation {
  const payload: PresentationPayload = {
    type: "KollectyvePresentation",
    holder: identityDid(input.holder),
    credentials: input.credentials.map((c) => credentialDigest(c)),
    challenge: input.challenge,
    audience: input.audience,
    createdAt: input.now ?? Date.now(),
  };
  return {
    payload,
    signer: input.key.address,
    signature: bytesToHex(input.key.sign(signingBytes(payload))),
    credentials: input.credentials,
  };
}

export interface PresentationVerification {
  valid: boolean;
  holder?: IdentityId;
  credentials: CredentialVerification[];
  reason?: string;
}

/**
 * Verifier side. Valid means: the request matches, the signature is by the holder identity's
 * **current** controller, every credential is about the holder, and each one verifies. Whether
 * each credential is also *trusted* is reported per credential, for the verifier's policy.
 */
export async function verifyPresentation(
  reader: ChainReader,
  p: Presentation,
  expect: { challenge: string; audience: string; maxAgeMs?: number } & VerifyOptions,
): Promise<PresentationVerification> {
  const now = expect.now ?? Date.now();
  const maxAge = expect.maxAgeMs ?? 5 * 60_000;
  const fail = (reason: string, holder?: IdentityId): PresentationVerification => ({
    valid: false,
    holder,
    credentials: [],
    reason,
  });

  const { payload } = p;
  if (payload.type !== "KollectyvePresentation") return fail("not a Kollectyve presentation");
  if (payload.challenge !== expect.challenge) return fail("challenge mismatch");
  if (payload.audience !== expect.audience) return fail("audience mismatch");
  if (payload.createdAt > now + 60_000 || now - payload.createdAt > maxAge) {
    return fail("presentation is stale or from the future");
  }

  let holder: IdentityId;
  let signerKey: Uint8Array;
  try {
    holder = parseIdentityDid(payload.holder);
    signerKey = decodeSs58(p.signer);
  } catch (e) {
    return fail((e as Error).message);
  }
  if (!sr25519Verify(signingBytes(payload), hexToBytes(p.signature), signerKey)) {
    return fail("bad signature", holder);
  }
  const controller = await reader.controllerOf(holder);
  if (!controller || bytesToHex(decodeSs58(controller)) !== bytesToHex(signerKey)) {
    return fail("signer is not the holder's current controller", holder);
  }

  const digests = p.credentials.map((c) => credentialDigest(c));
  if (canonicalize(digests) !== canonicalize(payload.credentials)) {
    return fail("signed digests do not match the credentials presented", holder);
  }
  for (const c of p.credentials) {
    if (c.credentialSubject?.id !== payload.holder) {
      return fail("a credential is about someone other than the holder", holder);
    }
  }

  const credentials = await Promise.all(
    p.credentials.map((c) => verifyCredential(reader, c, { ...expect, now })),
  );
  const bad = credentials.find((c) => !c.valid);
  return {
    valid: !bad,
    holder,
    credentials,
    ...(bad ? { reason: `credential ${bad.digest}: ${bad.reason}` } : {}),
  };
}
