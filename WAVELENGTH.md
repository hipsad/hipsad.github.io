# Wavelength (multiplayer)

Static frontend in `wavelength/` (plain ES modules, no build step, works on GitHub Pages) backed by the existing Realtime Database project (`sprint-planner-5e1b0`). **Runs entirely on the free Spark plan**: there are no Cloud Functions. Game logic runs in the players' browsers and `database.rules.json` enforces the important checks server-side.

## Layout

| Path | Purpose |
| --- | --- |
| `shared/constants.js` | **Central constants**: scoring radii/points, limits, states, transitions |
| `shared/prompts.js` | 119 built-in `{high, low}` spectrum pairs |
| `shared/game-logic.js` | Pure rules: scoring, bands, prompt parser, state machine and a *planner* per action that turns the current room into one atomic multi-path update |
| `database.rules.json` | Security rules (also keeps the Sprint Planner `sessions` rules). Re-validates every planner update |
| `wavelength/` | UI: `js/dial.js` (SVG dial), `js/forms.js`, `js/app.js` (views), `js/api.js` (Firebase) |
| `test/` | `npm test` — runs planners against the real `database.rules.json` through a small rules evaluator (`test/rules-engine.js`) |

## Security model (Spark plan, "friends-trust")

* Every action is one multi-path `update()`; the rules check the transition (state machine, who may act, team capacity, role parity, score arithmetic, winner) so scores cannot be forged and a guess/reveal/next-turn cannot be applied twice.
* **Target visibility:** the target is stored in `wavelengthRooms/{code}/secret`. The read rule denies it to the active Guesser until the state is `reveal`/`finished`, and denies it to non-members. It is never in the public `game` node before the reveal. Spectators and the Psychic can read it.
* **Two-phase guess:** the Guesser cannot read the target, so they write only `lock = {turn, guess}` (once per turn). Any other player's browser (Psychic or spectator) then publishes the reveal; the rules recompute the difference, points, new score and winner from `lock` and `secret`. A "Reveal result" button is shown as a fallback if nobody does it automatically.
* Only room members can read anything in a room; rooms can't be read as a whole, only child nodes. Identity = Firebase Anonymous Auth.

**Honest limits** (without a trusted server these cannot be closed): the Psychic's browser picks the random target (a cheating Psychic can choose it); prompts are picked client-side; a member could take slots on two teams; the reveal needs one non-Guesser online. It is fine for playing with friends, not for competitive play. If you need these guarantees, use Cloud Functions on the Blaze plan.

The rules were tested with an in-repo evaluator (`npm test`), not the Firebase emulator, so do a real-device run (checklist below) after deploying.

## Required Firebase setup (one time, free)

1. **Authentication → Sign-in method → enable Anonymous.** Make sure `hipsad.github.io` is in *Authorized domains*.
2. Publish the rules: either paste `database.rules.json` into **Realtime Database → Rules → Publish**, or
   ```bash
   npm i -g firebase-tools && firebase login
   firebase use sprint-planner-5e1b0
   firebase deploy --only database
   ```
   This **replaces the rules currently in the console** (the existing `sessions` rules are preserved).
3. The frontend deploys as before through GitHub Pages.

The Wavelength client and Sprint Planner intentionally share the existing `sprint-planner-5e1b0` Firebase project and Realtime Database URL. Wavelength rooms live under `/wavelengthRooms/{code}`; room creation writes only to that individual code path, and the database rules atomically allow creation only when that code does not already exist. The client does not read `/wavelengthRooms` or grant broad parent-level access. Because non-members cannot read room contents (including the hidden target), a denied write is logged and surfaced rather than guessed to be a collision and silently retried. Deploy the updated rules file so the console uses the same namespace; no public-access rules are needed.

## Game rules implemented

* Rooms: 5-char codes from an unambiguous alphabet (≈33M combinations; an atomic create at the individual code path refuses to overwrite an existing room). Invite link `…/wavelength/?room=CODE`.
* 2–4 teams of exactly 2, configurable target score (default 10), prompt mode built-in / custom / mixed, optional team names.
* Host can assign/unassign/remove players; start is blocked until every team has exactly 2 players.
* States: `lobby → clue → guessing → reveal → (clue | finished)`; other transitions are rejected. Roles alternate per team every time it plays. Scoring: within 5 → 2, within 15 → 1 (edit `shared/constants.js`, and keep the numbers in `database.rules.json`; a test checks they match). First team ≥ target wins (tie-break: highest score, then the active team, then lowest index).
* Custom prompts: `(higher, lower)` per line; first value = right/100 end.
* Leaving mid-game returns the room to the lobby with a notice. If the host leaves, hosting transfers; if the host is offline any member can "Take over as host". Empty rooms are deleted; with no scheduler on Spark, rooms idle for 24 h can be deleted by anyone who tries (rules allow it) and the host can always delete theirs.

## Tests

`npm test` covers scoring boundaries, turn rotation, role alternation, prompt parsing, win conditions, invalid transitions, duplicate submissions and permission boundaries (incl. the Guesser being unable to read the target) by replaying full multi-player games through the rules.

## Manual 4-player test checklist

1. Device A: open `/wavelength/`, enter a name, create a room (2 teams, target 4). Copy the invite link.
2. Devices B, C, D: open the link, enter names, join. All appear in the lobby with green dots.
3. Everyone picks a team; a third player trying a full team is refused. Start stays disabled until both teams are 2/2.
4. Refresh device B in the lobby: same slot, no duplicate.
5. Host starts. The Psychic and the other team see the target; the Guesser's dial shows no target (and reading `wavelengthRooms/<code>/secret` from the Guesser's session is denied).
6. Psychic taps "I've given my clue"; the Guesser drags the needle (touch and mouse) and other devices see it move; the Psychic cannot move it.
7. Guesser locks in: within a second another device publishes the reveal; target animates in on all devices, points and scoreboard update; double-tapping only scores once.
8. The other team plays next; each team's roles swap on its second turn.
9. Play to the target score: Game over screen; host "Play again" returns to the lobby with the same teams.
10. Close one device mid-turn: its dot turns grey, the host can remove it; leaving mid-game returns everyone to the lobby with a notice.

## Scoring and game modes

* **Scoring:** within 1 of the target = 3 points, within 5 = 2, within 15 = 1 (both modes). Constants live in `shared/constants.js`; the rules file mirrors them.
* **Co-op mode** (`settings.gameMode = 'coop'`): no teams; everyone is on `t0`. The Psychic rotates through players in join order; every other player locks their own guess under `locks/{uid}`. Only the Psychic can read the target and publishes the reveal once everyone has locked in. The team score is the sum of the guessers' points; if nobody scores, the Psychic costs the team 1 point (the shared score can go negative). The rules verify the target and the score arithmetic but cannot re-sum the individual locks.
