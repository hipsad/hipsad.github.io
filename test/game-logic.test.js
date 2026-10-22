const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../shared/game-logic.js');
const { BUILTIN_PROMPTS } = require('../shared/prompts.js');
const { STATES } = require('../shared/constants.js');
const { Sim, mkRng } = require('./harness.js');

const gameErr = (fn, code) => assert.throws(fn, (e) => e instanceof S.GameError && e.code === code);
const ok = (r) => assert.equal(r.ok, true, r.reason);
const denied = (r) => assert.equal(r.ok, false);

test('scoring boundaries', () => {
  assert.equal(S.scoreGuess(50, 50), 3);
  assert.equal(S.scoreGuess(50, 51), 3);
  assert.equal(S.scoreGuess(50, 49), 3);
  assert.equal(S.scoreGuess(50, 51.1), 2);
  assert.equal(S.scoreGuess(50, 55), 2);
  assert.equal(S.scoreGuess(50, 45), 2);
  assert.equal(S.scoreGuess(50, 55.1), 1);
  assert.equal(S.scoreGuess(50, 65), 1);
  assert.equal(S.scoreGuess(50, 35), 1);
  assert.equal(S.scoreGuess(50, 65.1), 0);
  assert.equal(S.scoreGuess(50, 34.9), 0);
});

test('scoring bands are aligned and clipped', () => {
  assert.deepEqual(S.scoringBands(50), [
    { from: 35, to: 45, points: 1 }, { from: 45, to: 49, points: 2 }, { from: 49, to: 51, points: 3 },
    { from: 51, to: 55, points: 2 }, { from: 55, to: 65, points: 1 }]);
  assert.deepEqual(S.scoringBands(2), [{ from: 0, to: 1, points: 2 }, { from: 1, to: 3, points: 3 }, { from: 3, to: 7, points: 2 }, { from: 7, to: 17, points: 1 }]);
  assert.deepEqual(S.scoringBands(100), [{ from: 85, to: 95, points: 1 }, { from: 95, to: 99, points: 2 }, { from: 99, to: 100, points: 3 }]);
});

test('prompt parsing', () => {
  const ok1 = S.parsePrompts('  (Expensive ,  Cheap)\n\n(Hot, Cold)  \r\n(Great   Movie, Terrible Movie)');
  assert.deepEqual(ok1.errors, []);
  assert.deepEqual(ok1.prompts[0], { high: 'Expensive', low: 'Cheap' });
  assert.equal(ok1.prompts[2].high, 'Great Movie');
  const bad = S.parsePrompts('Hot, Cold\n(Hot Cold)\n(Hot, )\n(, Cold)\n(a, b, c)\n((a), b)\n(<b>x</b>, y)\n()');
  assert.equal(bad.prompts.length, 0);
  assert.deepEqual(bad.errors.map((e) => e.line), [1, 2, 3, 4, 5, 6, 7, 8]);
});

test('built-in library is large and unique', () => {
  assert.ok(BUILTIN_PROMPTS.length >= 100);
  assert.equal(new Set(BUILTIN_PROMPTS.map((p) => p.high + '|' + p.low)).size, BUILTIN_PROMPTS.length);
});

test('prompts do not repeat until exhausted, then restart', () => {
  const pool = [{ high: 'a', low: 'b' }, { high: 'c', low: 'd' }, { high: 'e', low: 'f' }];
  const rng = mkRng(3);
  let used = [];
  const seen = [];
  for (let i = 0; i < 3; i++) { const r = S.drawPrompt(pool, used, rng); seen.push(r.prompt.high); used = r.used; }
  assert.equal(new Set(seen).size, 3);
  assert.equal(S.drawPrompt(pool, used, rng).used.length, 1);
});

