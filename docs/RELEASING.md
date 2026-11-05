# Releasing

How a release gets built, signed and notarized, and what to set up once before that
works. The short version: push a `vX.Y.Z` tag and GitHub Actions does the rest. Without
an Apple Developer account it still publishes a DMG, marked "not notarized".

## How it fits together

| File | Job |
| --- | --- |
| `product.env` | Product name, bundle id, MIDI port names, data folder, repo. Everything below reads it. |
| `scripts/release/build.sh` | `wails build`, universal (arm64 + x86_64), macOS 12 minimum, bundle version from the tag. |
| `scripts/release/sign.sh` | Signs inside out with the hardened runtime and `build/darwin/entitlements.plist`. |
| `scripts/release/notarize.sh` | `notarytool submit --wait`, prints Apple's log on rejection, staples. |
| `scripts/release/dmg.sh` | The DMG: the app and an Applications link. |
| `scripts/release/release.sh` | All of the above in order, then verification and `SHA256SUMS.txt`. |
| `.github/workflows/release.yml` | On a `v*` tag: import the certificate, `make release`, upload to the GitHub release. |

`make release VERSION=vX.Y.Z` runs `release.sh`. It picks its mode from what it finds:

- A "Developer ID Application" identity in the keychain and notary credentials in the
  environment: signed, notarized, stapled. The app is notarized first, then packed, then
  the DMG is signed and notarized as well, so both carry a ticket and open offline.
- Anything less: the same files, signed with the local certificate (`make cert`) or ad
  hoc, and labelled "NOT notarized" in the terminal and in `build/bin/release-notes.md`.

`SIGN_IDENTITY="Developer ID Application: …"` picks a specific identity;
`SIGN_IDENTITY=-` forces ad hoc. `PLATFORM=darwin/arm64` skips the Intel half.

The entitlements file is empty on purpose. The header of
`build/darwin/entitlements.plist` explains why Bluetooth, CoreMIDI and WKWebView need
nothing under the hardened runtime when the app isn't sandboxed.

## One-time setup

### 1. Join the Apple Developer Program

<https://developer.apple.com/programs/enroll/>, as an individual. It costs 99 USD a year
and approval can take a day or two. Note your Team ID (Membership details), a
10-character string like `AB12CD34EF`.

### 2. Create a Developer ID Application certificate

Only the Account Holder can create one. Either:

- Xcode > Settings > Accounts > your Apple ID > Manage Certificates > `+` >
  **Developer ID Application**; or
- on <https://developer.apple.com/account/resources/certificates/add>: pick
  **Developer ID Application**, profile type **G2 Sub-CA**, upload a CSR from Keychain
  Access (Certificate Assistant > Request a Certificate From a Certificate Authority,
  saved to disk), then download the `.cer` and double-click it.

Check it is there and valid:

```sh
security find-identity -v -p codesigning
#   1) 0123…  "Developer ID Application: Pierre Borckmans (AB12CD34EF)"
```

From now on `make app` and `make release` on this Mac sign with it.

### 3. Export it as a .p12 for CI

Keychain Access > login > My Certificates > right-click
"Developer ID Application: …" > Export. Choose `.p12` and set a strong password. The
export must include the private key (the disclosure triangle shows a key under the
certificate). Then:

```sh
base64 -i DeveloperID.p12 | pbcopy   # now paste it as MACOS_CERT_P12_BASE64
```

Keep the `.p12` in a password manager, not in the repo or a synced folder.

### 4. Create an App Store Connect API key for notarization

App Store Connect > Users and Access > Integrations > App Store Connect API > Team Keys
> `+`. Name it (e.g. "notary"), access **Developer**. Download the `.p8`; Apple offers
it once. Note the **Key ID** next to it and the **Issuer ID** above the table.

An API key is better than an Apple ID: it isn't tied to your password or 2FA and can be
revoked on its own. If you'd rather use an Apple ID, make an app-specific password at
<https://account.apple.com> > Sign-In and Security > App-Specific Passwords.

### 5. Add the GitHub secrets

Settings > Secrets and variables > Actions > New repository secret, or with `gh`:

