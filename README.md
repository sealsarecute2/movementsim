# Movement Lab

Play at [sealsarecute2.github.io/movementsim](https://sealsarecute2.github.io/movementsim/).

Use WASD to move, the mouse to look, Space or the wheel to jump, Shift to walk, and Ctrl/C to crouch. Q restarts a run, E restores your checkpoint, and Esc pauses. F inspects the knife; hold either mouse button to keep attacking.

The timer starts after you leave the starting platform's airspace. Checkpoints and finishes activate while passing above them. Follow the blue edges to the next checkpoint or finish. FPS is shown in the top-left corner.

Open **Movement & checkpoint sounds** in the menu to preview **Pulse**, **Glass**, and **Arcade**, then keep your favourite. Your choice, volume, and movement-sound toggle are saved in your browser. Jump, concrete footstep, and landing samples are original CS2 game audio; checkpoint chimes are original synthesized sounds. Audio sources and sample hashes are recorded in [sounds/sources.json](sounds/sources.json).

Normal WASD movement has footsteps; holding Shift or crouching makes footsteps silent. When the engine detects a clean bhop, only the jump sound plays. Ordinary landings and heavy falls keep their impact sound. Jumps in place stay at full volume; moving bhop takeoffs are modestly quieter. Finishing a course plays a distinct rising victory chime at your selected movement/chime volume. The hop mix is browser-simulator tuning; it is not an exact reproduction of CS2's audio graph.

## Owner-managed leaderboards

Each course has a plain text file in [leaderboards](leaderboards). Only people with write access to this repository can publish records; the game has no score-submission endpoint or exposed credentials.

1. Open the course's `.txt` file on GitHub and click the pencil.
2. Add a line such as `Youhong | 00:23.456 | classic`.
3. Click **Commit changes**. After GitHub Pages publishes the update, everyone can see the record in **Leaderboard**.

Use `classic` for CS-style or `practice` for Bhop practice. Time can be `MM:SS.mmm` or seconds, such as `23.456`. Endless uses whole-number distance instead: `Youhong | 10000 | classic`. Lines starting with `#` are comments. The board separates physics modes, sorts records automatically, and keeps each player's best result.

See [leaderboard editing instructions and course links](leaderboards/README.md). New files contain commented examples, not invented records.

## Development

Run `npm run dev` to serve the source in `dist/`, `npm test` for the gameplay tests, and `npm run build` to rebuild the published root pages. Code sources live in `dist/`. Leaderboard text files at the repository root are authoritative: the build copies them into `dist/` for local preview, and never overwrites the root records.