test('settings validation and prompt modes', () => {
  gameErr(() => S.sanitizeSettings({ teamCount: 0 }), 'invalid-argument');
  gameErr(() => S.sanitizeSettings({ targetScore: 0 }), 'invalid-argument');
  gameErr(() => S.sanitizeSettings({ promptMode: 'custom' }), 'invalid-argument');
  gameErr(() => S.sanitizeSettings({ customPromptsText: 'oops' }), 'invalid-argument');
  const s = S.sanitizeSettings({});
  assert.equal(s.teamCount, 2); assert.equal(s.targetScore, 10); assert.deepEqual(s.teamNames, ['Team 1', 'Team 2']);
  const m = S.sanitizeSettings({ promptMode: 'mixed', customPromptsText: '(a, b)' });
  assert.equal(S.promptPool(m).length, BUILTIN_PROMPTS.length + 1);
  assert.equal(S.promptPool({ ...m, promptMode: 'custom' }).length, 1);
});

test('room codes', () => {
  assert.ok(S.isValidRoomCode(S.generateRoomCode(mkRng(5))));
  assert.ok(!S.isValidRoomCode('ABC'));
  assert.ok(!S.isValidRoomCode('ABCD0'));
  assert.equal(S.normalizeRoomCode(' ab-c12 '), 'ABC12');
});

test('winner tie-break and state machine', () => {
  assert.equal(S.determineWinner([5, 3], 10, 0), null);
  assert.equal(S.determineWinner([12, 12], 10, 1), 1);
  assert.equal(S.determineWinner([12, 12, 3], 10, 2), 0);
  assert.ok(S.canTransition('lobby', 'clue'));
  assert.ok(!S.canTransition('clue', 'reveal'));
  assert.ok(!S.canTransition('finished', 'clue'));
  assert.throws(() => S.transition({ state: 'finished' }, 'guessing'), S.GameError);
});

/* ---------- lobby ---------- */
test('lobby: join is idempotent, teams hold 2, only host starts, start needs full teams', () => {
  const sim = new Sim();
  ok(sim.create('p0'));
  denied(sim.create('p9', 'Intruder')); // room code collision: existing room cannot be overwritten
  for (let i = 1; i < 4; i++) ok(sim.join('p' + i, 'P' + i));
  ok(sim.join('p1', 'Renamed')); // reconnect: no duplicate slot
  assert.equal(Object.keys(sim.data('wavelengthRooms/ABCDE/players')).length, 4);
  assert.equal(sim.data('wavelengthRooms/ABCDE/players/p1/name'), 'Renamed');
  ok(sim.act('p0', 'setTeam', { team: 0 }));
  ok(sim.act('p1', 'setTeam', { team: 0 }));
  gameErr(() => sim.act('p2', 'setTeam', { team: 0 }), 'team-full');
  gameErr(() => sim.act('p0', 'startGame'), 'lobby-not-ready');
  ok(sim.act('p2', 'setTeam', { team: 1 }));
  ok(sim.act('p3', 'setTeam', { team: 1 }));
  gameErr(() => sim.act('p1', 'startGame'), 'permission-denied');
  gameErr(() => sim.act('p1', 'setTeam', { team: 1, targetUid: 'p2' }), 'permission-denied');
  // forged start by a non-host straight to the database
  denied(sim.raw('p1', { 'wavelengthRooms/{code}/game': { state: 'clue', turn: 1, activeKey: 't0', scores: { t0: 0, t1: 0, t2: 0, t3: 0 }, teamTurns: { t0: 1, t1: 0, t2: 0, t3: 0 }, psychicUid: 'p0', guesserUid: 'p1', prompt: { high: 'a', low: 'b' } } }));
  ok(sim.act('p0', 'startGame'));
  assert.equal(sim.game().state, STATES.CLUE);
});

test('team slots cannot be claimed twice concurrently or overfilled by raw writes', () => {
  const sim = new Sim();
  sim.create('p0');
  for (let i = 1; i < 4; i++) sim.join('p' + i, 'P' + i);
  ok(sim.act('p0', 'setTeam', { team: 0 }));
  ok(sim.act('p1', 'setTeam', { team: 0 }));
  // p2 and p3 both planned from a stale view; the slot is taken so the rules reject the write
  denied(sim.raw('p2', { 'wavelengthRooms/{code}/teams/t0/a': 'p2' }));
  denied(sim.raw('p2', { 'wavelengthRooms/{code}/teams/t0/b': 'p2' }));
  denied(sim.raw('p2', { 'wavelengthRooms/{code}/teams/t3/a': 'p2' })); // team does not exist (2 teams)
  denied(sim.raw('p2', { 'wavelengthRooms/{code}/teams/t1/a': 'p3' })); // cannot place someone else
  ok(sim.raw('p2', { 'wavelengthRooms/{code}/teams/t1/a': 'p2' }));
  denied(sim.raw('p2', { 'wavelengthRooms/{code}/teams/t1/b': 'p2' })); // same player in both slots
});

