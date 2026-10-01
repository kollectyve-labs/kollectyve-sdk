import { describe, expect, it } from "vitest";
import { verify } from "micro-sr25519";
import type { H256Hex, IdentityId } from "@kollectyve/core";
import {
  buildCredential,
  createPresentation,
  KeyRing,
  verifyCredential,
  wrapBytes,
  verifyPresentation,
  type ChainCredential,
  type ChainReader,
  type KollectyveCredential,
} from "../src/index.js";

const PHRASE = "bottom drive obey lake curtain smoke basket hold race lonely fit walk";
const MINISTRY = 0n;
const UNIVERSITY = 1n;
const GRADUATE = 2n;
const SCHEMA = `0x${"d0".repeat(32)}` as H256Hex;
const NOW = Date.parse("2026-10-01T00:00:00Z");

/** An in-memory stand-in for the chain, mirroring the pallet's rules for `issue`. */
class FakeChain implements ChainReader {
  credentials = new Map<H256Hex, ChainCredential>();
  controllers = new Map<IdentityId, string>();
  anchors = new Set<IdentityId>();

  issue(doc: KollectyveCredential, digest: H256Hex, issuer: IdentityId, subject: IdentityId) {
    this.credentials.set(digest, {
      issuer,
      subject,
      schema: doc.credentialSchema.id,
      authorizedBy: doc.authorizedBy,
      issuedAt: NOW,
      expiresAt: doc.validUntil ? Date.parse(doc.validUntil) : undefined,
    });
  }
  async credential(d: H256Hex) {
    return this.credentials.get(d);
  }
  async controllerOf(id: IdentityId) {
    return this.controllers.get(id);
  }
  async isTrustAnchor(id: IdentityId) {
    return this.anchors.has(id);
  }
}

function world() {
  const chain = new FakeChain();
  const ring = KeyRing.fromMnemonic(PHRASE);
  chain.controllers.set(GRADUATE, ring.controller(0).address);
  chain.anchors.add(MINISTRY);

  const accreditation = buildCredential({
    issuer: MINISTRY,
    subject: UNIVERSITY,
    schema: SCHEMA,
    types: ["Accreditation"],
    claims: { name: "DAUST" },
    network: "testnet",
  });
  chain.issue(accreditation.credential, accreditation.digest, MINISTRY, UNIVERSITY);

  const diploma = buildCredential({
    issuer: UNIVERSITY,
    subject: GRADUATE,
    schema: SCHEMA,
    types: ["UniversityDiploma"],
    claims: { degree: "BSc Computer Science", year: 2026 },
    network: "testnet",
    authorizedBy: accreditation.digest,
  });
  chain.issue(diploma.credential, diploma.digest, UNIVERSITY, GRADUATE);
  return { chain, ring, accreditation, diploma };
}

describe("KeyRing", () => {
  it("derives stable, distinct controller keys from one phrase", () => {
    const a = KeyRing.fromMnemonic(PHRASE);
    const b = KeyRing.fromMnemonic(`  ${PHRASE.replace(/ /g, "   ")} `);
    expect(a.controller(0).address).toBe(b.controller(0).address);
    expect(a.controller(0).address).not.toBe(a.controller(1).address);
    expect(a.commitmentFor(1)).not.toBe(a.commitmentFor(2));
  });

  it("signs in a form any sr25519 verifier accepts", () => {
    const key = KeyRing.fromMnemonic(PHRASE).controller(0);
    const msg = new TextEncoder().encode("hello");
    expect(verify(msg, key.sign(msg), key.publicKey)).toBe(true);
  });

  it("rejects a bad phrase and generates valid ones", () => {
    expect(() => KeyRing.fromMnemonic("not a real phrase")).toThrow();
    expect(() => KeyRing.fromMnemonic(KeyRing.generateMnemonic())).not.toThrow();
  });
});

