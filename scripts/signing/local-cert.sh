#!/usr/bin/env bash
# Create a self-signed code-signing certificate in the login keychain, once per Mac.
#
#   scripts/signing/local-cert.sh        (or: make cert)
#
# Why: an ad-hoc signature is a hash of the binary, so every rebuild is a new app to
# macOS and it asks for Bluetooth permission again. Signed with a fixed certificate, the
# app's designated requirement is "this bundle id, this certificate", which survives
# rebuilds, and the permission sticks. `make app` uses this identity when it exists.
#
# Local only. Builds for other people need a Developer ID (docs/RELEASING.md).
# The name comes from product.env: "<PRODUCT_NAME> Local Signing". After a rename, run
# this again; the old certificate can be deleted in Keychain Access.
set -euo pipefail
# shellcheck source=../lib/common.sh
. "$(dirname "$0")/../lib/common.sh"
load_product

NAME="$LOCAL_SIGN_ID"
KEYCHAIN="$HOME/Library/Keychains/login.keychain-db"

if security find-certificate -c "$NAME" "$KEYCHAIN" >/dev/null 2>&1; then
  echo "\"$NAME\" is already in the login keychain"
  exit 0
fi

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
cat > "$tmp/cert.cnf" <<CNF
[req]
distinguished_name = dn
x509_extensions = ext
prompt = no
[dn]
CN = $NAME
[ext]
basicConstraints = critical, CA:false
keyUsage = critical, digitalSignature
extendedKeyUsage = critical, codeSigning
CNF
openssl req -x509 -newkey rsa:2048 -nodes -days 3650 -config "$tmp/cert.cnf" \
  -keyout "$tmp/key.pem" -out "$tmp/cert.pem" 2>/dev/null
pass="$(openssl rand -hex 16)"
openssl pkcs12 -export -inkey "$tmp/key.pem" -in "$tmp/cert.pem" -name "$NAME" \
  -out "$tmp/id.p12" -passout "pass:$pass"
# -T: codesign may use the key without asking each time.
security import "$tmp/id.p12" -k "$KEYCHAIN" -P "$pass" -T /usr/bin/codesign
echo "added \"$NAME\" to the login keychain"
