// Portable installs can't self-update in place (no installer, and Windows won't
// let a running exe replace itself). Instead the backend downloads the NSIS
// setup.exe for the running platform and architecture through the updater,
// which checks its signature, and starts it (`install_portable_update`).
//
// The webview only needs to know whether the manifest has such an installer.
// It never opens a URL from the manifest: the manifest isn't signed, so a URL
// taken from it could point at any file.

export const PORTABLE_RELEASES_URL =
  "https://github.com/cjpais/Handy/releases/latest";

/**
 * Whether the update manifest has an NSIS installer for the running target.
 * When it doesn't — e.g. a portable install on a platform Handy ships no NSIS
 * bundle for — the dialog falls back to the generic releases page.
 *
 * @param rawJson `Update.rawJson`, the deserialized `latest.json` manifest
 * @param platformName value from `@tauri-apps/plugin-os` `platform()`
 * @param archName value from `@tauri-apps/plugin-os` `arch()` ("x86_64", "aarch64")
 */
export function hasPortableInstaller(
  rawJson: Record<string, unknown> | undefined,
  platformName: string,
  archName: string,
): boolean {
  // NSIS is a Windows-only bundle; nothing else has an installer to run.
  if (platformName !== "windows") return false;

  const platforms = rawJson?.platforms;
  if (!platforms || typeof platforms !== "object") return false;

  const entry = (platforms as Record<string, unknown>)[
    `windows-${archName}-nsis`
  ];
  return !!entry && typeof entry === "object";
}
