#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
source ./node-runtime.sh
export REFERENCE_OPEN_BROWSER=1
node reference-server.mjs
