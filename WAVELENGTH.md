# Wavelength (multiplayer)

Static frontend in `wavelength/` (plain ES modules, no build step, works on GitHub Pages) plus a small trusted backend in `functions/` (Cloud Functions) and `database.rules.json` (Realtime Database rules). The existing Firebase project (`sprint-planner-5e1b0`, Realtime Database) is reused.

## Layout

| Path | Purpose |
| --- | --- |
| `shared/constants.js` | **Central constants**: scoring radii/points, limits, states, transitions |
| `shared/prompts.js` | 119 built-in `{high, low}` spectrum pairs |
| `shared/game-logic.js` | Pure rules: scoring, bands, prompt parser, state machine, reducers for every action. Used by the browser (display only) *and* by Cloud Functions (authoritative) |
| `functions/index.js` | `roomAction` callable (runs reducers in an RTDB transaction), `cleanupRooms` scheduler |
| `database.rules.json` | Security rules (also keeps the Sprint Planner `sessions` rules) |
| `wavelength/` | UI: `js/dial.js` (SVG dial), `js/forms.js`, `js/app.js` (views), `js/api.js` (Firebase) |
| `test/` | `npm test` — scoring, rotation, roles, parsing, win condition, transitions, duplicates, rules structure |

## Security model

* Clients **cannot write** `rooms/*` at all. Joins, team changes, starting, clues, guesses, scoring and turn advancement are done by the `roomAction` Cloud Function inside a transaction, so duplicate submissions fail with `invalid-state` and scores can't be forged.
* The true target lives in `rooms/{code}/server` (no client read rule, so unreadable). Each turn the function copies it to `rooms/{code}/secret/{uid}` for **every player except the active Guesser**; rules allow only that uid to read its own secret. It is deleted at reveal and then published in `game.result`.
* Only room members can read `meta`, `players`, `game`, presence and the live needle. Only the active Guesser can write `live/{code}/pos`, and only during `guessing`.
* Identity = Firebase Anonymous Auth (persisted by the browser), so refreshing keeps your slot; joining twice never creates a duplicate.

## Required Firebase setup (one time)

1. **Authentication → Sign-in method → enable Anonymous.** Make sure `hipsad.github.io` is in *Authorized domains*.
2. **Upgrade to the Blaze plan** (Cloud Functions and Cloud Scheduler require it; usage for this game is tiny).
3. `npm i -g firebase-tools && firebase login`
4. From the repo root:
   ```bash
   firebase use sprint-planner-5e1b0
   (cd functions && npm install)
   firebase deploy --only database,functions
   ```
   Deploying functions runs `npm run sync-shared`, which copies `shared/` into `functions/shared/` (git-ignored).
   Deploying `database` **replaces the rules currently in the console** with `database.rules.json` (the existing `sessions` rules are preserved in it, and the `rooms` index on `meta/updatedAt` used by cleanup is included).
5. A different RTDB URL can be supplied to the function via the `DATABASE_URL` env var (or edit `functions/index.js`). The callable runs in `us-central1`, which the client uses by default.
6. The frontend deploys as before through the existing GitHub Pages workflow.

## Game rules implemented

* Rooms: 5-char codes from an unambiguous alphabet (≈33M combinations, uniqueness enforced in a transaction). Invite link `…/wavelength/?room=CODE`.
* 2–4 teams of exactly 2, configurable target score (default 10), prompt mode built-in / custom / mixed, optional team names.
* Host can assign/unassign/remove players; start is blocked until every team has exactly 2 players and nobody is unassigned.
* States: `lobby → clue → guessing → reveal → (clue | finished)`; other transitions are rejected. Roles alternate per team every time it plays. Scoring: within 5 → 2, within 15 → 1 (edit `shared/constants.js`). First team ≥ target wins (tie-break: highest score, then the active team, then lowest index).
* Custom prompts: `(higher, lower)` per line; first value = right/100 end.
* Leaving mid-game returns the room to the lobby with a notice. If the host leaves, hosting transfers; if the host is offline any member can "Take over as host". Empty rooms are deleted; rooms idle for 24 h are removed by `cleanupRooms` (every 6 h).

## Tests

`npm test` runs the logic tests and a structural check of the rules file. Behavioural rules tests need the Firebase emulator, which is not included.

## Manual 4-player test checklist

1. Device A: open `/wavelength/`, enter a name, create a room (2 teams, target 4). Copy the invite link.
2. Devices B, C, D: open the link, enter names, join. All appear in the lobby with green dots.
3. Everyone picks a team; a third player trying a full team is refused. Start stays disabled until both teams are 2/2.
4. Refresh device B in the lobby: same slot, no duplicate.
5. Host starts. The Psychic and the other team see the target; the Guesser's dial shows no target (and `secret/<guesser uid>` does not exist in the database).
6. Psychic taps "I've given my clue"; the Guesser drags the needle (touch and mouse) and other devices see it move; the Psychic cannot move it.
7. Guesser locks in: target animates in on all devices, points and scoreboard update; double-tapping only scores once.
8. The other team plays next; each team's roles swap on its second turn.
9. Play to the target score: Game over screen; host "Play again" returns to the lobby with the same teams.
10. Close one device mid-turn: its dot turns grey, the host can remove it; leaving mid-game returns everyone to the lobby with a notice.