```sh
gh secret set MACOS_CERT_P12_BASE64 < <(base64 -i DeveloperID.p12)
gh secret set MACOS_CERT_PASSWORD           # the .p12 export password
gh secret set NOTARY_KEY_ID                 # e.g. 2X9R4HXF34
gh secret set NOTARY_ISSUER                 # e.g. 57246542-96fe-1a63-e053-0824d011072a
gh secret set NOTARY_KEY_P8 < AuthKey_2X9R4HXF34.p8
```

| Secret | What |
| --- | --- |
| `MACOS_CERT_P12_BASE64` | The Developer ID certificate and key, `.p12`, base64. |
| `MACOS_CERT_PASSWORD` | Its export password. |
| `NOTARY_KEY_ID` | App Store Connect API key ID. |
| `NOTARY_ISSUER` | App Store Connect issuer ID. |
| `NOTARY_KEY_P8` | The `.p8` file's contents (the PEM text; base64 of it works too). |

Instead of the three `NOTARY_KEY_*` secrets you can set `NOTARY_APPLE_ID`,
`NOTARY_TEAM_ID` and `NOTARY_PASSWORD` (the app-specific password). With neither set,
the workflow signs with the Developer ID but doesn't notarize, and says so.

### 6. Notarize from your Mac (optional)

Store the credentials once in the keychain, then name the profile:

```sh
xcrun notarytool store-credentials notary \
  --key AuthKey_2X9R4HXF34.p8 --key-id 2X9R4HXF34 --issuer 57246542-…
NOTARY_PROFILE=notary make release VERSION=v0.2.0
```

## Cutting a release

1. On `main`, with CI green: `make check`, and `make release VERSION=v0.2.0` once
   locally if the build or signing changed.
2. Tag and push. The tag is the version: it goes into the binary, the bundle version
   and the DMG name.

   ```sh
   git tag -a v0.2.0 -m "v0.2.0"
   git push origin v0.2.0
   ```

3. Watch the Release workflow under Actions. Notarization usually takes 2 to 10 minutes
   per submission and there are two (app, then DMG).
4. The release appears with the DMG, `SHA256SUMS.txt`, a line saying whether it is
   notarized, and notes generated from the merged PRs. Edit the text if needed.

The build copies `LICENSE` and `THIRD_PARTY_NOTICES.md` into the app's
`Contents/Resources` and the DMG's root, and `release.sh` checks both are there. The
notices file is generated (`make notices`, see `tools/notices`); the CI `notices` job
fails when a dependency change left it stale, or when a new dependency has no licence
file or a licence outside the permissive set (MIT, ISC, BSD, Apache-2.0, Zlib, 0BSD).

If notarization fails, the job log has Apple's JSON report under
`---- notarytool log <id> ----`. It names each file and the problem. The usual ones are
an unsigned nested binary, a missing secure timestamp, or the hardened runtime not
enabled; `sign.sh` covers all three for what the bundle holds today.

To redo a release, delete the GitHub release and the tag (`git push --delete origin
v0.2.0`), fix, and tag again.

## Verifying a download

```sh
cd ~/Downloads
shasum -a 256 -c SHA256SUMS.txt
#   Flintstep-v0.2.0.dmg: OK

xcrun stapler validate Flintstep-v0.2.0.dmg
spctl -a -vvv -t open --context context:primary-signature Flintstep-v0.2.0.dmg
#   accepted  source=Notarized Developer ID

# after copying the app to /Applications
spctl -a -vvv -t exec "/Applications/Flintstep.app"
#   accepted  source=Notarized Developer ID  origin=Developer ID Application: …
codesign -dv --verbose=2 "/Applications/Flintstep.app"   # flags=0x10000(runtime), Authority=Developer ID…
```

`spctl -a -t install` is for installer packages; a DMG is assessed with `-t open` and an
app with `-t exec`.

## What users see

**Notarized.** They open the DMG, drag the app to Applications and open it. macOS asks
once "downloaded from the Internet, are you sure?" with the developer's name, then asks
for Bluetooth access. Nothing else.

