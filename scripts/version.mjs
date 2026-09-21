/**
 * Set one version across every package in the workspace.
 *
 * All six packages ship together, so they share a version: independent versioning would buy
 * nothing and cost a dependency matrix to reason about at every release. This rewrites each
 * `version` and every internal `@kollectyve/*` range in lockstep, so they can never drift.
 *
 *   node scripts/version.mjs 0.1.0-alpha.2     # explicit
 *   node scripts/version.mjs prerelease        # 0.1.0-alpha.1 → 0.1.0-alpha.2
 *   node scripts/version.mjs patch|minor|major
 *
 * Stay on 0.x until the testnet API is frozen: semver already reads 0.x as "anything may break",
 * so a breaking change needs no agonising — bump the minor.
 */
import { readFileSync, writeFileSync } from "node:fs";

const PACKAGES = [
  "packages/core",
  "packages/descriptors",
  "packages/evm",
  "packages/substrate",
  "packages/sdk",
  "packages/react",
];

const arg = process.argv[2];
if (!arg) {
  console.error("usage: node scripts/version.mjs <version|patch|minor|major|prerelease>");
  process.exit(1);
}

const current = JSON.parse(readFileSync("packages/core/package.json", "utf8")).version;

/** Minimal semver bump — enough for 0.x with alpha prereleases, no dependency needed. */
function bump(version, kind) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(version);
  if (!match) throw new Error(`cannot parse current version "${version}"`);
  const [, major, minor, patch, pre] = match;
  const n = (v) => Number.parseInt(v, 10);

  switch (kind) {
    case "major":
      return `${n(major) + 1}.0.0`;
    case "minor":
      return `${n(major)}.${n(minor) + 1}.0`;
    case "patch":
      return pre ? `${n(major)}.${n(minor)}.${n(patch)}` : `${n(major)}.${n(minor)}.${n(patch) + 1}`;
    case "prerelease": {
      if (!pre) return `${n(major)}.${n(minor)}.${n(patch) + 1}-alpha.1`;
      const parts = pre.split(".");
      const last = Number.parseInt(parts[parts.length - 1], 10);
      if (Number.isNaN(last)) return `${major}.${minor}.${patch}-${pre}.1`;
      parts[parts.length - 1] = String(last + 1);
      return `${major}.${minor}.${patch}-${parts.join(".")}`;
    }
    default:
      if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(kind)) {
        throw new Error(`"${kind}" is neither a version nor patch|minor|major|prerelease`);
      }
      return kind;
  }
}

const next = bump(current, arg);
// A prerelease range has to be exact: `^0.1.0-alpha.1` does NOT match `0.1.0-alpha.2`, so a
// caret range across a prerelease bump would silently resolve siblings to a stale version.
const isPrerelease = next.includes("-");
const internalRange = isPrerelease ? next : `^${next}`;

console.log(`\n${current} → ${next}${isPrerelease ? "  (prerelease: exact internal ranges)" : ""}\n`);

for (const dir of PACKAGES) {
  const file = `${dir}/package.json`;
  const pkg = JSON.parse(readFileSync(file, "utf8"));
  pkg.version = next;
  for (const field of ["dependencies", "peerDependencies"]) {
    for (const dep of Object.keys(pkg[field] ?? {})) {
      if (dep.startsWith("@kollectyve/")) pkg[field][dep] = internalRange;
    }
  }
  writeFileSync(file, `${JSON.stringify(pkg, null, 2)}\n`);
  console.log(`  ${pkg.name.padEnd(32)} ${next}`);
}

console.log(
  `\nnext: npm install   (refresh the lockfile)\n` +
    `      npm run publish:dry\n` +
    `      npm run publish:all -- --tag ${isPrerelease ? "next" : "latest"}\n`,
);