test('non-members: cannot read, join a running game, or join a missing room', () => {
  const sim = new Sim().lobby4();
  assert.equal(sim.db.read('x', 'wavelengthRooms/ABCDE/meta').denied, true);
  assert.equal(sim.db.read('x', 'wavelengthRooms/ABCDE/game').denied, true);
  assert.equal(sim.db.read('x', 'wavelengthRooms/ABCDE/players').denied, true);
  ok(sim.join('late', 'Late')); // lobby joins are allowed
  ok(sim.act('p0', 'startGame'));
  denied(sim.join('later', 'Later'));
  const other = new Sim('ZZZZZ');
  denied(other.join('x', 'X')); // nonexistent room
});

test('settings: host only, lobby only, shrinking teams clears their slots', () => {
  const sim = new Sim();
  sim.create('p0', 'Host', { teamCount: 3 });
  for (let i = 1; i < 6; i++) sim.join('p' + i, 'P' + i);
  for (let i = 0; i < 6; i++) sim.act('p' + i, 'setTeam', { team: Math.floor(i / 2) });
  gameErr(() => sim.act('p1', 'updateSettings', { teamCount: 2 }), 'permission-denied');
  denied(sim.raw('p1', { 'wavelengthRooms/{code}/meta/settings/targetScore': 1 }));
  ok(sim.act('p0', 'updateSettings', { teamCount: 2, targetScore: 6, promptMode: 'mixed', customPromptsText: '(Hot, Cold)' }));
  assert.equal(sim.data('wavelengthRooms/ABCDE/teams/t2'), undefined);
  assert.equal(sim.data('wavelengthRooms/ABCDE/meta/settings/targetScore'), 6);
  assert.equal(sim.data('wavelengthRooms/ABCDE/meta/settings/customPrompts/0/high'), 'Hot');
  // oversized / out of range values are rejected by the rules
  denied(sim.raw('p0', { 'wavelengthRooms/{code}/meta/settings': { teamCount: 9, targetScore: 5, promptMode: 'builtin', teamNames: ['a'] } }));
});

/* ---------- visibility ---------- */
test('target is hidden from the guesser until reveal; psychic and spectators see it', () => {
  const sim = new Sim().lobby4();
  ok(sim.act('p0', 'startGame'));
  const g = sim.game();
  assert.equal(g.psychicUid, 'p0'); assert.equal(g.guesserUid, 'p1');
  gameErr(() => sim.act('p0', 'clueGiven'), 'invalid-state'); // target not yet set
  denied(sim.raw('p1', { 'wavelengthRooms/{code}/secret': { target: 50, turn: 1 } })); // guesser cannot choose the target
  denied(sim.raw('p2', { 'wavelengthRooms/{code}/secret': { target: 50, turn: 1 } })); // neither can a spectator
  ok(sim.act('p0', 'writeTarget'));
  assert.equal(sim.db.read('p1', 'wavelengthRooms/ABCDE/secret').denied, true);
  assert.equal(sim.db.read('p1', 'wavelengthRooms/ABCDE/secret/target').denied, true);
  assert.equal(sim.db.read('p0', 'wavelengthRooms/ABCDE/secret/target').denied, false);
  assert.equal(sim.db.read('p2', 'wavelengthRooms/ABCDE/secret/target').denied, false);
  assert.equal(sim.db.read('p3', 'wavelengthRooms/ABCDE/secret/target').denied, false);
  assert.equal(sim.db.read('x', 'wavelengthRooms/ABCDE/secret/target').denied, true);
  denied(sim.raw('p0', { 'wavelengthRooms/{code}/secret': { target: 10, turn: 1 } })); // cannot re-roll the same turn
  // the public game node never contains the target before the reveal
  assert.equal(sim.game().result, undefined);
  assert.equal(sim.game().target, undefined);
  ok(sim.act('p0', 'clueGiven'));
  assert.equal(sim.db.read('p1', 'wavelengthRooms/ABCDE/secret/target').denied, true);
  ok(sim.act('p1', 'lockGuess', { guess: 40 }));
  assert.equal(sim.db.read('p1', 'wavelengthRooms/ABCDE/secret/target').denied, true); // still hidden after locking, until reveal
  ok(sim.act('p2', 'reveal'));
  assert.equal(sim.db.read('p1', 'wavelengthRooms/ABCDE/secret/target').denied, false);
  assert.equal(sim.game().result.guess, 40);
});

