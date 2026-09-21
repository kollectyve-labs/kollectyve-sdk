import { useEffect, useState } from "react";
import { useKollectyve } from "@kollectyve/react";
import { userCommitment, type KycTier } from "@kollectyve/sdk";
import { aliceSigner } from "../devSigner.js";

// Canonical dev address (Alice) — the default controller for newly-registered identities.
const ALICE_SS58 = "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY";

export function SubstratePanel() {
  const k = useKollectyve();
  const sc = k.substrate.client;

  const [block, setBlock] = useState<number>();
  const [nextId, setNextId] = useState<bigint>();
  const [queryId, setQueryId] = useState("1");
  const [tier, setTier] = useState<KycTier>();
  const [controller, setController] = useState("");
  // An identity is one-per-controller and one-per-commitment, so registering again needs a
  // fresh account. The dev flow: paste a new SS58 address and a subject you haven't used.
  const [newController, setNewController] = useState(ALICE_SS58);
  const [subject, setSubject] = useState("pilot-user-1");
  const [busy, setBusy] = useState<string>();
  const [status, setStatus] = useState<string>();

  // Live finalized block height.
  useEffect(() => {
    let alive = true;
    const tick = () =>
      sc.client.getFinalizedBlock().then((b) => alive && setBlock(b.number)).catch(() => {});
    tick();
    const id = setInterval(tick, 3000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [sc]);

  const refreshNextId = () => k.substrate.identity.nextId().then(setNextId).catch(() => setNextId(undefined));
  useEffect(() => void refreshNextId(), [sc]); // eslint-disable-line react-hooks/exhaustive-deps

  async function queryIdentity() {
    setBusy("query");
    try {
      const id = BigInt(queryId);
      const who = await k.substrate.identity.controllerOf(id);
      setController(who ?? "— (no such identity)");
      setTier(who ? await k.substrate.identity.tierOf(id) : undefined);
    } finally {
      setBusy(undefined);
    }
  }

  async function register() {
    setBusy("register");
    const commitment = userCommitment(subject);
    setStatus(`signing with Alice… (commitment ${commitment.slice(0, 10)}…)`);
    try {
      const taken = await k.substrate.identity.identityForCommitment(commitment);
      if (taken !== undefined) {
        setStatus(`✗ subject "${subject}" is already identity #${taken}`);
        return;
      }
      const res = await k.substrate.identity.registerIdentity(newController, commitment, aliceSigner());
      setStatus(`✓ registered in block ${res?.block?.number ?? "?"} (tx ${String(res?.txHash ?? "").slice(0, 10)}…)`);
      await refreshNextId();
    } catch (e) {
      setStatus(`✗ ${(e as Error).message.split("\n")[0]}`);
    } finally {
      setBusy(undefined);
    }
  }

  return (
    <section className="panel">
      <h2>② Substrate — pallet-kollectyve-id</h2>
      <p className="muted">Query and mutate the on-chain identity anchor.</p>

      <dl>
        <dt>Finalized block</dt>
        <dd>{block !== undefined ? `#${block}` : "…"}</dd>
        <dt>Next identity id</dt>
        <dd>{nextId?.toString() ?? "…"}</dd>
      </dl>

      <div className="row">
        <label>id</label>
        <input value={queryId} onChange={(e) => setQueryId(e.target.value)} inputMode="numeric" style={{ width: 64 }} />
        <button onClick={queryIdentity} disabled={!!busy}>query</button>
      </div>
      {controller && (
        <dl>
          <dt>tier</dt><dd>{tier ?? "—"}</dd>
          <dt>controller</dt><dd className="mono small">{controller}</dd>
        </dl>
      )}

      <div className="row">
        <label>controller</label>
        <input value={newController} onChange={(e) => setNewController(e.target.value)} className="mono small" />
      </div>
      <div className="row">
        <label>subject</label>
        <input value={subject} onChange={(e) => setSubject(e.target.value)} />
        <button onClick={register} disabled={!!busy}>Register identity (as Alice)</button>
      </div>
      {status && <p className="muted small">{status}</p>}
      <p className="muted small">
        <code>subject</code> is hashed into the PII-free <code>user_commitment</code> the pallet
        requires; each subject and each controller may back only one identity. Alice is sudo +
        enrollment key on <code>--dev</code>. Dev seed, never reuse.
      </p>
    </section>
  );
}
