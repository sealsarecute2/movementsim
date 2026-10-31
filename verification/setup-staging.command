#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"

source ./node-runtime.sh

echo 'Installing the Cloudflare deployment CLI, then opening browser sign-in.'
npm install --no-audit --no-fund
./node_modules/.bin/wrangler login
npm run check

# Keys stay on this Mac and in Cloudflare Secrets. Never print or commit them.
node --input-type=module <<'JS'
import {existsSync,readFileSync,writeFileSync,chmodSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
if(!existsSync('.staging-secrets.json'))writeFileSync('.staging-secrets.json',JSON.stringify({STAGING_KEY:randomBytes(32).toString('base64url')}),{mode:0o600});
chmodSync('.staging-secrets.json',0o600);
const config=JSON.parse(readFileSync('wrangler.json','utf8'));config.vars.STAGING_ENABLED='true';
writeFileSync('.staging.wrangler.json',JSON.stringify(config,null,2)+'\n',{mode:0o600});
JS

echo 'Deploying the disabled staging Worker and configuring its private access key.'
./node_modules/.bin/wrangler deploy --config wrangler.json
./node_modules/.bin/wrangler secret bulk .staging-secrets.json --config wrangler.json
echo 'Enabling authenticated private tests. Global leaderboard submissions remain disabled.'
./node_modules/.bin/wrangler deploy --config .staging.wrangler.json 2>&1 | tee .staging-deploy.txt

node --input-type=module <<'JS'
import {readFileSync,writeFileSync} from 'node:fs';
const output=readFileSync('.staging-deploy.txt','utf8');
const urls=output.match(/https:\/\/movement-lab-verifier-staging\.[a-z0-9-]+\.workers\.dev/g);
if(!urls?.length)throw Error('Could not identify the deployed workers.dev address. Check deployment output.');
writeFileSync('.staging-url',urls.at(-1)+'\n',{mode:0o600});
JS

bash ./test-staging.command
echo 'Private staging tests complete. Results: verification/hosted-results.json'
echo 'Disable new tests at any time with: npm run deploy:disabled'