/* ---------- turn flow ---------- */
test('turn flow: roles, duplicate submissions, invalid transitions, forged results', () => {
  const sim = new Sim().lobby4();
  sim.act('p0', 'startGame');
  gameErr(() => sim.act('p0', 'startGame'), 'invalid-state');
  gameErr(() => sim.act('p1', 'lockGuess', { guess: 10 }), 'invalid-state'); // still in clue
  gameErr(() => sim.act('p0', 'reveal'), 'invalid-state');
  gameErr(() => sim.act('p0', 'nextTurn'), 'invalid-state');
  gameErr(() => sim.act('p1', 'clueGiven'), 'permission-denied');
  sim.act('p0', 'writeTarget');
  const target = sim.data('wavelengthRooms/ABCDE/secret/target');
  ok(sim.act('p0', 'clueGiven'));
  gameErr(() => sim.act('p0', 'clueGiven'), 'invalid-state');
  gameErr(() => sim.act('p0', 'lockGuess', { guess: 10 }), 'permission-denied'); // psychic cannot guess
  gameErr(() => sim.act('p2', 'lockGuess', { guess: 10 }), 'permission-denied');
  for (const bad of [-1, 101, NaN, 'x', null, undefined, true, '']) gameErr(() => sim.act('p1', 'lockGuess', { guess: bad }), 'invalid-argument');
  denied(sim.raw('p1', { 'wavelengthRooms/{code}/lock': { turn: 1, guess: 500 } }));
  denied(sim.raw('p0', { 'wavelengthRooms/{code}/lock': { turn: 1, guess: 50 } }));
  ok(sim.act('p1', 'lockGuess', { guess: target }));
  gameErr(() => sim.act('p1', 'lockGuess', { guess: 1 }), 'invalid-state'); // duplicate
  denied(sim.raw('p1', { 'wavelengthRooms/{code}/lock': { turn: 1, guess: 1 } })); // duplicate, bypassing the client check
  gameErr(() => sim.act('p1', 'reveal'), 'permission-denied'); // guesser cannot reveal
  // forged reveals straight to the database
  const g = sim.game();
  const forged = (over) => ({ ...g, state: 'reveal', scores: { ...g.scores, t0: 3 }, result: { guess: target, target, diff: 0, points: 3, ...over.result }, ...over.game });
  denied(sim.raw('p1', { 'wavelengthRooms/{code}/game': forged({}) }));
  denied(sim.raw('p0', { 'wavelengthRooms/{code}/game': forged({ result: { points: 1 } }) }));
  denied(sim.raw('p0', { 'wavelengthRooms/{code}/game': forged({ game: { scores: { ...g.scores, t0: 9 } } }) }));
  denied(sim.raw('p0', { 'wavelengthRooms/{code}/game': forged({ game: { scores: { ...g.scores, t1: 2, t0: 0 } } }) }));
  denied(sim.raw('p0', { 'wavelengthRooms/{code}/game': forged({ result: { target: target + 1 } }) }));
  ok(sim.act('p2', 'reveal'));
  gameErr(() => sim.act('p3', 'reveal'), 'invalid-state'); // duplicate reveal
  assert.equal(sim.game().result.points, 3);
  assert.equal(sim.game().scores.t0, 3);
  gameErr(() => sim.act('p2', 'nextTurn'), 'permission-denied'); // other team cannot advance
  ok(sim.act('p1', 'nextTurn')); // active team may
  const next = sim.game();
  assert.equal(next.activeKey, 't1');
  assert.equal(next.state, STATES.CLUE);
  assert.equal(next.scores.t0, 3); // scores preserved
  assert.equal(next.result, undefined);
  gameErr(() => sim.act('p1', 'nextTurn'), 'invalid-state');
});

