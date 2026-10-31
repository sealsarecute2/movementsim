#!/bin/bash
set -euo pipefail
echo 'Starting the paced ten-round Cloudflare test...'
cd "$(dirname "$0")"
source ./node-runtime.sh
node hosted-sustained.mjs
