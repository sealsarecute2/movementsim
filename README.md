# Movement Lab

A dependency-free, first-person greybox movement trainer. Plain WebGL renders grey boxes against black; no models, textures, images, or game assets. Google Fonts are optional; local fallbacks work offline.

## Run

Open `movement-lab.html` directly in a desktop browser, or from this folder run `python3 -m http.server 5173 --directory dist`, then open http://localhost:5173. No install step is required. Regenerate the standalone HTML after source changes with `python3 build-standalone.py`. Run physics checks with `node --test tests/*.test.mjs` (Node 20+).

## Controls

Click Enter to capture and hide the mouse; looking works continuously without dragging or reaching screen edges. Esc releases the mouse and pauses. Gameplay starts only after mouse capture succeeds. If your browser blocks capture, open the page directly in a desktop browser and allow pointer lock.

WASD moves, mouse looks, Space / mouse wheel jumps, Shift walks, Ctrl / C crouches, R starts a fresh run, and E restores the checkpoint. Left / Right arrows also turn; Up / Down arrows move forward / backward.

CS-style requires a fresh jump press per hop. Bhop practice lets you hold Space, adds stronger air acceleration, and removes the bhop speed cap and landing slowdown. Free roam provides a large practice floor. Changing presets/maps resets the run. Course time excludes pauses. Respawning preserves time but makes the run ineligible for personal best; bests are stored per physics preset in this browser.

## Movement model and limits

The physics runs at a fixed 256 Hz, independently of rendering. It includes wish-direction normalization, Source-style dot-product acceleration, a 30 u/s projected air wish-speed cap, ground friction, counter-strafing, gravity, jump impulse, walking/crouching speed changes, swept hull collision with sliding, 18-unit step climbing, and blocked uncrouching. Distances use Source units. The hull is 32×32×72 standing and 32×32×54 crouched.

This is a recreation, **not exact Source 2 movement**. The proprietary CS2 controller is not embedded here. The manual bhop timing window, spam guard, speed limit, and time/impact-based landing slowdown are explicit approximations. January 2026 CS2 updates replaced jump/landing stamina with landing-time behavior; this trainer therefore does not use the old cumulative stamina model. Exact subtick input processing, full after-landing timing forgiveness, current weapon-specific movement details, slopes, ladders, surfing, crouch-in-air hull lifting and interactions with moving players are outside this first version. Physics preset constants are tunable simulator defaults, not a verified latest-build convar dump.

Model references:

- Valve's public Source SDK movement implementation: https://github.com/ValveSoftware/source-sdk-2013/blob/master/src/game/shared/gamemovement.cpp
- Valve's January 2026 release notes: https://store.steampowered.com/news/posts/?appids=730&enddate=1769472539&feed=steam_community_announcements

`dist/physics.js` is the standalone controller. `dist/course.js` defines course geometry and checkpoints. `dist/renderer.js` contains the WebGL greybox renderer. `dist/app.js` connects input, timing, the HUD and local records. Static deploy assets live entirely in `dist/`.
