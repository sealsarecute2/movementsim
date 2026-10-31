#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
source ./node-runtime.sh
node hosted-benchmark.mjs
