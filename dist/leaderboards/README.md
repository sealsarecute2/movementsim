# Leaderboards

Starter course and bhop_lego have shared leaderboards. Endless, Sandbox, and local imports do not.

Choose the map's file on GitHub and add one real, clean run per line:

| Map | Record file |
| --- | --- |
| Starter course | [course.txt](https://github.com/sealsarecute2/movementsim/edit/main/leaderboards/course.txt) |
| bhop_lego | [bhop_lego-v2.txt](https://github.com/sealsarecute2/movementsim/edit/main/leaderboards/bhop_lego-v2.txt) |

```text
seals_are_cute | 00:23.456 | classic
Another player | 22.150 | practice
```

Use `classic` for CS-style or `practice` for Bhop practice. Time accepts `MM:SS.mmm` or seconds. The game sorts each mode separately and keeps each player's fastest record. Lines beginning with `#` are comments.

The bhop_lego file is for revision 2 of the plain-block route. Keep records from other map versions separate. Returning to a checkpoint or restoring a run after refresh makes it a practice attempt, so do not publish that time as a clean run.

Commit the change and allow GitHub Pages to deploy it, then press Refresh in the game's leaderboard. Only repository editors can publish records; players cannot submit entries through the game. Edit the root file, which the build mirrors into `dist/leaderboards/` for local preview.
