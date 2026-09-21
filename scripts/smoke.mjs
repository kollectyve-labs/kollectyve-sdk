/**
 * End-to-end smoke test against a running dev chain.
 *
 *   cd kollectyve-chain && ./scripts/dev-chain.sh
 *   cd kollectyve-sdk   && npm run build && npm run smoke
 *
 * Exercises every façade call and both sides of the address bridge against real state, which
 * is the one thing type-checking cannot do: it proves the SDK's SCALE encodings are what the
 * runtime actually accepts. Writes are signed by Alice, who on a `--dev` chain is sudo and
 * both the enrollment and compliance key.
 *
 * Safe to re-run: identities are keyed by a per-run random nonce, so nothing collides.
 *
 * That nonce is deliberately alphanumeric. `@polkadot-labs/hdkd-helpers` parses derivation
 * paths with `/(\/{1,2})(\w+)/g`, so a junction is silently truncated at the first character
 * outside `[A-Za-z0-9_]` — `//Smoke//run-1-a` and `//Smoke//run-2-b` derive the *same* account,
 * and registering the second one fails with `AlreadyRegistered`. Junctions over 31 bytes throw
 * `RangeError` from `createChainCode` rather than being hashed. Dev-key plumbing only; nothing
 * in the SDK derives keys.
 */
import { sr25519CreateDerive } from "@polkadot-labs/hdkd";
import { DEV_PHRASE, entropyToMiniSecret, mnemonicToEntropy } from "@polkadot-labs/hdkd-helpers";
import {
  KollectyveClient,
  DEV_ACCOUNTS,
  WsEvent,
  devSigner,
  encodeSs58,
  signerFromKeypair,
  signerFromKeyProvider,
  userCommitment,
} from "@kollectyve/sdk";
import { FixedSizeBinary } from "polkadot-api";
import { getContract, parseEther } from "viem";
import { storageAbi, storageBytecode } from "./storage-contract.mjs";

/** The SDK keeps `h256` internal, so the raw-call example below builds it directly. */
const h256Hex = (hex) => FixedSizeBinary.fromHex(hex);

const WS = process.env.KOLLECTYVE_WS ?? "ws://127.0.0.1:9944";
const ETH = process.env.KOLLECTYVE_ETH_RPC ?? "http://127.0.0.1:8545";

const derive = sr25519CreateDerive(entropyToMiniSecret(mnemonicToEntropy(DEV_PHRASE)));
const keypair = (path) => derive(path);

const alice = keypair("//Alice");
const aliceSigner = devSigner("Alice");

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`${ok ? "  ✓" : "  ✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

/**
 * Await an extrinsic and assert it actually dispatched. PAPI resolves `signAndSubmit` for an
 * *included* transaction, so a call that was rejected by the pallet still returns a block —
 * `ok` and `dispatchError` are what say whether the state changed.
 */
const submit = async (label, tx) => {
  if (lost) throw new Error("lost the connection to the node mid-run");
  const res = await tx;
  const err = res.dispatchError
    ? `${res.dispatchError.type}${res.dispatchError.value?.type ? `.${res.dispatchError.value.type}` : ""}` +
      `${res.dispatchError.value?.value?.type ? `.${res.dispatchError.value.value.type}` : ""}`
    : "";
  check(label, res.ok === true, err || `block #${res.block?.number}`);
  return res;
};

// The ws provider reconnects forever by design, so without this the script would hang in
// silence when the node is not there. `onConnectionStatus` is the SDK's hook for exactly that.
let lost = false;
/** Poll `fn` until it returns something truthy, or give up. */
const waitFor = async (fn, timeoutMs) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const hit = fn();
    if (hit) return hit;
    await new Promise((r) => setTimeout(r, 500));
  }
  return undefined;
};

const k = new KollectyveClient({
  network: { substrateWs: WS, ethRpc: ETH },
  substrateSigner: aliceSigner,
  // alith is genesis-funded on any --dev chain; needed to deploy the sample contract.
  evmSigner: { privateKey: DEV_ACCOUNTS.alith.privateKey },
  onConnectionStatus: (s) => {
    if (s.type === WsEvent.CLOSE || s.type === WsEvent.ERROR) lost = true;
  },
});

const connected = await Promise.race([
  k.substrate.client.client.getFinalizedBlock().then(() => true),
  new Promise((r) => setTimeout(() => r(false), 15_000)),
]);
if (!connected) {
  console.error(`\ncannot reach the node at ${WS} — start it with kollectyve-chain/scripts/dev-chain.sh\n`);
  k.destroy();
  process.exit(1);
}

