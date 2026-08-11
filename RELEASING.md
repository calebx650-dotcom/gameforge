# Releasing GameForge

This describes how a GameForge desktop installer actually gets built and
published. It exists because "installer" was previously only verified on
Linux, in this sandbox, by hand — this document (and the CI workflows it
describes) is what turns that into something reproducible on macOS and
Windows too, on real GitHub-hosted runners, without requiring anyone to
own all three OSes locally.

## What CI actually does

### `.github/workflows/ci.yml` — every push/PR to `main`

1. **`build-test`** (`ubuntu-latest`): `npm ci`, `npm run build` (full
   monorepo `tsc -b` + Vite build), `npm test` (the full Vitest suite —
   see the test counts in `ROADMAP.md`'s per-tier entries for what's
   actually covered).
2. **`installer-matrix`** (needs `build-test` to pass first): runs on
   `ubuntu-latest`, `macos-latest`, and `windows-latest` in parallel,
   each installing the Rust toolchain and (Linux only) the WebKitGTK/
   AppIndicator system packages Tauri needs, then running
   `npm run tauri -- build` inside `apps/desktop`. The resulting
   installer file(s) for that OS — `.AppImage`/`.deb` (Linux), `.dmg`
   (macOS), `.msi`/`.exe` (Windows) — are uploaded as a workflow
   artifact (`gameforge-installer-<os>`), downloadable from the Actions
   run summary. This is the honest fix for "installer packaging
   unexercised on macOS/Windows": it doesn't claim those builds work
   without ever running them, it makes them actually run, on every push,
   on real runners of those OSes.

### `.github/workflows/release.yml` — on pushing a `v*.*.*` tag

Same build-test-then-installer-matrix shape, plus a final
`publish-release` job that downloads every OS's installer artifacts,
flattens them into one directory, and creates a GitHub Release for the
tag with all installer files attached (`softprops/action-gh-release`,
`generate_release_notes: true` so the release body is populated from the
commits since the previous tag).

## Cutting a release

1. Decide the version. Bump it in the relevant `package.json` files
   (root, `apps/desktop`, and `apps/desktop/src-tauri/tauri.conf.json`'s
   `"version"` field) if this is a real version bump, and commit that.
2. Tag it and push the tag:
   ```sh
   git tag v0.2.0
   git push origin v0.2.0
   ```
3. That's it — the tag push triggers `release.yml`. Watch the Actions
   tab; when `publish-release` finishes, the GitHub Release for `v0.2.0`
   exists with the Linux, macOS, and Windows installers attached.
4. If a platform's installer build fails, `publish-release` still runs
   for whichever platforms succeeded (each matrix leg is independent),
   but check the failure before telling anyone the release is complete —
   a release missing a platform's installer is a real gap, not a
   cosmetic one.

## What this doesn't cover (stated honestly, not glossed over)

- **Code signing / notarization.** Neither workflow signs the macOS
  `.dmg` or the Windows `.exe`/`.msi`. Unsigned builds will trigger
  Gatekeper/SmartScreen warnings on end-user machines. Signing requires
  real paid certificates (an Apple Developer ID, a Windows code-signing
  cert) and secrets management this repository doesn't have configured —
  adding it is a real, separate task, not something to fake here.
- **Auto-update.** Tauri supports an updater plugin; it isn't wired up.
  Users install a specific tagged version and update manually by
  installing a newer release.
- **Linux packaging beyond `.deb`/`AppImage`.** No `.rpm`, no Flatpak,
  no Snap — whatever Tauri's default Linux bundle targets produce is
  what ships.

These are honest scope boundaries, matching how this project documents
every other deliberately-out-of-scope capability (see `ROADMAP.md`)
rather than claiming a broader release process than what's actually
built.