test('points are computed from the real target (miss, side, centre, bullseye)', () => {
  const pts = [];
  for (const off of [0, 1, 4, 10, 40]) {
    const sim = new Sim().lobby4();
    sim.act('p0', 'startGame');
    sim.act('p0', 'writeTarget');
    const t = sim.data('wavelengthRooms/ABCDE/secret/target');
    const sign = t > 50 ? -1 : 1;
    sim.act('p0', 'clueGiven');
    sim.act('p1', 'lockGuess', { guess: t + sign * off });
    sim.act('p2', 'reveal');
    pts.push(sim.game().result.points);
  }
  assert.deepEqual(pts, [3, 3, 2, 1, 0]);
});

test('team rotation and role alternation', () => {
  const sim = new Sim();
  sim.create('p0', 'Host', { teamCount: 3, targetScore: 100 });
  for (let i = 1; i < 6; i++) sim.join('p' + i, 'P' + i);
  for (let i = 0; i < 6; i++) sim.act('p' + i, 'setTeam', { team: Math.floor(i / 2) });
  sim.act('p0', 'startGame');
  const seen = [];
  for (let i = 0; i < 6; i++) {
    const g = sim.game();
    seen.push([g.activeKey, g.psychicUid, g.guesserUid]);
    sim.act(g.psychicUid, 'writeTarget'); sim.act(g.psychicUid, 'clueGiven');
    sim.act(g.guesserUid, 'lockGuess', { guess: 0 });
    const other = ['p0', 'p1', 'p2', 'p3', 'p4', 'p5'].find((u) => u !== g.guesserUid);
    sim.act(other, 'reveal');
    sim.act('p0', 'nextTurn');
  }
  assert.deepEqual(seen, [
    ['t0', 'p0', 'p1'], ['t1', 'p2', 'p3'], ['t2', 'p4', 'p5'],
    ['t0', 'p1', 'p0'], ['t1', 'p3', 'p2'], ['t2', 'p5', 'p4']]);
});

test('one team mode swaps roles every round', () => {
  const sim = new Sim();
  sim.create('p0', 'Host', { teamCount: 1, targetScore: 100 });
  sim.join('p1', 'P1');
  for (let i = 0; i < 2; i++) sim.act('p' + i, 'setTeam', { team: 0 });
  sim.act('p0', 'startGame');
  const seen = [];
  for (let i = 0; i < 3; i++) {
    const g = sim.game();
    seen.push([g.activeKey, g.psychicUid, g.guesserUid]);
    sim.act(g.psychicUid, 'writeTarget'); sim.act(g.psychicUid, 'clueGiven');
    sim.act(g.guesserUid, 'lockGuess', { guess: 0 });
    sim.act(g.psychicUid, 'reveal');
    sim.act('p0', 'nextTurn');
  }
  assert.deepEqual(seen, [['t0', 'p0', 'p1'], ['t0', 'p1', 'p0'], ['t0', 'p0', 'p1']]);
});

