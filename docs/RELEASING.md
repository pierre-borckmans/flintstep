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
#   SparkX-MIDI-v0.2.0.dmg: OK

xcrun stapler validate SparkX-MIDI-v0.2.0.dmg
spctl -a -vvv -t open --context context:primary-signature SparkX-MIDI-v0.2.0.dmg
#   accepted  source=Notarized Developer ID

# after copying the app to /Applications
spctl -a -vvv -t exec "/Applications/SparkX MIDI.app"
#   accepted  source=Notarized Developer ID  origin=Developer ID Application: …
codesign -dv --verbose=2 "/Applications/SparkX MIDI.app"   # flags=0x10000(runtime), Authority=Developer ID…
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
xattr -dr com.apple.quarantine "/Applications/SparkX MIDI.app"
```

An ad-hoc build is also a different app to macOS after every update, so it asks for
Bluetooth access again each time. A Developer ID build keeps the permission across
updates.

## Renaming

The build and release side reads every name from `product.env`. To rename:

1. Edit `product.env`. Run `make product`, which rewrites the copies in `wails.json`
   and `build/darwin/Info.plist`/`Info.dev.plist`. CI fails if they drift.
2. Run `make cert` again for the local certificate, which is named after the product.
3. Change the names still written out in the Go and TypeScript sources (below).
4. Think twice before changing `BUNDLE_ID` or `DATA_DIR_NAME`. A new bundle id means
   macOS treats it as a new app (Bluetooth permission asked again, the old LaunchAgent
   left behind), and the MIDI port UIDs are hashed from it, so DAWs see new ports. A new
   data folder needs a one-time move of `~/Library/Application Support/<old>`.

Names in source, as of this writing (`git grep -n -E 'SparkX MIDI|silversol|Spark Control X LEDs'`
finds them):

| product.env key | File and line |
| --- | --- |
| `PRODUCT_NAME` | `main.go` window `Title` and About `Title`; `app.go` `midiClient`, tray items "Open …", "Quit …", tooltip, the "stopped" log line; `applog.go` "starting" log line; `presets.go` file dialog filter; `internal/coremidi/coremidi_darwin.go` `Manufacturer`; `internal/ble/radio_darwin.go` Bluetooth-denied message; `internal/presets/presets.go` `notAPreset` and "newer …" errors; `cmd/miditest/main.go`, `cmd/sparkx-midi/main.go` client name; `frontend/index.html` `<title>`; `frontend/src/components/Header.tsx` wordmark; `frontend/src/components/SettingsPanel.tsx` version line; `frontend/src/lib/indicators.ts`, `frontend/src/lib/linkview.ts` hints; `frontend/src/lib/presets.ts` error strings; `build/icon/appicon.svg` comment |
| `BUNDLE_ID` | `internal/loginitem/loginitem.go` `Label`; `internal/coremidi/uid.go` UID seed (and their tests) |
| `MIDI_PORT_NAME` | `app.go` `midiSource`; `cmd/sparkx-midi/main.go`, `cmd/miditest/main.go`; fallbacks in `frontend/src/components/Activity.tsx`, `Header.tsx`, `frontend/src/mock.ts` |
| `MIDI_LED_PORT_NAME` | `app.go` `midiDest`; `cmd/sparkx-midi/main.go`, `cmd/miditest/main.go`; `frontend/src/components/SettingsPanel.tsx`, `frontend/src/mock.ts` |
| `DATA_DIR_NAME` | `internal/store/store.go` `AppDirName` (and `store_test.go`) |
| `CLI_NAME` | the `cmd/sparkx-midi` directory |
| (file format ids) | `sparkx-midi-preset` and `.sparkx.json` in `internal/presets/presets.go` and `frontend/src/lib/presets.ts`; `sparkx.*` localStorage keys in `frontend/index.html`, `App.tsx`, `lib/theme.ts`, `lib/nuts.ts`, `lib/exppedal.ts`. Renaming these breaks old exports and saved view settings unless both spellings are read. |

`SparkX` on its own in `internal/sparkx`, `internal/ble/find.go` and `tools/probe` is the
pedal's Bluetooth name, not the app's. Leave it.
