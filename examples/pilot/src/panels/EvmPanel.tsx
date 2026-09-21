import { useState } from "react";
import { createWalletClient, custom, type Address } from "viem";
import { useEvmBalance, useKollectyve, type ConnectedEvmWallet } from "@kollectyve/react";
import { EVM_DECIMALS } from "@kollectyve/sdk";
import { storageAbi, storageBytecode } from "../storage.js";

export function EvmPanel({ wallet }: { wallet: ConnectedEvmWallet | undefined }) {
  const k = useKollectyve();
  const balance = useEvmBalance(wallet?.address);

  const [address, setAddress] = useState<Address>();
  const [value, setValue] = useState<bigint>();
  const [busy, setBusy] = useState<string>();
  const [log, setLog] = useState<string[]>([]);
  const [input, setInput] = useState("42");

  const say = (m: string) => setLog((l) => [`${new Date().toLocaleTimeString()}  ${m}`, ...l].slice(0, 8));

  function walletClient() {
    if (!wallet) throw new Error("connect MetaMask first");
    return createWalletClient({ account: wallet.address, chain: k.evm.chain, transport: custom(wallet.provider) });
  }

  async function read(addr = address) {
    if (!addr) return;
    const v = await k.evm.public.readContract({ address: addr, abi: storageAbi, functionName: "retrieve" });
    setValue(v);
  }

  async function run(label: string, fn: () => Promise<void>) {
    try {
      setBusy(label);
      await fn();
    } catch (e) {
      say(`✗ ${label}: ${(e as Error).message.split("\n")[0]}`);
    } finally {
      setBusy(undefined);
    }
  }

  const deploy = () =>
    run("deploy", async () => {
      const hash = await walletClient().deployContract({ abi: storageAbi, bytecode: storageBytecode, args: [0n] });
      say(`deploy tx ${hash.slice(0, 10)}…`);
      const receipt = await k.evm.public.waitForTransactionReceipt({ hash });
      const addr = receipt.contractAddress!;
      setAddress(addr);
      say(`deployed at ${addr.slice(0, 10)}… (gas ${receipt.gasUsed})`);
      await read(addr);
    });

  const store = () =>
    run("store", async () => {
      const hash = await walletClient().writeContract({
        address: address!, abi: storageAbi, functionName: "store", args: [BigInt(input)],
      });
      await k.evm.public.waitForTransactionReceipt({ hash });
      say(`store(${input})`);
      await read();
    });

  const increment = () =>
    run("increment", async () => {
      const hash = await walletClient().writeContract({
        address: address!, abi: storageAbi, functionName: "increment",
      });
      await k.evm.public.waitForTransactionReceipt({ hash });
      say("increment()");
      await read();
    });

  return (
    <section className="panel">
      <h2>① EVM — pallet-revive</h2>
      <p className="muted">Deploy the Storage contract and drive it through MetaMask.</p>

      <dl>
        <dt>tRS balance</dt>
        <dd>{wallet ? (balance.loading ? "…" : `${balance.data?.formatted ?? "0"} tRS`) : "connect wallet"}</dd>
        <dt>Contract</dt>
        <dd>{address ? `${address.slice(0, 10)}…` : "not deployed"}</dd>
        <dt>Stored value</dt>
        <dd className="big">{value?.toString() ?? "—"}</dd>
      </dl>

      <div className="row">
        <button onClick={deploy} disabled={!wallet || !!busy}>Deploy Storage</button>
        <input value={input} onChange={(e) => setInput(e.target.value)} inputMode="numeric" style={{ width: 72 }} />
        <button onClick={store} disabled={!address || !!busy}>store</button>
        <button onClick={increment} disabled={!address || !!busy}>increment</button>
        <button onClick={() => read()} disabled={!address || !!busy}>retrieve</button>
      </div>
      {busy && <p className="muted">⏳ {busy}…</p>}

      <ul className="log">{log.map((l, i) => <li key={i}>{l}</li>)}</ul>
      <p className="muted small">Native balance shows {EVM_DECIMALS} decimals (ETH-style).</p>
    </section>
  );
}
