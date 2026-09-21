import { describe, expect, it, vi } from "vitest";
import { TransactionError } from "@kollectyve/core";
import { isSigner, submitTx, toTxOptions } from "../src/tx.js";

const signer = { publicKey: new Uint8Array(32) } as never;

/** A fake PAPI transaction whose watch stream emits exactly the events given. */
const fakeTx = (events: unknown[], { fail, endEarly }: { fail?: unknown; endEarly?: boolean } = {}) => ({
  signAndSubmit: vi.fn(async () => ({ txHash: "0xdirect", ok: true }) as never),
  signSubmitAndWatch: () => ({
    subscribe(observer: { next: (v: never) => void; error: (e: unknown) => void; complete: () => void }) {
      queueMicrotask(() => {
        for (const e of events) observer.next(e as never);
        if (fail) observer.error(fail);
        else if (endEarly) observer.complete();
      });
      return { unsubscribe: vi.fn() };
    },
  }),
});

const finalized = {
  type: "finalized",
  txHash: "0xabc",
  ok: true,
  events: [],
  block: { hash: "0xblock", number: 42, index: 1 },
};

describe("option normalisation", () => {
  it("tells a signer apart from an options object", () => {
    expect(isSigner(signer)).toBe(true);
    expect(isSigner({ onProgress: () => {} })).toBe(false);
    expect(isSigner(undefined)).toBe(false);
  });

  it("lifts a bare signer into options", () => {
    expect(toTxOptions(signer)).toEqual({ signer });
    expect(toTxOptions()).toEqual({});
    const opts = { signer, onProgress: () => {} };
    expect(toTxOptions(opts)).toBe(opts);
  });
});

describe("submitTx", () => {
  it("takes the unwatched path when no progress handler is given", async () => {
    const tx = fakeTx([]);
    await submitTx(tx, signer);
    expect(tx.signAndSubmit).toHaveBeenCalledOnce();
  });

  it("streams every phase in order and resolves with the finalized payload", async () => {
    const phases: string[] = [];
    const result = await submitTx(
      fakeTx([
        { type: "signed", txHash: "0xabc" },
        { type: "broadcasted", txHash: "0xabc" },
        { type: "txBestBlocksState", txHash: "0xabc", found: true, ok: true, events: [], block: finalized.block },
        finalized,
      ]),
      signer,
      (p) => phases.push(p.phase),
    );
    expect(phases).toEqual(["signed", "broadcasted", "inBestBlock", "finalized"]);
    expect(result.block.number).toBe(42);
  });

  it("stays quiet while the tx is not in the best block", async () => {
    const phases: string[] = [];
    await submitTx(
      fakeTx([
        { type: "txBestBlocksState", txHash: "0xabc", found: false, isValid: true },
        finalized,
      ]),
      signer,
      (p) => phases.push(p.phase),
    );
    expect(phases).toEqual(["finalized"]);
  });

  it("resolves — not rejects — a call the runtime rejected, carrying the dispatch error", async () => {
    const dispatchError = { type: "Module", value: { type: "KollectyveId" } };
    const result = await submitTx(
      fakeTx([{ ...finalized, ok: false, dispatchError }]),
      signer,
      () => {},
    );
    expect(result.ok).toBe(false);
    expect(result.dispatchError).toEqual(dispatchError);
  });

  it("rejects with a TransactionError when the stream fails", async () => {
    await expect(
      submitTx(fakeTx([], { fail: new Error("dropped from the pool") }), signer, () => {}),
    ).rejects.toThrow(TransactionError);
  });

  it("rejects when the stream ends before finalization", async () => {
    await expect(submitTx(fakeTx([], { endEarly: true }), signer, () => {})).rejects.toThrow(
      /without being finalized/,
    );
  });
});

describe("connection readiness", () => {
  it("rejects with an actionable error instead of hanging on a dead endpoint", async () => {
    // Port 1 is never a Substrate node; the provider will retry it forever.
    const { SubstrateClient } = await import("../src/client.js");
    const client = new SubstrateClient({ substrateWs: "ws://127.0.0.1:1", connectionTimeout: 300 });
    await expect(client.ready()).rejects.toThrow(/no response from ws:\/\/127\.0\.0\.1:1/);
    client.destroy();
  });
});
