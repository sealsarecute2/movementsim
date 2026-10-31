#!/bin/bash
set -euo pipefail
echo 'Starting the read-only eight-player moving resource check...'
cd "$(dirname "$0")"
source ./node-runtime.sh
node hosted-metrics.mjs --moving-load
