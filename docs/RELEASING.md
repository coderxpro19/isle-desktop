# Releasing Isle

1. Bump `version` in `package.json`, `src-tauri/tauri.conf.json` and `src-tauri/Cargo.toml`.
2. Push to `main`. CI builds, tests, and — because the version is new — publishes a
   GitHub Release `vX.Y.Z` with the installers and `latest.json`.
3. Installed copies of Isle find `latest.json` (via `releases/latest/download/latest.json`),
   show "Isle X.Y.Z is available" in the island, and update in place with one click.

## Updater signing

Updates are signed with a minisign key (separate from Windows code signing).
The public key lives in `tauri.conf.json → plugins.updater.pubkey`. CI needs two repo secrets:

| Secret | Value |
|---|---|
| `TAURI_SIGNING_PRIVATE_KEY` | contents of the private key file |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | its password |

Without them CI still builds, but releases carry no `latest.json`, so apps won't auto-update.
**Never lose the private key** — installed apps only accept updates signed with it.
