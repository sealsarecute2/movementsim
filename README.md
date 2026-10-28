# Movement Lab

Play at [sealsarecute2.github.io/movementsim](https://sealsarecute2.github.io/movementsim/).

Use WASD to move, the mouse to look, Space or the wheel to jump, Shift to walk, and Ctrl/C to crouch. Q restarts a run, E restores your checkpoint, and Esc pauses. F inspects the knife; hold either mouse button to keep attacking.

The interface scales with your window size and rearranges the HUD on narrow screens. Open **Settings → Custom crosshair** in the main menu to choose **Default**, **Dot**, or **Cross**, adjust the red/green/blue sliders, and set the scale from **0.5× to 3×**. The live preview matches your in-game crosshair, and your settings are saved automatically.

Use **Background** to keep the default black scene or choose **Dawn**, **Midday**, **Dusk**, or **Midnight**. The skies follow the camera, with clouds, warm horizons, daylight, or stars and a moon. Your choice is saved across courses and visits. The browser icon matches the Movement Lab M↗ logo.

The timer starts after you leave the starting platform's airspace. Checkpoints and finishes activate while passing above them. Follow the blue edges to the next checkpoint or finish. FPS is shown in the top-left corner.

Open **Movement & checkpoint sounds** in the menu to preview **Pulse**, **Glass**, and **Arcade**, then keep your favourite. Your choice, volume, and movement-sound toggle are saved in your browser. Jump, concrete footstep, landing, and falling wind samples come from CS2 game audio; checkpoint chimes are original synthesized sounds. Audio sources, processing details, and sample hashes are recorded in [sounds/sources.json](sounds/sources.json).

Normal WASD movement has footsteps; holding Shift or crouching makes footsteps silent. When the engine detects a clean bhop, only the jump sound plays. Ordinary landings and heavy falls keep their impact sound. Jumps in place stay at full volume; moving bhop takeoffs are modestly quieter. On longer downward falls, CS2's in-air wind fades in and grows with falling speed. It stops when you land, rebound, pause, finish, or reset, and follows the movement sound toggle and volume. Finishing a course plays a distinct rising victory chime at your selected movement/chime volume. The audio mix is browser-simulator tuning; it is not an exact reproduction of CS2's audio graph.

## Courses and ladders

The available maps are **Starter course**, **Endless**, and **Sandbox**. Starter keeps its original geometry, spawns, checkpoints, and finish. The eight additional timed courses and their optional shortcut routes have been removed for now. Map selection shows section counts without difficulty labels. Only Starter has a cloud leaderboard. Cyan rails and rungs identify ladders; blue edges identify the next checkpoint or finish.

Move into a ladder to attach. W/S and your viewing angle control ascent and descent; A/D move along its face. Looking upward while pushing into it climbs faster. Release movement to hold position, move beyond an edge to leave, or press Space / the wheel to push off. Holding Space before a catch does not repeatedly kick you away. A ladder can catch a fall, cancels falling wind, and has no ground footsteps. Walk/crouch slow climbing. Climbing onto the top uses the same collision controller as the rest of the game.

The independent ladder implementation follows the view-vector and ladder-plane projection in [Valve's public Source SDK movement reference](https://github.com/ValveSoftware/source-sdk-2013/blob/master/src/game/shared/gamemovement.cpp), including the Counter-Strike branch's lateral damping. The Source base climb speed is 200 units/s, with a 270 units/s outward jump. The 0.2-second regrab delay and walk/crouch scaling are simulator tuning; this is not a claim of identical current CS2 subtick behavior.

Endless now mixes **12** section types, including ladder spires, wall wraps, microsteps, and crosswind turns. Its harder pillars, beams, roofs, and staggered landings still connect to a safe checkpoint every eight blocks. Sandbox keeps its open floor and adds a ladder tower, wrap wall, low duct, narrow rail, and precision pins.

## Menu music

In **Settings → Menu music**, enable the two supplied songs: **Defend The Train OST - BTHG HQ** and **Surya Hearts - Retrofit**. Music is off by default. When enabled, the starting song is random and playback cycles between the tracks in the main menu and pause screen. The music volume slider is separate from movement/chime volume, and both the toggle and volume are saved.

Music pauses during runs, when the browser tab is hidden, and whenever the window loses focus. Pausing stops its playback clock; returning resumes the same track and position. Existing movement/knife voices and sound previews also stop while unfocused. Browsers that block restored music on reload start it after your next menu click. The songs are bundled as AAC/M4A streams encoded from the supplied MP3 files; original and encoded hashes are listed in [music/sources.json](music/sources.json).

## Owner-managed leaderboards

Starter records live in [leaderboards/course.txt](leaderboards/course.txt). Only people with write access to this repository can publish records; the game has no score-submission endpoint or exposed credentials. Boards for the removed courses and Endless have been removed. Endless still keeps a personal best distance in your browser.
1. Open `leaderboards/course.txt` on GitHub and click the pencil.
2. Add a line such as `Youhong | 00:23.456 | classic`.
3. Click **Commit changes**. After GitHub Pages publishes the update, everyone can see the record in **Leaderboard**.

Use `classic` for CS-style or `practice` for Bhop practice. Time can be `MM:SS.mmm` or seconds, such as `23.456`. Lines starting with `#` are comments. The board separates physics modes, sorts records automatically, and keeps each player's best result.

See [leaderboard editing instructions and course links](leaderboards/README.md). Use real records only.

## Development

Run `npm run dev` to serve the source in `dist/`, `npm test` for the gameplay tests, and `npm run build` to rebuild the published root pages. Code sources live in `dist/`. Leaderboard text files at the repository root are authoritative: the build copies them into `dist/` for local preview, and never overwrites the root records.
