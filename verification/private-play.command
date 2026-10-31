#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
source ./node-runtime.sh
exec node private-play-server.mjs
