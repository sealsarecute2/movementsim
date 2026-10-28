# Starter leaderboard

Only Starter course has a cloud leaderboard. Endless and Sandbox remain available without cloud boards.

Edit [course.txt](https://github.com/sealsarecute2/movementsim/edit/main/leaderboards/course.txt) on GitHub and add one real record per line:

```text
seals_are_cute | 00:23.456 | classic
Another player | 22.150 | practice
```

Use `classic` for CS-style or `practice` for Bhop practice. Time accepts `MM:SS.mmm` or seconds. The game sorts each mode separately and keeps each player's fastest record. Lines beginning with `#` are comments.

Commit the change and allow GitHub Pages to deploy it, then press Refresh in the game's leaderboard. Only repository editors can publish records; players cannot submit entries through the game. Edit the root file, which the build mirrors into `dist/leaderboards/` for local preview.
