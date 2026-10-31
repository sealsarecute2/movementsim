#!/bin/bash
set -euo pipefail
echo 'Starting the saved-run Cloudflare replay...'
cd "$(dirname "$0")"
source ./node-runtime.sh
node hosted-reference.mjs
