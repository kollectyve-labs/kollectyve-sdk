import { useEffect, useState } from "react";
import {
  useChainEvents,
  useKollectyve,
  useSubstrateWallet,
  useTx,
} from "@kollectyve/react";
import { WsEvent, getSubstrateWallets, type IdentityRegistered } from "@kollectyve/sdk";

/** 1 UNIT = 1e12 planck. */
const UNIT = 1_000_000_000_000n;

export function SubstratePanel() {
  const k = useKollectyve();
  const { accounts, selected, select, connect, connecting, error } = useSubstrateWallet("Kollectyve demo");

  const [block, setBlock] = useState<number>();
  const [connError, setConnError] = useState<string>();
  const [wallets, setWallets] = useState<string[]>([]);
  const [tried, setTried] = useState(false);
  const [nextId, setNextId] = useState<bigint>();
  const [balance, setBalance] = useState<bigint>();
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("0.1");

  // Live head. Errors are surfaced rather than swallowed — a silent "connecting…" tells you
  // nothing about whether the socket is down, the endpoint is wrong, or the node is gone.
  useEffect(() => {
    let alive = true;
    const tick = () =>
      k.substrate.client.client
        .getFinalizedBlock()
        .then((b) => {
          if (!alive) return;
          setBlock(b.number);
          setConnError(undefined);
        })
        .catch((e) => alive && setConnError((e as Error)?.message ?? String(e)));
    tick();
    const id = setInterval(tick, 6000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [k]);

  // Which wallet extensions the page can see. Extensions inject asynchronously, so poll briefly
  // rather than reading once on mount and concluding there are none.
  useEffect(() => {
    const read = () => setWallets(getSubstrateWallets());
    read();
    const id = setInterval(read, 1000);
    const stop = setTimeout(() => clearInterval(id), 8000);
    return () => {
      clearInterval(id);
      clearTimeout(stop);
    };
  }, []);

  useEffect(() => {
    k.substrate.identity
      .nextId()
      .then(setNextId)
      .catch((e) => setConnError((e as Error)?.message ?? String(e)));
  }, [k]);

  // Balance of whichever account the user picked in their extension.
  useEffect(() => {
    if (!selected) return setBalance(undefined);
    let alive = true;
    k.substrate.balances
      .freeBalance(selected.address)
      .then((b) => alive && setBalance(b))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [k, selected]);

  // Finalized identity registrations, delivered as they happen.
  const { events } = useChainEvents<IdentityRegistered>(
    (client, onEvent) => client.substrate.identity.onIdentityRegistered(onEvent),
    { limit: 5 },
  );

  const { submit, progress, pending, result, error: txError } = useTx(selected?.polkadotSigner);

  async function transfer() {
    const planck = BigInt(Math.round(Number.parseFloat(amount) * 1e12));
    await submit((client, options) => client.substrate.balances.transferKeepAlive(to, planck, options));
  }

  return (
    <section className="panel">
      <h2>Substrate</h2>

      <dl>
        <dt>Endpoint</dt>
        <dd className="mono small">{k.substrate.client.endpoint}</dd>
        <dt>Socket</dt>
        <dd>
          {k.substrate.client.connected
            ? "connected"
            : WsEvent[k.substrate.client.connectionStatus?.type ?? WsEvent.CONNECTING]?.toLowerCase() ??
              "connecting"}
        </dd>
        <dt>Finalized block</dt>
        <dd>{block !== undefined ? `#${block}` : "connecting…"}</dd>
        <dt>Next identity id</dt>
        <dd>{nextId?.toString() ?? "…"}</dd>
        <dt>Descriptors</dt>
        <dd>
          {k.substrate.client.descriptorChain.specName} v
          {k.substrate.client.descriptorChain.specVersion}
        </dd>
      </dl>

      {connError && <p className="error small">chain: {connError}</p>}

      <h3>Wallet</h3>
      <p className="muted small">
        extensions detected: {wallets.length ? wallets.join(", ") : "none yet"}
      </p>

      {accounts.length > 0 ? (
        <>
          <select value={selected?.address ?? ""} onChange={(e) => select(e.target.value)}>
            {accounts.map((a) => (
              <option key={a.address} value={a.address}>
                {a.name ?? a.address.slice(0, 8)} — {a.address.slice(0, 10)}…
              </option>
            ))}
          </select>
          <p className="muted small">
            {accounts.length} account{accounts.length > 1 ? "s" : ""} · balance:{" "}
            {balance === undefined ? "…" : `${Number(balance) / Number(UNIT)} tRS`}
          </p>
        </>
      ) : (
        <>
          <button
            onClick={() => {
              setTried(true);
              void connect();
            }}
            disabled={connecting || wallets.length === 0}
          >
            {connecting ? "Connecting…" : "Connect Substrate wallet"}
          </button>
          {wallets.length === 0 && (
            <p className="muted small">
              No extension visible on this page. Install Polkadot-JS, Talisman or SubWallet, then
              reload.
            </p>
          )}
          {/*
            The state that previously looked like "nothing happened": the extension connected
            fine but handed back no accounts, so the button simply re-rendered unchanged.
          */}
          {tried && !connecting && !error && (
            <p className="error small">
              Connected to <code>{wallets.join(", ")}</code> but it shared <strong>no accounts</strong>.
              Open the extension → Settings → <em>Manage website access</em> → allow{" "}
              <code>localhost:5173</code>, and make sure at least one account is visible to it.
              If you dismissed the authorisation popup earlier, the site stays denied until you
              change it there.
            </p>
          )}
        </>
      )}
      {error && <p className="error small">wallet: {error.message}</p>}

      <h3>Transfer</h3>
      <p className="muted small">
        A permissionless write, so any funded account can try it. Watch the phases: signed →
        broadcasted → inBestBlock → finalized.
      </p>
      <div className="row">
        <input placeholder="destination SS58" value={to} onChange={(e) => setTo(e.target.value)} />
        <input
          className="amount"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          inputMode="decimal"
        />
        <button onClick={transfer} disabled={!selected || !to || pending}>
          {pending ? "Submitting…" : "Send"}
        </button>
      </div>
      {progress && (
        <p className="small">
          <code>{progress.phase}</code>
          {progress.block ? ` · block #${progress.block.number}` : ""}
          {progress.ok === false ? ` · failed: ${JSON.stringify(progress.dispatchError)}` : ""}
        </p>
      )}
      {result?.ok && <p className="ok small">finalized in block #{result.block.number}</p>}
      {txError && <p className="error small">{txError.message}</p>}

      <h3>Live events</h3>
      <p className="muted small">
        <code>KollectyveId.IdentityRegistered</code>, from finalized blocks.
      </p>
      {events.length === 0 ? (
        <p className="muted small">none yet — they appear as identities are enrolled</p>
      ) : (
        <ul className="small">
          {events.map((e, i) => (
            <li key={i}>
              #{e.payload.id.toString()} → <code>{e.payload.controller.slice(0, 12)}…</code> (block{" "}
              {e.block.number})
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
