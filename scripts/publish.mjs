/**
 * Publish the workspace to npm in dependency order.
 *
 * Order matters: npm resolves each package's `@kollectyve/*` dependencies against the registry at
 * publish time, so a package must not go out before the ones it depends on. `--dry-run` (the
 * default) prints what would happen and packs each tarball without sending anything.
 *
 *   node scripts/publish.mjs                     # dry run
 *   node scripts/publish.mjs --yes               # publish (tags `latest` and `next`)
 *   node scripts/publish.mjs --yes --otp 123456  # if the account uses 2FA
 *
 * **On tags.** npm sets `latest` on a package's **first** publish no matter what `--tag` says —
 * it needs some default — so the original plan of "prereleases under `next`, never `latest`"
 * was not achievable, and 0.1.0-alpha.1 took `latest` anyway. Rather than leave `latest` frozen
 * on the oldest alpha (the worst outcome: a bare `npm i` gets the *stalest* build), every
 * release now moves both tags. `0.1.0-alpha.N` already says "unstable" in the version string;
 * keeping third parties off is the README's job and a deprecation notice's, not a tag's.
 *
 * npm requires either 2FA or a granular access token with "bypass 2FA" to publish. A granular
 * token in `~/.npmrc` is the better fit here — a release is six `npm publish` calls, and an OTP
 * can expire partway through, leaving a half-published set.
 *
 * Pre-flight: every package must build, every test must pass, and the version must not already
 * exist on the registry.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const DEPENDENCY_ORDER = [
  "packages/core",
  "packages/descriptors",
  "packages/evm",
  "packages/substrate",
  "packages/sdk",
  "packages/react",
];

const live = process.argv.includes("--yes");
const flag = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i === -1 ? fallback : process.argv[i + 1];
};
const tag = flag("--tag", "latest");
const otp = flag("--otp", undefined);
// Keep `next` pointing at the newest release too, so consumers pinning `@next` track head.
const alsoTagNext = tag === "latest";

const run = (cmd, args, opts = {}) => {
  // `stdio: "inherit"` returns null rather than captured output.
  const out = execFileSync(cmd, args, { encoding: "utf8", stdio: "pipe", ...opts });
  return typeof out === "string" ? out.trim() : "";
};

function published(name, version) {
  try {
    run("npm", ["view", `${name}@${version}`, "version"]);
    return true;
  } catch {
    return false; // 404 — not published, which is what we want.
  }
}

console.log(live ? `\nPUBLISHING (tag: ${tag})\n` : "\nDRY RUN — nothing will be sent\n");

const plan = DEPENDENCY_ORDER.map((dir) => {
  const pkg = JSON.parse(readFileSync(`${dir}/package.json`, "utf8"));
  return { dir, name: pkg.name, version: pkg.version };
});

let blocked = false;
for (const { dir, name, version } of plan) {
  if (published(name, version)) {
    console.error(`  ✗ ${name}@${version} is already on npm — bump the version`);
    blocked = true;
  } else {
    console.log(`  · ${name}@${version}  (${dir})`);
  }
}
if (blocked) process.exit(1);

console.log("\nbuilding and testing…");
run("npm", ["run", "build"], { stdio: "inherit" });
run("npm", ["test"], { stdio: "inherit" });

let sent = 0;
for (const { dir, name, version } of plan) {
  const args = ["publish", "--workspace", dir, "--access", "public", "--tag", tag];
  if (otp) args.push("--otp", otp);
  if (!live) args.push("--dry-run");
  console.log(`\n${live ? "publish" : "pack"} ${name}@${version}`);
  try {
    run("npm", args, { stdio: "inherit" });
    if (live && alsoTagNext) {
      run("npm", ["dist-tag", "add", `${name}@${version}`, "next"], { stdio: "inherit" });
    }
    sent++;
  } catch (error) {
    // Say plainly where it stopped: the packages already sent cannot be taken back, and the
    // rest still need to go out at this same version.
    console.error(
      `\n✗ failed on ${name}@${version}.` +
        (sent ? ` ${sent} package(s) were already published at this version and cannot be` +
          ` unpublished after 72h — fix the cause and re-run; already-published ones will be` +
          ` reported as existing.` : " Nothing was published."),
    );
    throw error;
  }
}

console.log(
  live
    ? "\npublished. Point consumers at the registry — e.g. in kumulus-backend-light's deno.json:\n" +
        '  "@kollectyve/sdk": "npm:@kollectyve/sdk@^0.1.0"\n'
    : "\ndry run complete. Re-run with --yes to publish.\n",
);
