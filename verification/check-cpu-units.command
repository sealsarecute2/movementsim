#!/bin/bash
set -euo pipefail
echo 'Starting the read-only CPU unit check...'
cd "$(dirname "$0")"
source ./node-runtime.sh
node hosted-cpu-units.mjs
