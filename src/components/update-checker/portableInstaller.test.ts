// Standalone assert check (no JS unit-test runner in this repo). Run with:
//   bun src/components/update-checker/portableInstaller.test.ts
import assert from "node:assert";
import { hasPortableInstaller } from "./portableInstaller";

// Trimmed copy of the real latest.json served from the updater endpoint.
const manifest = {
  version: "0.9.5",
  platforms: {
    "windows-x86_64-nsis": {
      url: "https://github.com/cjpais/Handy/releases/download/v0.9.5/Handy_0.9.5_x64-setup.exe",
      signature: "…",
    },
    "windows-x86_64-msi": {
      url: "https://github.com/cjpais/Handy/releases/download/v0.9.5/Handy_0.9.5_x64_en-US.msi",
    },
    "windows-aarch64-nsis": {
      url: "https://github.com/cjpais/Handy/releases/download/v0.9.5/Handy_0.9.5_arm64-setup.exe",
      signature: "…",
    },
    "darwin-aarch64": {
      url: "https://github.com/cjpais/Handy/releases/download/v0.9.5/Handy_aarch64.app.tar.gz",
    },
  },
};

// x64 and arm64 Windows -> an NSIS installer is available
assert.equal(hasPortableInstaller(manifest, "windows", "x86_64"), true);
assert.equal(hasPortableInstaller(manifest, "windows", "aarch64"), true);

// no manifest (check() failed or returned no update) -> releases page fallback
assert.equal(hasPortableInstaller(undefined, "windows", "x86_64"), false);

// no NSIS bundle for this arch -> releases page fallback
assert.equal(hasPortableInstaller(manifest, "windows", "x86"), false);

// non-Windows portable install -> releases page, never a Windows .exe
assert.equal(hasPortableInstaller(manifest, "macos", "aarch64"), false);

// malformed manifest -> releases page fallback
assert.equal(
  hasPortableInstaller({ platforms: "nope" }, "windows", "x86_64"),
  false,
);

console.log("portableInstaller: all assertions passed");
