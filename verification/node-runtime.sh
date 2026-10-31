# Sourced by the setup and test commands; it does not install or deploy anything.
if ! command -v node >/dev/null 2>&1 || ! node -e 'process.exit(Number(process.versions.node.split(".")[0])>=22?0:1)' >/dev/null 2>&1; then
  if [ -x /tmp/node-v22.16.0-darwin-arm64/bin/node ]; then
    export PATH="/tmp/node-v22.16.0-darwin-arm64/bin:$PATH"
  else
    echo 'Install Node.js 22 or newer from https://nodejs.org/ and run this again.'
    exit 1
  fi
fi
