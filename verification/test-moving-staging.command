#!/bin/bash
set -euo pipefail
echo 'Starting the eight-player moving Cloudflare test...'
cd "$(dirname "$0")"
source ./node-runtime.sh
node hosted-moving.mjs
