import { KeyRing, verifyCredential, createPresentation, verifyPresentation } from "@kollectyve/credentials";
import { KollectyveSubstrate, chainReader, signerFromKeypair } from "@kollectyve/substrate";
import { bytesToHex } from "@kollectyve/core";

// The whole wallet lifecycle against a chain and a wallet gateway (apps-sites/amaan-gateway):
// enroll → commit next key → demo diploma → verify → present → move funds → rotate.
//
//   WS=ws://127.0.0.1:9944 GATEWAY=http://127.0.0.1:8788 node examples/wallet-flow.mjs
const GW = process.env.GATEWAY ?? "http://127.0.0.1:8788";
const WS = process.env.WS ?? "ws://127.0.0.1:9944";
let pass = 0, fail = 0;
const check = (name, ok, detail = "") => { ok ? pass++ : fail++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`); };
const post = async (path, body) => { const r = await fetch(GW + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); return { status: r.status, body: await r.json() }; };

const ring = KeyRing.fromMnemonic(KeyRing.generateMnemonic());
const key0 = ring.controller(0), key1 = ring.controller(1);
const signer = (k) => signerFromKeypair({ publicKey: k.publicKey, sign: k.sign });
const ts = Date.now();
const sign = (k, msg) => bytesToHex(k.sign(new TextEncoder().encode(msg)));
const msg = `kollectyve:enroll:v1:${key0.address}:${ts}`;

let r = await post("/enroll", { address: key0.address, timestamp: ts, signature: sign(key1, msg) });
check("enroll with someone else's signature is refused", r.status === 401);
r = await post("/enroll", { address: key0.address, timestamp: ts, signature: sign(key0, msg) });
check("enroll with a valid proof", r.status === 200 && r.body.created && r.body.funded, JSON.stringify(r.body));
const id = BigInt(r.body.identity);
r = await post("/enroll", { address: key0.address, timestamp: ts, signature: sign(key0, msg) });
check("enroll is idempotent", r.status === 200 && !r.body.created && BigInt(r.body.identity) === id);

const k = new KollectyveSubstrate({ substrateWs: WS, onChainMismatch: "warn" });
await k.client.ready();
const reader = chainReader(k.client);
check("chain says key 0 controls the identity", (await reader.controllerOf(id)) === key0.address);

await k.identity.commitNextController(id, ring.commitmentFor(1), signer(key0));
check("wallet commits key 1 through the SDK, paying its own fee", (await k.identity.nextControllerCommitment(id)) === ring.commitmentFor(1));

r = await post("/demo/diploma", { identity: "999999", name: "Nobody" });
check("diploma for an unknown identity is refused", r.status === 404);
r = await post("/demo/diploma", { identity: id.toString(), name: "Awa Ndiaye" });
check("gateway issues a demo diploma", r.status === 200 && !!r.body.credential, r.body.error ?? "");
const diploma = r.body.credential;

const v = await verifyCredential(reader, diploma);
check("diploma verifies on chain, trusted via a trust anchor", v.valid && v.trusted && v.anchor !== undefined, v.reason ?? "");

const req = { challenge: "c-" + Date.now(), audience: "Acme Recruiting" };
const p = await createPresentation({ key: key0, holder: id, credentials: [diploma], ...req });
check("presentation verifies on chain", (await verifyPresentation(reader, p, req)).valid);

// The incoming key signs the rotation, so it needs the funds: move them over first.
await k.balances.transferAll(key1.address, false, signer(key0));
check("funds moved to the committed key", (await k.balances.freeBalance(key1.address)) > 0n);
await k.identity.rotateToCommitted(id, ring.commitmentFor(2), signer(key1));
check("pre-rotation: key 1 takes control through the SDK", (await reader.controllerOf(id)) === key1.address);
const stale = await verifyPresentation(reader, p, req);
check("a presentation signed by the old key is refused after rotation", !stale.valid, stale.reason);

k.destroy();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