try {
  // ---- EVM side -----------------------------------------------------------------
  console.log("\nEVM (pallet-revive via eth-rpc)");
  const chainId = await k.evm.public.getChainId();
  check("chain id is 28000", chainId === 28000, String(chainId));
  const head = await k.evm.public.getBlockNumber();
  check("eth_blockNumber responds", head >= 0n, `#${head}`);
  const bal = await k.evm.public.getBalance({ address: DEV_ACCOUNTS.alith.evm });
  check("alith is funded at genesis", bal > 0n, `${bal} wei (18 dp)`);

  // ---- EVM contracts (pallet-revive) ---------------------------------------------
  console.log("\nEVM contracts");
  // Deploying proves pallet-revive executes real Solidity, not just that the proxy answers.
  const deployHash = await k.evm.wallet.deployContract({
    abi: storageAbi,
    bytecode: storageBytecode,
    args: [42n],
  });
  const deployed = await k.evm.public.waitForTransactionReceipt({ hash: deployHash });
  check("Storage deployed", deployed.status === "success" && !!deployed.contractAddress,
    deployed.contractAddress ?? deployed.status);

  const storage = getContract({
    address: deployed.contractAddress,
    abi: storageAbi,
    client: { public: k.evm.public, wallet: k.evm.wallet },
  });
  check("constructor arg round-trips", (await storage.read.retrieve()) === 42n);

  const storeHash = await storage.write.store([7n]);
  await k.evm.public.waitForTransactionReceipt({ hash: storeHash });
  check("store() wrote state", (await storage.read.retrieve()) === 7n);

  const incHash = await storage.write.increment();
  const incReceipt = await k.evm.public.waitForTransactionReceipt({ hash: incHash });
  check("increment() wrote state", (await storage.read.retrieve()) === 8n);

  const logs = await k.evm.public.getContractEvents({
    abi: storageAbi,
    address: deployed.contractAddress,
    eventName: "NumberChanged",
    fromBlock: deployed.blockNumber,
  });
  check("NumberChanged events are indexed", logs.length >= 2, `${logs.length} events`);
  check("event payload decodes", logs.at(-1)?.args?.newValue === 8n,
    String(logs.at(-1)?.args?.newValue));
  check("receipt reports gas used", incReceipt.gasUsed > 0n, `${incReceipt.gasUsed}`);

  // ---- address bridge -----------------------------------------------------------
  console.log("\nAddress bridge");
  const ss58 = k.addresses.evmToSs58(DEV_ACCOUNTS.alith.evm);
  const back = k.addresses.ss58ToEvm(ss58);
  check("H160 → SS58 → H160 round-trips", back.toLowerCase() === DEV_ACCOUNTS.alith.evm.toLowerCase(), ss58);
  const asAccountId = k.addresses.evmToAccountId32(DEV_ACCOUNTS.alith.evm);
  check("H160 maps to the 0xEE-suffixed AccountId32", asAccountId.endsWith("ee".repeat(12)), asAccountId);

  // ---- identity anchor ----------------------------------------------------------
  console.log("\npallet-kollectyve-id");
  const enrollment = await k.substrate.identity.enrollmentKey();
  const compliance = await k.substrate.identity.complianceKey();
  check("enrollment key is set at genesis", !!enrollment, enrollment);
  check("compliance key is set at genesis", !!compliance, compliance);

  const before = await k.substrate.identity.nextId();
  const nonce = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const subject = `smoke_${nonce}`;
  const commitment = userCommitment(subject);
  check("commitment is unused", (await k.substrate.identity.identityForCommitment(commitment)) === undefined);

  // A fresh controller each run, so `AlreadyRegistered` never fires.
  const controller = keypair(`//Smoke//${nonce}`);
  const controllerAddress = encodeSs58(controller.publicKey);

  await submit("register_identity dispatched", k.substrate.identity.registerIdentity(controllerAddress, commitment));

  const id = before;
  check("next id advanced", (await k.substrate.identity.nextId()) === id + 1n, `#${id} → #${id + 1n}`);
  check("controllerOf resolves", (await k.substrate.identity.controllerOf(id)) === controllerAddress);
  check("identityOf is the reverse index", (await k.substrate.identity.identityOf(controllerAddress)) === id);
  check("commitment is now bound", (await k.substrate.identity.identityForCommitment(commitment)) === id);
  check("new identity starts at tier None", (await k.substrate.identity.tierOf(id)) === "None");

  await submit("set_tier dispatched", k.substrate.identity.setTier(id, "Verified"));
  check("set_tier applied", (await k.substrate.identity.tierOf(id)) === "Verified");

  // ---- events + tx progress -----------------------------------------------------
  console.log("\nevents & tx progress");
  const seen = [];
  const unsubscribe = k.substrate.identity.onIdentityRegistered((e) => seen.push(e), {
    onError: (err) => console.error("  event subscription error:", err),
  });

  const nonce2 = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const commitment2 = userCommitment(`smoke_${nonce2}`);
  const controller2 = encodeSs58(keypair(`//Smoke//${nonce2}`).publicKey);
  const phases = [];
  await submit(
    "watched register_identity dispatched",
    k.substrate.identity.registerIdentity(controller2, commitment2, {
      signer: aliceSigner,
      onProgress: (p) => {
        if (phases[phases.length - 1] !== p.phase) phases.push(p.phase);
      },
    }),
  );
  check(
    "progress streamed every phase in order",
    phases.join(" → ") === "signed → broadcasted → inBestBlock → finalized",
    phases.join(" → ") || "(nothing streamed)",
  );

  const delivered = await waitFor(() => seen.find((e) => e.payload.commitment === commitment2), 40_000);
  check("IdentityRegistered event delivered to the subscriber", !!delivered);
  check(
    "event payload decodes id, controller and commitment",
    delivered?.payload.controller === controller2 && typeof delivered?.payload.id === "bigint",
    delivered ? `#${delivered.payload.id} in block #${delivered.block?.number}` : "",
  );
  unsubscribe();

  const before2 = seen.length;
  await submit(
    "register after unsubscribe",
    k.substrate.identity.registerIdentity(
      encodeSs58(keypair(`//Smoke//x${nonce2}`).publicKey),
      userCommitment(`smoke_x${nonce2}`),
    ),
  );
  check("unsubscribe actually stops delivery", seen.length === before2, `${seen.length - before2} extra`);

  // ---- policy -------------------------------------------------------------------
  console.log("\npallet-kollectyve-policy");
  const claim = { tier: "Verified", jurisdiction: 686, accredited: false, expiresAt: 1893456000000n };
  await submit("set_claim dispatched", k.substrate.policy.setClaim(id, claim));
  const readClaim = await k.substrate.policy.claimOf(id);
  check(
    "set_claim round-trips every field",
    readClaim?.tier === claim.tier &&
      readClaim?.jurisdiction === claim.jurisdiction &&
      readClaim?.accredited === claim.accredited &&
      readClaim?.expiresAt === claim.expiresAt,
    JSON.stringify(readClaim, (_, v) => (typeof v === "bigint" ? `${v}` : v)),
  );

  const assetId = 1;
  const policy = {
    minTier: "Basic",
    requireAccredited: false,
    allowedJurisdictions: [686, 250],
    blockedJurisdictions: [],
    frozen: false,
  };
  await submit("set_asset_policy dispatched", k.substrate.policy.setAssetPolicy(assetId, policy));
  const readPolicy = await k.substrate.policy.assetPolicy(assetId);
  check(
    "set_asset_policy round-trips",
    readPolicy?.minTier === "Basic" && readPolicy?.allowedJurisdictions.join() === "686,250",
    JSON.stringify(readPolicy),
  );

  await submit("set_frozen dispatched", k.substrate.policy.setFrozen(assetId, true));
  check("set_frozen flips the flag", (await k.substrate.policy.assetPolicy(assetId))?.frozen === true);
  await k.substrate.policy.setFrozen(assetId, false);

  await submit("revoke_claim dispatched", k.substrate.policy.revokeClaim(id));
  check("revoke_claim clears it", (await k.substrate.policy.claimOf(id)) === undefined);

  // ---- signers & idempotent enrolment ---------------------------------------------
  console.log("\nsigners & enrolment");
  check("devSigner derives the same account as the raw keypair", 
    Buffer.from(aliceSigner.publicKey).toString("hex") === Buffer.from(alice.publicKey).toString("hex"));

  // A remote signer: the "key provider" here just wraps the local keypair, but the SDK only
  // ever sees a public key and an async sign callback — the shape a Vault/KMS backend uses.
  let remoteCalls = 0;
  const remote = signerFromKeyProvider(alice.publicKey, async (payload) => {
    remoteCalls++;
    return alice.sign(payload);
  }, "Sr25519");
  const subject3 = `smoke_kp${Date.now().toString(36)}`;
  const controller3 = encodeSs58(keypair(`//Smoke//kp${Date.now().toString(36)}`).publicKey);
  const enrolled = await k.substrate.identity.enroll(controller3, subject3, remote);
  check("enroll minted an identity via a remote signer", enrolled.created === true, `#${enrolled.id}`);
  check("the remote key provider was actually used", remoteCalls > 0, `${remoteCalls} signature(s)`);

  const again = await k.substrate.identity.enroll(controller3, subject3, remote);
  check(
    "enroll is idempotent — a retry returns the same identity",
    again.created === false && again.id === enrolled.id,
    `#${again.id}, created: ${again.created}`,
  );
  check("enrolled identity resolves on-chain", (await k.substrate.identity.controllerOf(enrolled.id)) === controller3);

  const localSigner = signerFromKeypair(alice);
  check("signerFromKeypair wraps a local key", 
    Buffer.from(localSigner.publicKey).toString("hex") === Buffer.from(alice.publicKey).toString("hex"));

  // ---- balances & sudo (what a product backend needs) -----------------------------
  console.log("\nbalances & sudo enrolment");
  const funded = encodeSs58(keypair(`//Smoke//fund${Date.now().toString(36)}`).publicKey);
  check("a fresh account starts empty", (await k.substrate.balances.freeBalance(funded)) === 0n);
  await submit("transfer_keep_alive dispatched", k.substrate.balances.transferKeepAlive(funded, 1_000_000_000_000n));
  check("funded account can now pay its own fees",
    (await k.substrate.balances.freeBalance(funded)) === 1_000_000_000_000n,
    `${await k.substrate.balances.freeBalance(funded)} planck`);
  check("funder balance is readable", (await k.substrate.balances.freeBalance(encodeSs58(alice.publicKey))) > 0n);

  // The `EnsureRoot` arm of EnrollmentOrigin — how a backend enrols on a chain whose
  // `enrollmentKey` was never wired in the chain spec.
  const sc = k.substrate.client;
  const nonceS = `s${Date.now().toString(36)}`;
  const commitmentS = userCommitment(`smoke_${nonceS}`);
  const controllerS = encodeSs58(keypair(`//Smoke//${nonceS}`).publicKey);
  const sudoResult = await submit(
    "sudo-wrapped register_identity dispatched",
    sc.submit(
      sc.sudo(sc.api.tx.KollectyveId.register_identity({
        controller: controllerS,
        user_commitment: h256Hex(commitmentS),
      })),
      aliceSigner,
    ),
  );
  check("the inner sudo call succeeded too", sc.sudoFailed(sudoResult) === false);
  check("sudo path anchored the identity",
    (await k.substrate.identity.identityForCommitment(commitmentS)) !== undefined);

  // ---- kumulus ------------------------------------------------------------------
  console.log("\npallet-kumulus");
  // The provider record is keyed by the *signer's* identity, so Alice needs one of her own.
  const aliceAddress = encodeSs58(alice.publicKey);
  let aliceId = await k.substrate.identity.identityOf(aliceAddress);
  if (aliceId === undefined) {
    aliceId = await k.substrate.identity.nextId();
    await submit("register_identity for Alice", k.substrate.identity.registerIdentity(aliceAddress, userCommitment(`alice_${nonce}`)));
  }
  check("Alice controls an identity", (await k.substrate.identity.identityOf(aliceAddress)) === aliceId, `#${aliceId}`);

  const specs = { cpuCores: 8, memoryMb: 16384, storageGb: 512, region: 686 };
  await submit("register_provider dispatched", k.substrate.kumulus.registerProvider(specs, aliceSigner));
  const provider = await k.substrate.kumulus.providerOf(aliceId);
  check(
    "register_provider round-trips specs",
    provider?.active === true &&
      provider?.specs.cpuCores === specs.cpuCores &&
      provider?.specs.memoryMb === specs.memoryMb &&
      provider?.specs.storageGb === specs.storageGb &&
      provider?.specs.region === specs.region,
    JSON.stringify(provider),
  );
} catch (e) {
  failures++;
  console.error("\n✗ threw:", e?.message ?? e);
  if (process.env.DEBUG) console.error(e);
} finally {
  k.destroy();
}

console.log(failures === 0 ? "\nall checks passed\n" : `\n${failures} check(s) failed\n`);
process.exit(failures === 0 ? 0 : 1);
