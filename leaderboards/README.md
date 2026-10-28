# Leaderboards

Starter course, Bhop School, Ladder Run, both community maps, and Endless have shared leaderboards. Sandbox and local imports do not.

Choose the map's file on GitHub and add one real, clean run per line:

| Map | Record file |
| --- | --- |
| Starter course | [course.txt](https://github.com/sealsarecute2/movementsim/edit/main/leaderboards/course.txt) |
| Bhop School | [bhop-school.txt](https://github.com/sealsarecute2/movementsim/edit/main/leaderboards/bhop-school.txt) |
| Ladder Run | [ladder-run.txt](https://github.com/sealsarecute2/movementsim/edit/main/leaderboards/ladder-run.txt) |
| bhop_lego | [bhop_lego-v2.txt](https://github.com/sealsarecute2/movementsim/edit/main/leaderboards/bhop_lego-v2.txt) |
| bhop_kitsune | [bhop_kitsune-v3.txt](https://github.com/sealsarecute2/movementsim/edit/main/leaderboards/bhop_kitsune-v3.txt) |
| Endless | [endless-v3.txt](https://github.com/sealsarecute2/movementsim/edit/main/leaderboards/endless-v3.txt) |

```text
seals_are_cute | 00:23.456 | classic
Another player | 22.150 | practice
```

Use `classic` for CS-style or `practice` for Bhop practice. Time accepts `MM:SS.mmm` or seconds. The game sorts each mode separately and keeps each player's fastest record. Lines beginning with `#` are comments.

The community boards use revision 2 of bhop_lego and revision 3 of bhop_kitsune, which removes wall and roof shortcuts. Keep times from other map versions separate. Returning to a checkpoint or restoring a timed run after refresh makes it a practice attempt, so do not publish that time as a clean run. Kitsune's stage portals are normal course progression.

For Endless, record a whole-number distance in units instead of a time, for example `Player | 12345 | practice`. Higher distances rank first. The revision 3 board uses the route pool without wall wraps. Old local distance records remain stored separately.

Commit the change and allow GitHub Pages to deploy it, then press Refresh in the game's leaderboard. Only repository editors can publish records; players cannot submit entries through the game. Edit the root file, which the build mirrors into `dist/leaderboards/` for local preview.