describe("verifyCredential", () => {
  it("walks the diploma back to the ministry", async () => {
    const { chain, diploma, accreditation } = world();
    const r = await verifyCredential(chain, diploma.credential, { now: NOW });
    expect(r).toMatchObject({ valid: true, trusted: true, anchor: MINISTRY });
    expect(r.path).toEqual([diploma.digest, accreditation.digest]);
  });

  it("rejects an altered document", async () => {
    const { chain, diploma } = world();
    const forged = {
      ...diploma.credential,
      credentialSubject: { ...diploma.credential.credentialSubject, degree: "PhD" },
    };
    expect((await verifyCredential(chain, forged, { now: NOW })).valid).toBe(false);
  });

  it("is valid but untrusted once the accreditation is revoked", async () => {
    const { chain, diploma, accreditation } = world();
    chain.credentials.get(accreditation.digest)!.revokedAt = NOW;
    const r = await verifyCredential(chain, diploma.credential, { now: NOW });
    expect(r).toMatchObject({ valid: true, trusted: false });
    expect(r.reason).toMatch(/revoked/);
  });

  it("lets the verifier pick its own anchors", async () => {
    const { chain, diploma } = world();
    const r = await verifyCredential(chain, diploma.credential, { now: NOW, anchors: [99n] });
    expect(r.trusted).toBe(false);
  });

  it("fails when the credential itself is revoked or expired", async () => {
    const { chain, diploma } = world();
    chain.credentials.get(diploma.digest)!.expiresAt = NOW - 1;
    expect((await verifyCredential(chain, diploma.credential, { now: NOW })).reason).toBe(
      "expired",
    );
  });
});

describe("presentations", () => {
  const ask = { challenge: "nonce-123", audience: "https://employer.example", now: NOW };

  it("round-trips: holder presents, verifier accepts", async () => {
    const { chain, ring, diploma } = world();
    const p = await createPresentation({
      key: ring.controller(0),
      holder: GRADUATE,
      credentials: [diploma.credential],
      challenge: ask.challenge,
      audience: ask.audience,
      now: NOW,
    });
    const r = await verifyPresentation(chain, JSON.parse(JSON.stringify(p)), ask);
    expect(r.valid).toBe(true);
    expect(r.holder).toBe(GRADUATE);
    expect(r.credentials[0]?.trusted).toBe(true);
  });

  it("refuses replay to another verifier or with another nonce", async () => {
    const { chain, ring, diploma } = world();
    const p = await createPresentation({
      key: ring.controller(0),
      holder: GRADUATE,
      credentials: [diploma.credential],
      ...ask,
    });
    expect((await verifyPresentation(chain, p, { ...ask, challenge: "other" })).valid).toBe(false);
    expect((await verifyPresentation(chain, p, { ...ask, audience: "https://evil" })).valid).toBe(
      false,
    );
    expect((await verifyPresentation(chain, p, { ...ask, now: NOW + 3_600_000 })).valid).toBe(
      false,
    );
  });

  it("stops accepting the old key after rotation", async () => {
    const { chain, ring, diploma } = world();
    const old = await createPresentation({
      key: ring.controller(0),
      holder: GRADUATE,
      credentials: [diploma.credential],
      ...ask,
    });
    chain.controllers.set(GRADUATE, ring.controller(1).address); // rotate_to_committed
    const r = await verifyPresentation(chain, old, ask);
    expect(r.reason).toMatch(/current controller/);
    const fresh = await createPresentation({
      key: ring.controller(1),
      holder: GRADUATE,
      credentials: [diploma.credential],
      ...ask,
    });
    expect((await verifyPresentation(chain, fresh, ask)).valid).toBe(true);
  });

  it("refuses someone else's credential and tampered payloads", async () => {
    const { chain, ring, accreditation, diploma } = world();
    const theirs = await createPresentation({
      key: ring.controller(0),
      holder: GRADUATE,
      credentials: [accreditation.credential],
      ...ask,
    });
    expect((await verifyPresentation(chain, theirs, ask)).reason).toMatch(/someone other/);

    const p = await createPresentation({
      key: ring.controller(0),
      holder: GRADUATE,
      credentials: [diploma.credential],
      ...ask,
    });
    const tampered = { ...p, payload: { ...p.payload, holder: "did:kollectyve:1" as const } };
    expect((await verifyPresentation(chain, tampered, ask)).reason).toBe("bad signature");
  });

  it("accepts a signature made the way extensions sign (<Bytes>-wrapped)", async () => {
    const { chain, ring, diploma } = world();
    const key = ring.controller(0);
    // What Talisman / Polkadot.js do inside signRaw.
    const extension = { address: key.address, sign: async (m: Uint8Array) => key.sign(wrapBytes(m)) };
    const p = await createPresentation({ key: extension, holder: GRADUATE, credentials: [diploma.credential], ...ask });
    expect((await verifyPresentation(chain, p, ask)).valid).toBe(true);
  });
});
