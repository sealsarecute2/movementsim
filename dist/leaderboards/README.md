# Add leaderboard records

Open a course file below, add one record per line, and commit the change on GitHub. You must be signed in to an account with write access to this repository. Players cannot add records through the game.

```text
seals_are_cute | 00:23.456 | classic
Another player | 22.150 | practice
```

Use real records only. The name, time, and mode are separated by `|`. Mode is `classic` (CS-style) or `practice` (Bhop practice); omitting it means `classic`. Endless takes whole-number distance in Source units instead of time.

| Course | Edit its text file |
| --- | --- |
| Starter course | [course.txt](https://github.com/sealsarecute2/movementsim/edit/main/leaderboards/course.txt) |
| Overdrive | [momentum-v2.txt](https://github.com/sealsarecute2/movementsim/edit/main/leaderboards/momentum-v2.txt) |
| Blindside | [zigzag-v2.txt](https://github.com/sealsarecute2/movementsim/edit/main/leaderboards/zigzag-v2.txt) |
| Vertigo | [skyline-v2.txt](https://github.com/sealsarecute2/movementsim/edit/main/leaderboards/skyline-v2.txt) |
| Switchback Foundry | [circuit-v2.txt](https://github.com/sealsarecute2/movementsim/edit/main/leaderboards/circuit-v2.txt) |
| Razorwire | [balance-v2.txt](https://github.com/sealsarecute2/movementsim/edit/main/leaderboards/balance-v2.txt) |
| Compression | [underpass-v2.txt](https://github.com/sealsarecute2/movementsim/edit/main/leaderboards/underpass-v2.txt) |
| Deadpoint | [needles-v2.txt](https://github.com/sealsarecute2/movementsim/edit/main/leaderboards/needles-v2.txt) |
| Blackout | [gauntlet-v2.txt](https://github.com/sealsarecute2/movementsim/edit/main/leaderboards/gauntlet-v2.txt) |
| Endless | [endless-v2.txt](https://github.com/sealsarecute2/movementsim/edit/main/leaderboards/endless-v2.txt) |

The rebuilt layouts use **v2** files so their times do not mix with old records. The original files remain as history. Starter course and its records are unchanged.

Lines beginning with `#` are comments. Remove the `#` from an example only after replacing it with a real score. Sorting is automatic: fastest time wins, or longest distance on Endless. Each player's best result is kept separately in each mode.

After committing, allow GitHub Pages to publish the change, then press **Refresh** in the game's leaderboard. No backend account, secret key, or database setup is needed. Edit these root files; generated copies in `dist/leaderboards/` are for local preview.
