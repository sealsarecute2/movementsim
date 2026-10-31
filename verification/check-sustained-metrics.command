#!/bin/bash
set -euo pipefail
echo 'Starting the read-only ten-round resource check...'
cd "$(dirname "$0")"
source ./node-runtime.sh
node hosted-metrics.mjs --sustained-load