**Not notarized** (ad hoc, or no notary credentials). macOS 15 and later say the app
"can't be opened" or "Apple could not verify it is free of malware" and offer only Done
or Move to Trash. The user then goes to System Settings > Privacy & Security, scrolls to
the message about the app and clicks **Open Anyway**, then confirms with their password.
Right-click > Open no longer skips this on macOS 15. Or, in Terminal:

```sh
xattr -dr com.apple.quarantine "/Applications/Flintstep.app"
```

An ad-hoc build is also a different app to macOS after every update, so it asks for
Bluetooth access again each time. A Developer ID build keeps the permission across
updates.

## Renaming

Every name comes from `product.env`. To rename:

1. Edit `product.env`. Run `make product`, which rewrites the copies in `wails.json`
   and `build/darwin/Info.plist`/`Info.dev.plist`. CI fails if they drift.
2. Update `internal/product/product.go` and `frontend/src/product.ts` to match.
   `go test ./internal/product` and `bun run test` fail until they do. If `CLI_NAME`
   changed, rename the `cmd/` directory too (the Makefile builds `./cmd/$(CLI_NAME)`).
3. Update the spots that can't import those constants (below).
4. `make cert NEW=1` for a local certificate under the new name. Optional: `make app`
   also signs with the one named before the last rename if it finds that.
5. Think twice before changing `BUNDLE_ID` or `DATA_DIR_NAME`. A new bundle id means
   macOS treats it as a new app (Bluetooth permission asked again, a new WebKit storage
   so localStorage starts empty, the old LaunchAgent left behind), and the MIDI port UIDs
   are hashed from it, so DAWs see new ports. A new data folder needs a one-time move.
   The SparkX MIDI to Flintstep rename handles both: see "Migrations" below.

Names still written out, as of this writing:

| What | Where |
| --- | --- |
| `PRODUCT_NAME` | `frontend/index.html` `<title>` (checked by `product.test.ts`); `build/icon/appicon.svg` comment; `scripts/site/og.html` and `site/` copy |
| `MIDI_PORT_NAME`, `MIDI_LED_PORT_NAME` | `site/index.html` copy |
| `REPO_SLUG` | `site/index.html` `data-repo`; README badges; `.github/ISSUE_TEMPLATE/config.yml` |
| `SITE_URL` | `site/index.html` canonical and `og:url`; README |
| file format ids | `flintstep-preset` and `.flintstep.json` in `internal/presets/presets.go` and `frontend/src/lib/presets.ts` |
| localStorage prefix | `STORAGE_PREFIX` in `frontend/src/product.ts`, and the inline script in `frontend/index.html` (checked by `product.test.ts`) |

`git grep -n -i "sparkx midi\|sparkxmidi\|sparkx-midi"` should find only the migration
code, its tests and the release notes.

### Migrations

What carries a SparkX MIDI install over to Flintstep, all in place since the rename:

| Old | New | Where |
| --- | --- | --- |
| `~/Library/Application Support/SparkX MIDI` | `.../Flintstep`, moved on first launch | `internal/store/migrate.go` |
| `~/Library/LaunchAgents/com.silversol.sparkxmidi.plist` | `com.silversol.flintstep.plist` for the running app | `loginitem.MigrateLegacy` |
| exports `"sparkx-midi-preset"`, `.sparkx.json` | still import | `internal/presets`, `frontend/src/lib/presets.ts` |
| localStorage `sparkx.*` | copied to `flintstep.*` when unset | `frontend/index.html`, `frontend/src/lib/storage.ts` |
| "SparkX MIDI Local Signing" | still used by `make app` when "Flintstep Local Signing" is missing | `scripts/lib/common.sh` |
| CoreMIDI unique ids | new ones: DAWs see a new device | `internal/coremidi/uid.go` |

The localStorage copy only helps where the storage survives, such as `wails dev` and the
browser mock: the packaged app has a new bundle id and so a new, empty WebKit store. The
theme is the only setting that matters there, and it falls back to "follow macOS".

`SparkX` on its own in `internal/sparkx`, `internal/ble/find.go` and `tools/probe` is the
pedal's Bluetooth name, not the app's. Leave it.
