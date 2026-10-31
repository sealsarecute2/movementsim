# Verified leaderboard beta

The verified beta supports **Bhop School, revision 1, classic (CS-style)**. The Worker publishes this exact allowlist and rejects other maps or presets before bot verification and admission. The browser uses the same list to enable controls. Ordinary practice and owner-published text leaderboards remain available on the other courses.

Sign in through Settings, select Bhop School / CS-style, choose Verified Run, complete the browser check, then choose Start Verified Run. Starting waits for mouse capture and the server's ready message. Pausing, resetting or disconnecting ends verification. A fresh attempt requires a fresh browser proof. The finish screen confirms a save only after server simulation and durable storage accept it.

Public records use your chosen username and the fastest verified time per account. Choose or change your username in Settings: 3–20 letters, numbers or underscores, unique regardless of capitalization. Renaming updates existing leaderboard entries without changing their times. Until you choose a name, the board uses a generated player label. Google names and emails are not published. Your application login is saved on this browser and has no automatic expiry; Sign Out clears it and revokes server access. Clearing browser data also removes the saved login. Up to three device sessions are retained per account; signing in on another device beyond that limit revokes the oldest. Turnstile checks and rotating network hashes help limit abuse. Server simulation validates input, physics, ordered checkpoints and the finish; it does not prove that inputs were human-generated or exclude tool-assisted play.

## Deployment

The root HTML files are standalone builds produced from `dist` with `python3 build-standalone.py`. Run the root test suite with Node 22.16 or newer after installing the verifier's locked dependencies using `npm ci` inside `verification`. The tests exercise browser event handling, signed sessions, workerd, SQLite, quotas, bot validation and a complete human input fixture.

Deploy the Worker using a private Wrangler config derived from `wrangler.json`. Configure the Google web client for the exact localhost and GitHub Pages origins, put `PLAYER_AUTH_KEY`, `STAGING_KEY` and `TURNSTILE_SECRET_KEY` in Cloudflare Secrets, and set the public Google client ID, Turnstile site key and exact allowed Origins in variables. The committed config defaults to disabled services. To enable the limited public beta, set `GOOGLE_LOGIN_ENABLED`, `PLAYER_RUNS_ENABLED` and `RANKED_SUBMISSIONS_ENABLED` to `true`. The allowlist is enforced even when these flags are enabled. Private player testing uses a separate flag, an account gate and an isolated score namespace.

`PLAYER_RUNS_ENABLED=false` stops new player starts and connections. `RANKED_SUBMISSIONS_ENABLED=false` stops new public score writes and pending public retries. Owner-only staging controls can stop active attempts. Admission remains one persistent coordinator with a global cap of eight, one attempt per account, four per network, a ten-minute attempt ceiling and a four-hour aggregate daily run budget. These limits bound game work; they do not guarantee availability under arbitrary distributed traffic.

Public scores use `global-v1`. Private test scores use `private-test-v1` and are not copied into the public board. Personal best writes are idempotent, retain the faster score, and separate records by map revision, preset and ruleset. Temporary run diagnostics expire after 24 hours; personal bests persist separately.

Source, tests and the regression input fixture are published. Credentials, private deployment configs, raw operator recordings and runtime reports stay outside the release. The runtime fixture contains only map/control data and no account information.

## Validation scope

The complete Bhop School / classic reference matched local and hosted physics. Eight simultaneous replays and ten rounds of eight passed the hosted capacity checks. Real Google sign-in, Turnstile, a private human finish and durable score acknowledgement also passed. Other maps and presets need complete reference coverage before joining the verified allowlist. Raising the eight-run cap requires a separate capacity decision.

The public GitHub Pages origin is checked with the official Google button in a clean browser profile. Browser automation uses separate test sessions and responses; it does not read the owner's account credentials or browser profile.
