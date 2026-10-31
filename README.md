# Movement Lab

**[Play Movement Lab](https://sealsarecute2.github.io/movementsim/)** — a browser game for practising bunny hopping, air strafing, and parkour. Use a keyboard and mouse.

## Start playing

1. Open the game and click **Play**.
2. Choose **Bhop practice** and **Bhop School** to learn from the signs along the route. Bhop practice gives you stronger air control and lets you build more speed.
3. Click **Start course** to capture your mouse.
4. Follow the platforms toward the blue checkpoint. Press **Esc** whenever you want to pause or release your mouse.

You can also open **Sandbox** from the main menu to practise on a wide floor.

## Play with friends

1. Open **Multiplayer** from the main menu and enter your name.
2. To host, choose a map and physics mode, then click **Host room**.
3. Copy the private invite code and share it with your friends. They enter the code and click **Join room**.
4. Click **Enter map**. Up to four players can practise together; players pass through each other.

Your ping appears while playing, and the room list shows each player's ping to the host in milliseconds. Lower is better. The host row says **HOST**. Everyone shares the same map and physics; Endless also shares its random seed. Checkpoints, restarts, and timers are individual.

Keep the host's computer awake and game tab open. Leaving or refreshing closes the room; guests can continue solo. Leave the room before choosing another map or physics mode. Local map imports are for solo play.

Rooms use the free PeerJS connection service by default, with gameplay sent between browsers. Some networks need a relay to connect; the site supports optional Metered relay configuration. No account or installation is needed for players. [Room hosting configuration](MULTIPLAYER.md).

## How to bhop

**Bhop** means bunny hop: jumping again as soon as you land, so you carry your speed between jumps. **Air strafing** means steering while you are in the air.

1. **Hold W to start moving forward.** Give yourself a little room before the first jump.
2. **Hold Space to jump.** Keep holding it: the game automatically jumps again when you land, in both physics modes.
3. **Release W once you are in the air.** Use A and D with your mouse to steer.
4. **To turn left, hold A and gently move your mouse left.**
5. **To turn right, hold D and gently move your mouse right.** Release A when you switch to D, and release D when you switch back to A.
6. **Keep Space held and aim for the next platform.** Use small, smooth turns. Start with one turn per jump; add more turns once you feel comfortable.

Try this on the Sandbox floor first: run forward, hold Space, release W, then alternate **A + mouse left** and **D + mouse right**. Watch your speed and practise keeping a steady rhythm.

If you keep missing platforms:

- **Turning too far?** Make smaller mouse movements or lower your sensitivity in Settings.
- **Losing speed?** Check that your strafe key matches your mouse direction. Start in Bhop practice, where steering is easier.
- **Going too fast?** Release Space to land and slow down. Build control before trying for maximum speed.
- **Need to repeat a jump?** Press E to return to your checkpoint.

## Controls

| Key or input | What it does |
| --- | --- |
| W / A / S / D | Move |
| Mouse | Look and steer |
| Hold Space | Jump automatically when you land |
| Scroll wheel | Another way to trigger a jump |
| Shift | Walk slowly |
| Ctrl or C | Crouch; useful under low ceilings |
| E | Return to your checkpoint; the timer continues |
| Q | Restart the run and clear checkpoint progress |
| Esc | Pause and release the mouse |
| F | Inspect the knife |
| Hold left / right mouse button | Light / heavy knife attack |
| R | Cancel the knife inspection |

To climb a ladder, move into its cyan rails and rungs. Use W/S and look up or down to climb, A/D to move sideways, and Space or the wheel to jump off.

## Choose a map and physics mode

| Map | What to expect |
| --- | --- |
| Starter course | A short route with compact signs for jumping, strafing, and careful movement |
| Bhop School | Four lessons with signs explaining jumping, air strafing, control, and checkpoints |
| Ladder Run | Two ladder climbs linked by rooftop jumps and checkpoint decks |
| Sandbox | An open floor with obstacles and a ladder for practising freely |
| Endless | A continuing route with a checkpoint every eight blocks |
| bhop_lego | A community parkour route with 25 ordered checkpoint pads; find it under Community maps |
| bhop_kitsune | Six community stages linked by portals, with checkpoints at each entrance |

**Bhop practice** has stronger air control and no speed cap. **CS-style** has gentler air control and capped speed. Both let you hold Space to keep hopping.

The community maps use plain blocks for their jumping routes. Boost pads activate automatically. On **bhop_kitsune**, follow the blue exit pad to the next stage; portals preserve your horizontal speed and save the new checkpoint. Its side walls and roofs are excluded from the route. Endless has open stepping-stone sections in place of wall wraps.

Use **Import .bsp / .zip** for uncompressed CS:S / Source 1 maps (BSP 19 or 20). Uploaded maps preserve solid brush shapes, including ramps, wedges, angled platforms and polygonal round pillars, with plain grey surfaces. Re-import a map to use the improved geometry. Custom prop models, displacement terrain and scripted map features are not supported. Local imports stay in your browser and are not uploaded.

## Checkpoints, saving, and times

Follow the blue highlight to the next checkpoint or finish. Checkpoints activate in order, so jumping ahead does not save later progress. Falling returns you to your latest checkpoint.

Press **E** for another attempt from that checkpoint, or **Q** for a fresh run. On timed courses, using a checkpoint makes the run a practice attempt rather than a clean personal best.

Refreshing the page restores your timed or community-map run at its checkpoint, paused. Click **Continue** to resume. Keep the same tab open: this is temporary progress. Restarting, changing maps or physics, or finishing clears the previous run. Endless keeps your best distance in your browser.

All timed courses and both community maps have Published leaderboards with separate CS-style and Bhop practice rankings. Select a map and click **Leaderboard**, or open it after finishing. **Endless leaderboard** ranks distance, highest first. Published records are added by the owner; an ordinary practice finish does not publish your score. [Leaderboard information](leaderboards/README.md).

The **Verified Run beta** supports Bhop School / CS-style. Sign in through Settings, select that map and mode, choose **Verified Run**, complete the browser check, then choose **Start Verified Run**. The server calculates the time and saves accepted personal bests to the Verified leaderboard. Pausing or resetting ends verification; ordinary practice can continue. Choose a unique username in Settings for your public leaderboard entries. Your login stays saved on this browser until you sign out; private test scores stay separate. [Beta scope and server details](verification/BETA.md).

## Make it comfortable

Open **Settings** to change mouse sensitivity, field of view, your crosshair, the background, or sound volume. These preferences save automatically in your browser.

**Background** offers **Black** (the default), **Day / night cycle**, and **Black hole**. Turning on the day/night cycle starts at dawn, reaches midday after five minutes, dusk after ten, and midnight after fifteen, then returns to dawn at twenty minutes and repeats. The sun and moon move across the sky as colours, drifting clouds, stars, and distance haze change smoothly. The cycle keeps moving while you play or pause; turning it off and on starts a new dawn.

**Black hole** adds a dark centre, glowing rings, a swirling accretion disk, and a warped star field. It is an original browser effect inspired by the look of IterationT's Minecraft End sky. Choose it in **Settings → Background**; it works on every map.

Enable **Settings → Shaders** for directional lighting on the boxes and a soft, round player shadow. The day/night cycle uses the sun by day and moon by night; the black-hole background lights the course from the black hole. Black uses a fixed light. Your shadow stays directly beneath you on platform tops and grows softer as you jump. Shaders start off, and your choice saves automatically.

The main-menu slideshow has 15 views: course overviews, later sections, the Sandbox ladder tower, and both community-route previews. Use the arrows to browse; automatic changes pause during gameplay.

**Menu music** is off by default. Turn it on in Settings if you want music in the main menu and pause screen. It pauses during gameplay and when the window loses focus.

## Credits

bhop_lego is by **Tony Montana**, with original textures by **Man Walker**. See the [map credits and license](maps/CREDITS.md), [movement sound credits](sounds/sources.json), and [music credits](music/sources.json).