test('win condition, finish, play again', () => {
  const sim = new Sim().lobby4({ targetScore: 2 });
  sim.act('p0', 'startGame');
  const g = sim.playTurn(0);
  assert.equal(g.winnerKey, 't0');
  assert.equal(g.state, STATES.REVEAL);
  denied(sim.raw('p0', { 'wavelengthRooms/{code}/game': { ...g, state: 'clue' } })); // no going backwards
  gameErr(() => sim.act('p2', 'nextTurn'), 'permission-denied');
  ok(sim.act('p0', 'nextTurn'));
  assert.equal(sim.game().state, STATES.FINISHED);
  gameErr(() => sim.act('p0', 'nextTurn'), 'invalid-state');
  gameErr(() => sim.act('p1', 'playAgain'), 'permission-denied');
  ok(sim.act('p0', 'playAgain'));
  const fresh = sim.game();
  assert.equal(fresh.state, STATES.LOBBY);
  assert.deepEqual(fresh.scores, { t0: 0, t1: 0, t2: 0, t3: 0 });
  assert.equal(sim.data('wavelengthRooms/ABCDE/secret'), undefined);
  assert.equal(Object.keys(sim.data('wavelengthRooms/ABCDE/players')).length, 4);
  ok(sim.act('p0', 'startGame')); // new game works; stale lock/secret from before are gone
  ok(sim.act('p0', 'writeTarget'));
});

test('the higher score must win: a miss never ends the game and ties favour the active team', () => {
  const sim = new Sim().lobby4({ targetScore: 5 });
  sim.act('p0', 'startGame');
  assert.equal(sim.playTurn(0).winnerKey, undefined); // 3 < 5
  sim.act('p0', 'nextTurn');
  assert.equal(sim.playTurn(0).winnerKey, undefined);
  sim.act('p2', 'nextTurn');
  assert.equal(sim.playTurn(0).winnerKey, 't0'); // 6 >= 5
});

/* ---------- leaving, hosting, cleanup ---------- */
test('leaving mid-game returns to lobby; removal rules; host transfer; last player deletes the room', () => {
  const sim = new Sim().lobby4();
  sim.act('p0', 'startGame');
  gameErr(() => sim.act('p1', 'removePlayer', { targetUid: 'p2' }), 'permission-denied');
  denied(sim.raw('p1', { 'wavelengthRooms/{code}/players/p2': null }));
  ok(sim.act('p3', 'removePlayer'));
  assert.equal(sim.game().state, STATES.LOBBY);
  assert.match(sim.data('wavelengthRooms/ABCDE/meta/notice'), /left/);
  assert.equal(sim.data('wavelengthRooms/ABCDE/players/p3'), undefined);
  assert.equal(sim.data('wavelengthRooms/ABCDE/teams/t1/b'), undefined);
  ok(sim.act('p0', 'removePlayer', { targetUid: 'p2' })); // host removes a disconnected player
  ok(sim.act('p0', 'removePlayer')); // host leaves -> earliest remaining player becomes host
  assert.equal(sim.data('wavelengthRooms/ABCDE/meta/hostUid'), 'p1');
  ok(sim.act('p1', 'removePlayer')); // last one out deletes the room
  assert.equal(sim.data('wavelengthRooms/ABCDE'), undefined);
  assert.equal(sim.data('presence/ABCDE'), undefined);
});

test('claiming host requires the host to be offline in presence', () => {
  const sim = new Sim().lobby4();
  gameErr(() => sim.act('p1', 'claimHost', {}, { hostOnline: true }), 'invalid-state');
  denied(sim.act('p1', 'claimHost', {}, { hostOnline: false })); // presence says nothing about the host -> rules refuse
  ok(sim.raw('p0', { 'presence/{code}/p0': false }));
  ok(sim.act('p1', 'claimHost', {}, { hostOnline: false }));
  assert.equal(sim.data('wavelengthRooms/ABCDE/meta/hostUid'), 'p1');
  denied(sim.raw('p2', { 'wavelengthRooms/{code}/meta/hostUid': 'p2' })); // host is p1 and online
});

