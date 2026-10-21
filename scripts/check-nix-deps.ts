// scripts/check-nix-deps.ts — Keep .nix/bun.nix in sync with bun.lock
//
// Handy uses bun2nix to generate per-package Nix fetchurl expressions from
// bun.lock. This replaces the old FOD (Fixed-Output Derivation) approach
// where a single hash covered the entire node_modules — that hash would
// break whenever the bun version in nixpkgs changed, even without any
// dependency updates.
//
// How it works:
//   1. Computes sha256 of bun.lock
//   2. Compares with stored hash in .nix/bun-lock-hash
//   3. If they match — nothing to do (~2ms)
//   4. If they differ — prints a warning (never fails, never downloads)
//
// When it runs:
//   - Automatically via "postinstall" in package.json — triggers after every
//     bun install / bun add / bun remove / bun update
//   - Manually with --regenerate to rebuild .nix/bun.nix:
//       bun scripts/check-nix-deps.ts --regenerate
//     This runs the bun2nix version pinned in flake.lock: through
//     `nix run --inputs-from .` when Nix is installed, otherwise through
//     `bunx bun2nix@<that version>`. The install hook never runs it, so
//     `bun install` doesn't fetch and execute a package outside bun.lock.
//
// What to commit:
//   After --regenerate, commit the result together with bun.lock:
//     git add bun.lock .nix/bun.nix .nix/bun-lock-hash

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join, resolve } from "path";

const root = resolve(import.meta.dirname, "..");
const nixDir = join(root, ".nix");
const lockFile = join(root, "bun.lock");
const hashFile = join(nixDir, "bun-lock-hash");
const nixFile = join(nixDir, "bun.nix");

// Skip on Windows — bun2nix is Nix-only and hangs on Windows CI
if (process.platform === "win32") process.exit(0);

// No bun.lock — nothing to do
if (!existsSync(lockFile)) process.exit(0);

// Compute sha256 of the current bun.lock
const currentHash = new Bun.CryptoHasher("sha256")
  .update(readFileSync(lockFile))
  .digest("hex");

if (!process.argv.includes("--regenerate")) {
  // Read the previously stored hash (empty if first run)
  const storedHash = existsSync(hashFile)
    ? readFileSync(hashFile, "utf-8").trim()
    : "";

  if (currentHash !== storedHash) {
    console.warn(
      "[check-nix-deps] Warning: bun.lock has changed and .nix/bun.nix may be outdated.",
    );
    console.warn(
      "[check-nix-deps] To regenerate it: bun scripts/check-nix-deps.ts --regenerate",
    );
    console.warn(
      "[check-nix-deps] Non-Nix users: this is safe to ignore, CI will catch it.",
    );
  }
  // Exit 0 so that `bun install` is not blocked for non-Nix developers.
  // CI validates bun.nix independently.
  process.exit(0);
}

// Use the bun2nix release that flake.nix pins, so the generator is the same
// one the Nix build consumes and is never "latest".
const flakeLock = JSON.parse(readFileSync(join(root, "flake.lock"), "utf-8"));
const version: string | undefined = flakeLock.nodes?.bun2nix?.original?.ref;
if (!version) {
  console.error(
    "[check-nix-deps] Could not find the bun2nix version in flake.lock.",
  );
  process.exit(1);
}

const command = Bun.which("nix")
  ? [
      "nix",
      "--extra-experimental-features",
      "nix-command flakes",
      "run",
      "--inputs-from",
      ".",
      "bun2nix",
      "--",
      "-o",
      nixFile,
    ]
  : ["bunx", `bun2nix@${version}`, "-o", nixFile];

mkdirSync(nixDir, { recursive: true });
console.log(`[check-nix-deps] Running: ${command.join(" ")}`);

const result = Bun.spawnSync(command, {
  cwd: root,
  stdio: ["inherit", "inherit", "inherit"],
});

if (result.exitCode !== 0) {
  console.error(
    `[check-nix-deps] bun2nix ${version} failed; .nix/bun-lock-hash was not updated.`,
  );
  process.exit(1);
}

// The Nix-built binary omits the trailing newline that the npm package
// writes; normalize so both paths produce the same file.
const generated = readFileSync(nixFile, "utf-8");
if (!generated.endsWith("\n")) writeFileSync(nixFile, generated + "\n");

writeFileSync(hashFile, currentHash + "\n");
console.log(`[check-nix-deps] Updated ${nixFile}`);
console.log(
  "[check-nix-deps] Don't forget to commit: .nix/bun.nix .nix/bun-lock-hash",
);
