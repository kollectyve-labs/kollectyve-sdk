import { useEffect, useState } from "react";
import { useConnectWallet, useEvmBalance, useKollectyve } from "@kollectyve/react";
import { createWalletClient, custom, getContract, type Address } from "viem";
import { storageAbi, storageBytecode } from "../storage.js";

export function EvmPanel() {
  const k = useKollectyve();
  const { wallet, connect, connecting, error } = useConnectWallet();
  const { data: balance, refetch } = useEvmBalance(wallet?.address);

  const [address, setAddress] = useState<Address>();
  const [value, setValue] = useState<bigint>();
  const [busy, setBusy] = useState<string>();
  const [status, setStatus] = useState<string>();

  // A wallet client bound to the injected provider — the SDK's own client is read-only here
  // because we did not hand it a signer.
  const walletClient = wallet
    ? createWalletClient({ chain: k.evm.chain, transport: custom(wallet.provider), account: wallet.address })
    : undefined;

  const read = async (at: Address) => {
    const contract = getContract({ address: at, abi: storageAbi, client: { public: k.evm.public } });
    setValue(await contract.read.retrieve());
  };

  useEffect(() => {
    if (address) void read(address).catch(() => {});
  }, [address]); // eslint-disable-line react-hooks/exhaustive-deps

  async function deploy() {
    if (!walletClient) return;
    setBusy("deploy");
    setStatus("confirm in MetaMask…");
    try {
      const hash = await walletClient.deployContract({
        abi: storageAbi,
        bytecode: storageBytecode,
        args: [42n],
      });
      setStatus(`deploying… ${hash.slice(0, 12)}…`);
      const receipt = await k.evm.public.waitForTransactionReceipt({ hash });
      if (!receipt.contractAddress) throw new Error("no contract address in receipt");
      setAddress(receipt.contractAddress);
      setStatus(`deployed at ${receipt.contractAddress}`);
      refetch();
    } catch (e) {
      setStatus(`✗ ${(e as Error).message.split("\n")[0]}`);
    } finally {
      setBusy(undefined);
    }
  }

  async function increment() {
    if (!walletClient || !address) return;
    setBusy("increment");
    setStatus("confirm in MetaMask…");
    try {
      const hash = await walletClient.writeContract({
        address,
        abi: storageAbi,
        functionName: "increment",
      });
      await k.evm.public.waitForTransactionReceipt({ hash });
      await read(address);
      setStatus("incremented");
      refetch();
    } catch (e) {
      setStatus(`✗ ${(e as Error).message.split("\n")[0]}`);
    } finally {
      setBusy(undefined);
    }
  }

  return (
    <section className="panel">
      <h2>EVM · pallet-revive</h2>

      {wallet ? (
        <dl>
          <dt>Account</dt>
          <dd className="mono small">{wallet.address}</dd>
          <dt>Balance</dt>
          <dd>{balance ? `${balance.formatted} tRS` : "…"}</dd>
        </dl>
      ) : (
        <>
          <button onClick={connect} disabled={connecting}>
            {connecting ? "Connecting…" : "Connect MetaMask"}
          </button>
          <p className="muted small">
            Adds the Kollectyve network (chain id 28000) if your wallet does not have it.
          </p>
        </>
      )}
      {error && <p className="error small">{error.message}</p>}

      <h3>Storage contract</h3>
      <p className="muted small">
        Solidity on a Substrate chain: deploy, then read and write through the same eth-rpc proxy
        MetaMask is talking to.
      </p>
      <div className="row">
        <button onClick={deploy} disabled={!wallet || !!busy}>
          Deploy
        </button>
        <button onClick={increment} disabled={!wallet || !address || !!busy}>
          increment()
        </button>
      </div>
      {address && (
        <dl>
          <dt>Contract</dt>
          <dd className="mono small">{address}</dd>
          <dt>retrieve()</dt>
          <dd>{value?.toString() ?? "…"}</dd>
        </dl>
      )}
      {status && <p className="small">{status}</p>}
    </section>
  );
}