test('presence and live needle permissions', () => {
  const sim = new Sim().lobby4();
  ok(sim.raw('p1', { 'presence/{code}/p1': true }));
  denied(sim.raw('p1', { 'presence/{code}/p2': true }));
  denied(sim.raw('x', { 'presence/{code}/x': true }));
  sim.act('p0', 'startGame');
  denied(sim.raw('p1', { 'live/{code}': { pos: 10, turn: 1 } })); // clue phase
  sim.act('p0', 'writeTarget'); sim.act('p0', 'clueGiven');
  ok(sim.raw('p1', { 'live/{code}': { pos: 10, turn: 1 } }));
  denied(sim.raw('p0', { 'live/{code}': { pos: 10, turn: 1 } })); // psychic cannot move it
  denied(sim.raw('p2', { 'live/{code}': { pos: 10, turn: 1 } })); // neither can spectators
  denied(sim.raw('p1', { 'live/{code}': { pos: 101, turn: 1 } }));
  assert.equal(sim.db.read('p2', 'live/ABCDE').denied, false);
  assert.equal(sim.db.read('x', 'live/ABCDE').denied, true);
  sim.act('p1', 'lockGuess', { guess: 10 });
  sim.act('p2', 'reveal');
  denied(sim.raw('p1', { 'live/{code}': { pos: 11, turn: 1 } })); // locked after the guess
});

test('stale rooms can be deleted by anyone, fresh rooms only by the host', () => {
  const sim = new Sim().lobby4();
  denied(sim.raw('p1', { 'wavelengthRooms/{code}': null }));
  denied(sim.raw('x', { 'wavelengthRooms/{code}': null }));
  sim.db.now += 25 * 60 * 60 * 1000;
  ok(sim.raw('x', { 'wavelengthRooms/{code}': null }));
});

test('rules file stays in sync with the scoring constants and keeps the sprint planner rules', () => {
  const { SCORING } = require('../shared/constants.js');
  const rules = require('../database.rules.json').rules;
  const txt = rules.wavelengthRooms.$code.game['.write'];
  assert.ok(txt.includes(`<=${SCORING.BULLSEYE_RADIUS} ? ${SCORING.BULLSEYE_POINTS}`));
  assert.ok(txt.includes(`<=${SCORING.CENTER_RADIUS} ? ${SCORING.CENTER_POINTS}`));
  assert.ok(txt.includes(`<=${SCORING.SIDE_RADIUS} ? ${SCORING.SIDE_POINTS}`));
  assert.equal(rules.sessions.$sessionId['.read'], true);
  assert.equal(rules.wavelengthRooms.$code['.read'], undefined); // members read child nodes only, so `secret` stays protected
  assert.equal(rules.rooms, undefined);
});

/* ---------- co-op mode ---------- */
const targetOf = (sim) => sim.data('wavelengthRooms/ABCDE/secret/target');
const near = (t, o) => Math.min(100, Math.max(0, t + (t > 50 ? -o : o)));

test('shared mode: individual scores, everyone guesses, hidden target, Psychic reveals', () => {
  const sim = new Sim().lobbyCoop(3, { targetScore: 20 });
  gameErr(() => sim.act('p1', 'setTeam', { team: 0 }), 'invalid-state');
  sim.act('p0', 'startGame');
  assert.equal(sim.game().psychicUid, 'p0');
  gameErr(() => sim.act('p1', 'lockGuess', { guess: 5 }), 'invalid-state'); // still in clue
  sim.act('p0', 'writeTarget');
  assert.equal(sim.db.read("p1", "wavelengthRooms/ABCDE/secret").denied, true); // guessers cannot read the target
  sim.act('p0', 'clueGiven');
  gameErr(() => sim.act('p0', 'lockGuess', { guess: 5 }), 'permission-denied');
  gameErr(() => sim.act('p0', 'reveal'), 'invalid-state'); // nobody has locked
  const t = targetOf(sim);
  ok(sim.act('p1', 'lockGuess', { guess: near(t, 0) }));
  gameErr(() => sim.act('p1', 'lockGuess', { guess: 1 }), 'invalid-state');
  denied(sim.raw('p1', { 'wavelengthRooms/{code}/locks/p1': { turn: 1, guess: 1 } }));
  gameErr(() => sim.act('p0', 'reveal'), 'invalid-state'); // p2 has not locked
  ok(sim.act('p2', 'lockGuess', { guess: near(t, 4) }));
  gameErr(() => sim.act('p1', 'reveal'), 'permission-denied');
  ok(sim.act('p0', 'reveal'));
  assert.equal(sim.game().result.totalPoints, 5); // 3 + 2, awarded to the individual guessers
  assert.equal(sim.game().playerScores.p1, 3);
  assert.equal(sim.game().playerScores.p2, 2);
  assert.equal(sim.game().playerScores.p0, 0);
  assert.equal(sim.game().playerResults.p1.points, 3);
  assert.equal(sim.game().scores.t0, 0); // internal team-score marker remains unused until someone wins
  gameErr(() => sim.act('p1', 'nextTurn'), 'permission-denied');
});

