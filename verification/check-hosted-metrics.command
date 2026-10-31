#!/bin/bash
set -euo pipefail
echo 'Starting the read-only Cloudflare resource check...'
cd "$(dirname "$0")"
source ./node-runtime.sh
node hosted-metrics.mjs
