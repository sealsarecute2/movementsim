# Add leaderboard records

Open a course file below, add one record per line, and commit the change on GitHub. You must be signed in to an account with write access to this repository. Players cannot add records through the game.

```text
Youhong | 00:23.456 | classic
Another player | 22.150 | practice
```

Use real records only. The name, time, and mode are separated by `|`. Mode is `classic` (CS-style) or `practice` (Bhop practice); omitting it means `classic`. Endless takes whole-number distance in Source units instead of time.

| Course | Edit its text file |
| --- | --- |
| Starter course | [course.txt](https://github.com/sealsarecute2/movementsim/edit/main/leaderboards/course.txt) |
| Momentum Mile | [momentum.txt](https://github.com/sealsarecute2/movementsim/edit/main/leaderboards/momentum.txt) |
| Zigzag Alley | [zigzag.txt](https://github.com/sealsarecute2/movementsim/edit/main/leaderboards/zigzag.txt) |
| Skyline Ascent | [skyline.txt](https://github.com/sealsarecute2/movementsim/edit/main/leaderboards/skyline.txt) |
| Broken Circuit | [circuit.txt](https://github.com/sealsarecute2/movementsim/edit/main/leaderboards/circuit.txt) |
| Balance Lab | [balance.txt](https://github.com/sealsarecute2/movementsim/edit/main/leaderboards/balance.txt) |
| Underpass | [underpass.txt](https://github.com/sealsarecute2/movementsim/edit/main/leaderboards/underpass.txt) |
| Needleworks | [needles.txt](https://github.com/sealsarecute2/movementsim/edit/main/leaderboards/needles.txt) |
| The Gauntlet | [gauntlet.txt](https://github.com/sealsarecute2/movementsim/edit/main/leaderboards/gauntlet.txt) |
| Endless | [endless.txt](https://github.com/sealsarecute2/movementsim/edit/main/leaderboards/endless.txt) |

Lines beginning with `#` are comments. Remove the `#` from an example only after replacing it with a real score. Sorting is automatic: fastest time wins, or longest distance on Endless. Each player's best result is kept separately in each mode.

After committing, allow GitHub Pages to publish the change, then press **Refresh** in the game's leaderboard. No backend account, secret key, or database setup is needed. Edit these root files; generated copies in `dist/leaderboards/` are for local preview.