test('shared mode: Psychic rotates, loses a point if everyone misses, and an individual wins', () => {
  const sim = new Sim().lobbyCoop(3, { targetScore: 3 });
  sim.act('p0', 'startGame');
  const seen = [];
  const play = (offset) => {
    seen.push(sim.game().psychicUid);
    sim.act(sim.game().psychicUid, 'writeTarget');
    sim.act(sim.game().psychicUid, 'clueGiven');
    const t = targetOf(sim);
    ['p0', 'p1', 'p2'].filter((u) => u !== sim.game().psychicUid)
      .forEach((u) => sim.act(u, 'lockGuess', { guess: near(t, offset) }));
    return sim.act(sim.game().psychicUid, 'reveal');
  };
  ok(play(50)); // everyone misses
  assert.equal(sim.game().result.psychicPenalty, 1);
  assert.equal(sim.game().playerScores.p0, -1);
  assert.equal(sim.game().playerScores.p1, 0);
  assert.equal(sim.game().playerScores.p2, 0);
  ok(sim.act('p0', 'nextTurn'));
  ok(play(0)); // each of two guessers earns 3
  assert.equal(sim.game().result.totalPoints, 6);
  assert.equal(sim.game().playerScores.p2, 3);
  assert.equal(sim.game().winnerKey, 't0');
  assert.equal(sim.game().winnerUid, 'p2');
  ok(sim.act('p1', 'nextTurn'));
  assert.equal(sim.game().state, 'finished');
  assert.deepEqual(seen, ['p0', 'p1']);
  ok(sim.act('p0', 'playAgain'));
});

test('shared mode: forged individual scores are rejected and rotation cannot repeat the Psychic', () => {
  const sim = new Sim().lobbyCoop(3, { targetScore: 50 });
  sim.act('p0', 'startGame');
  sim.act('p0', 'writeTarget');
  sim.act('p0', 'clueGiven');
  const t = targetOf(sim);
  const g = sim.game();
  sim.act('p1', 'lockGuess', { guess: near(t, 40) });
  sim.act('p2', 'lockGuess', { guess: near(t, 40) });
  const forged = (o) => ({ ...g, state: 'reveal', scores: { ...g.scores, t0: 5 }, result: { guess: t, target: t, diff: 0, points: 5, ...o } });
  denied(sim.raw('p1', { 'wavelengthRooms/{code}/game': forged({}) })); // not the Psychic
  denied(sim.raw('p0', { 'wavelengthRooms/{code}/game': forged({ target: t + 1 }) }));
  denied(sim.raw('p0', { 'wavelengthRooms/{code}/game': { ...forged({}), scores: { ...g.scores, t0: 9 } } }));
  const forgedPlayerScores = {
    ...g, state: 'reveal',
    result: { guess: t, target: t, diff: 0, points: 0, totalPoints: 6, psychicPenalty: 0 },
    playerResults: { p1: { guess: t, diff: 0, points: 3 }, p2: { guess: t, diff: 0, points: 3 } },
    playerScores: { ...g.playerScores, p1: 3, p2: 3 },
  };
  denied(sim.raw('p0', { 'wavelengthRooms/{code}/game': forgedPlayerScores }));
  ok(sim.act('p0', 'reveal'));
  const next = { ...sim.game(), state: 'clue', turn: 2, teamTurns: { ...sim.game().teamTurns, t0: 2 }, psychicUid: 'p0', prompt: g.prompt };
  delete next.result;
  denied(sim.raw('p0', { 'wavelengthRooms/{code}/game': next }));
});

test('co-op: needs at least two players', () => {
  const sim = new Sim().lobbyCoop(1);
  gameErr(() => sim.act('p0', 'startGame'), 'lobby-not-ready');
});
