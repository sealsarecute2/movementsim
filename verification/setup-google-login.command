#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
source ./node-runtime.sh

echo 'Configure Google login on the existing staging Worker.'
echo 'This adds account sign-in. Verified leaderboard uploads remain disabled.'
echo 'Create a Web application OAuth client first; see verification/GOOGLE_LOGIN.md.'
echo 'Paste the public Client ID ending in .apps.googleusercontent.com, not a client secret.'
read -r -p 'Google Client ID: ' MOVEMENT_GOOGLE_CLIENT_ID
export MOVEMENT_GOOGLE_CLIENT_ID

node --input-type=module <<'JS'
import {readFileSync,existsSync,writeFileSync,chmodSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
const id=process.env.MOVEMENT_GOOGLE_CLIENT_ID;
if(!/^[0-9]+-[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/.test(id||''))throw Error('Invalid public Google Client ID. Nothing was deployed.');
const endpoint=readFileSync('.staging-url','utf8').trim();
if(!/^https:\/\/movement-lab-verifier-staging\.[a-z0-9-]+\.workers\.dev$/.test(endpoint))throw Error('The saved private staging address is missing or invalid. Nothing was deployed.');
const config=JSON.parse(readFileSync('wrangler.json','utf8'));
const previous=existsSync('.staging.wrangler.json')?JSON.parse(readFileSync('.staging.wrangler.json','utf8')):null;
config.vars.STAGING_ENABLED=previous?.vars?.STAGING_ENABLED==='true'?'true':'false';
config.vars.TURNSTILE_SITE_KEY=previous?.vars?.TURNSTILE_SITE_KEY||'';
config.vars.GOOGLE_LOGIN_ENABLED='true';config.vars.GOOGLE_CLIENT_ID=id;
writeFileSync('.google-login.wrangler.json',JSON.stringify(config,null,2)+'\n',{mode:0o600});
if(!existsSync('.player-auth-secrets.json'))writeFileSync('.player-auth-secrets.json',JSON.stringify({PLAYER_AUTH_KEY:randomBytes(32).toString('base64url')}),{mode:0o600});
chmodSync('.player-auth-secrets.json',0o600);
let secret;try{secret=JSON.parse(readFileSync('.player-auth-secrets.json','utf8'));}catch{throw Error('Cannot read the existing player signing key. Nothing was deployed.');}
if(Object.keys(secret).length!==1||typeof secret.PLAYER_AUTH_KEY!=='string'||secret.PLAYER_AUTH_KEY.length<32||secret.PLAYER_AUTH_KEY.length>256)throw Error('Existing player signing key is invalid. Nothing was deployed.');
JS

echo 'Installing locked dependencies and checking the Worker bundle locally...'
npm ci --no-audit --no-fund
npm run check
echo 'Saving the player session key in Cloudflare Secrets...'
./node_modules/.bin/wrangler secret bulk .player-auth-secrets.json --config wrangler.json
echo 'Deploying Google login; no gameplay or benchmarks will be started...'
./node_modules/.bin/wrangler deploy --config .google-login.wrangler.json

node --input-type=module <<'JS'
import {readFileSync,writeFileSync,copyFileSync} from 'node:fs';
const endpoint=readFileSync('.staging-url','utf8').trim();
writeFileSync('../dist/player-auth-config.js','// Public Worker endpoint only; server secrets stay in Cloudflare.\nexport const PLAYER_AUTH_CONFIG=Object.freeze('+JSON.stringify({enabled:true,endpoint})+');\n');
copyFileSync('.google-login.wrangler.json','.staging.wrangler.json');
JS
python3 ../build-standalone.py

echo ''
echo 'Google login is configured. The public GitHub Pages build has not been pushed.'
echo 'From the repository root, run: npm run dev'
echo 'Open http://localhost:5173, choose Settings, then Sign In.'
echo 'After signing in, check Sign Out too. Press Control-C to stop the local website.'
echo 'No extra replay/load benchmark is needed. See VERIFIED_SCORES.md for the gated player-run and score-storage path.'
