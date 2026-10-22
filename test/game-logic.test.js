const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../shared/game-logic.js');
const { BUILTIN_PROMPTS } = require('../shared/prompts.js');
const { STATES } = require('../shared/constants.js');
const R = S.reducers;

let t = 1000;
const mkRng = (seed = 1) => () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
const env = (extra) => ({ now: ++t, rng: mkRng(7), ...extra });

function lobby(teamCount = 2, settings = {}) {
  let room = S.createRoom('p0', 'Host', { teamCount, ...settings }, env());
  for (let i = 1; i < teamCount * 2; i++) room = R.joinRoom(room, 'p' + i, { name: 'P' + i }, env());
  for (let i = 0; i < teamCount * 2; i++) room = R.setTeam(room, 'p' + i, { team: Math.floor(i / 2) }, env());
  return room;
}
const started = (n = 2, s) => R.startGame(lobby(n, s), 'p0', {}, env());
const throwsCode = (fn, code) => assert.throws(fn, (e) => e instanceof S.GameError && e.code === code);

test('scoring boundaries', () => {
  assert.equal(S.scoreGuess(50, 50), 2);
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
    { from: 35, to: 45, points: 1 }, { from: 45, to: 55, points: 2 }, { from: 55, to: 65, points: 1 }]);
  assert.deepEqual(S.scoringBands(2), [{ from: 0, to: 7, points: 2 }, { from: 7, to: 17, points: 1 }]);
  assert.deepEqual(S.scoringBands(100), [{ from: 85, to: 95, points: 1 }, { from: 95, to: 100, points: 2 }]);
});

test('prompt parsing', () => {
  const ok = S.parsePrompts('  (Expensive ,  Cheap)\n\n(Hot, Cold)  \r\n(Great   Movie, Terrible Movie)');
  assert.deepEqual(ok.errors, []);
  assert.deepEqual(ok.prompts[0], { high: 'Expensive', low: 'Cheap' });
  assert.equal(ok.prompts[2].high, 'Great Movie');
  const bad = S.parsePrompts('Hot, Cold\n(Hot Cold)\n(Hot, )\n(, Cold)\n(a, b, c)\n((a), b)\n(<b>x</b>, y)\n()');
  assert.equal(bad.prompts.length, 0);
  assert.equal(bad.errors.length, 8);
  assert.deepEqual(bad.errors.map((e) => e.line), [1, 2, 3, 4, 5, 6, 7, 8]);
});

test('built-in library is large and unique', () => {
  assert.ok(BUILTIN_PROMPTS.length >= 100);
  assert.equal(new Set(BUILTIN_PROMPTS.map((p) => p.high + '|' + p.low)).size, BUILTIN_PROMPTS.length);
});

test('prompts do not repeat until exhausted, then reshuffle', () => {
  const pool = [{ high: 'a', low: 'b' }, { high: 'c', low: 'd' }, { high: 'e', low: 'f' }];
  const rng = mkRng(3);
  let deck = [];
  const seen = [];
  for (let i = 0; i < 3; i++) { const r = S.drawPrompt(pool, deck, rng); seen.push(r.prompt.high); deck = r.deck; }
  assert.equal(new Set(seen).size, 3);
  assert.equal(S.drawPrompt(pool, deck, rng).deck.length, 2);
});

test('settings validation and prompt modes', () => {
  throwsCode(() => S.sanitizeSettings({ teamCount: 1 }), 'invalid-argument');
  throwsCode(() => S.sanitizeSettings({ targetScore: 0 }), 'invalid-argument');
  throwsCode(() => S.sanitizeSettings({ promptMode: 'custom' }), 'invalid-argument');
  throwsCode(() => S.sanitizeSettings({ customPromptsText: 'oops' }), 'invalid-argument');
  const s = S.sanitizeSettings({});
  assert.equal(s.teamCount, 2); assert.equal(s.targetScore, 10); assert.deepEqual(s.teamNames, ['Team 1', 'Team 2']);
  const m = S.sanitizeSettings({ promptMode: 'mixed', customPromptsText: '(a, b)' });
  assert.equal(S.promptPool(m).length, BUILTIN_PROMPTS.length + 1);
  assert.equal(S.promptPool({ ...m, promptMode: 'custom' }).length, 1);
});

test('lobby: join is idempotent, teams limited to 2, start validation', () => {
  let room = S.createRoom('p0', 'Host', {}, env());
  room = R.joinRoom(room, 'p0', { name: 'Host' }, env());
  assert.equal(Object.keys(room.players).length, 1);
  for (let i = 1; i < 4; i++) room = R.joinRoom(room, 'p' + i, { name: 'P' + i }, env());
  room = R.setTeam(room, 'p0', { team: 0 }, env());
  room = R.setTeam(room, 'p1', { team: 0 }, env());
  throwsCode(() => R.setTeam(room, 'p2', { team: 0 }, env()), 'team-full');
  throwsCode(() => R.startGame(room, 'p0', {}, env()), 'lobby-not-ready');
  room = R.setTeam(room, 'p2', { team: 1 }, env());
  room = R.setTeam(room, 'p3', { team: 1 }, env());
  throwsCode(() => R.startGame(room, 'p1', {}, env()), 'permission-denied');
  throwsCode(() => R.setTeam(room, 'p1', { team: 1, targetUid: 'p2' }, env()), 'permission-denied');
  throwsCode(() => R.setTeam(room, 'stranger', { team: 1 }, env()), 'permission-denied');
  const g = R.startGame(room, 'p0', {}, env());
  assert.equal(g.game.state, STATES.CLUE);
  throwsCode(() => R.joinRoom(g, 'late', { name: 'x' }, env()), 'game-in-progress');
  assert.doesNotThrow(() => R.joinRoom(g, 'p3', { name: 'P3' }, env())); // reconnect allowed
});

test('target is only given to non-guessers and never to the guesser', () => {
  const room = started(3);
  const g = room.game;
  assert.ok(room.secret[g.psychicUid]);
  assert.equal(room.secret[g.guesserUid], undefined);
  assert.equal(Object.keys(room.secret).length, 5);
  assert.equal(room.secret[g.psychicUid].target, room.server.target);
  assert.equal(room.game.result, null);
});

test('role alternation within a team and team rotation', () => {
  let room = started(3);
  const history = [];
  for (let i = 0; i < 6; i++) {
    const g = room.game;
    history.push(g.activeTeam);
    room = R.clueGiven(room, g.psychicUid, {}, env());
    room = R.submitGuess(room, g.guesserUid, { guess: room.server.target > 50 ? 0 : 100 }, env());
    room = R.nextTurn(room, 'p0', {}, env());
  }
  assert.deepEqual(history, [0, 1, 2, 0, 1, 2]);
  // explicit alternation check
  let r2 = started(2);
  const seq = [];
  for (let i = 0; i < 4; i++) {
    seq.push([r2.game.activeTeam, r2.game.psychicUid, r2.game.guesserUid]);
    r2 = R.clueGiven(r2, r2.game.psychicUid, {}, env());
    r2 = R.submitGuess(r2, r2.game.guesserUid, { guess: 0 }, env());
    r2 = R.nextTurn(r2, 'p0', {}, env());
  }
  assert.deepEqual(seq, [[0, 'p0', 'p1'], [1, 'p2', 'p3'], [0, 'p1', 'p0'], [1, 'p3', 'p2']]);
});

test('turn flow: roles, duplicate submissions, invalid transitions', () => {
  let room = started(2);
  const { psychicUid: ps, guesserUid: gu } = room.game;
  throwsCode(() => R.submitGuess(room, gu, { guess: 10 }, env()), 'invalid-state'); // still in clue
  throwsCode(() => R.clueGiven(room, gu, {}, env()), 'permission-denied');
  throwsCode(() => R.nextTurn(room, 'p0', {}, env()), 'invalid-state');
  throwsCode(() => R.startGame(room, 'p0', {}, env()), 'invalid-state');
  room = R.clueGiven(room, ps, {}, env());
  throwsCode(() => R.clueGiven(room, ps, {}, env()), 'invalid-state');
  throwsCode(() => R.submitGuess(room, ps, { guess: 10 }, env()), 'permission-denied');
  throwsCode(() => R.submitGuess(room, 'p2', { guess: 10 }, env()), 'permission-denied');
  for (const bad of [-1, 101, NaN, 'x', null, undefined, true]) throwsCode(() => R.submitGuess(room, gu, { guess: bad }, env()), 'invalid-argument');
  const target = room.server.target;
  const done = R.submitGuess(room, gu, { guess: target }, env());
  assert.equal(done.game.state, STATES.REVEAL);
  assert.equal(done.game.result.points, 2);
  assert.equal(done.game.scores[0], 2);
  assert.deepEqual(done.secret, {});
  throwsCode(() => R.submitGuess(done, gu, { guess: target }, env()), 'invalid-state'); // duplicate
  assert.equal(done.game.scores[0], 2);
  throwsCode(() => R.nextTurn(done, 'p2', {}, env()), 'permission-denied'); // other team
  const next = R.nextTurn(done, 'p0', {}, env());
  assert.equal(next.game.activeTeam, 1);
  assert.equal(next.game.state, STATES.CLUE);
  assert.deepEqual(next.game.scores, [2, 0]); // scores preserved
  assert.equal(next.game.result, null);
});

test('guess is rounded; points are computed server-side only', () => {
  let room = started(2);
  room = R.clueGiven(room, room.game.psychicUid, {}, env());
  const far = room.server.target > 50 ? 0 : 100;
  const out = R.submitGuess(room, room.game.guesserUid, { guess: far, points: 99 }, env());
  assert.equal(out.game.result.points, 0);
});

test('win condition and finishing', () => {
  let room = started(2, { targetScore: 2 });
  room = R.clueGiven(room, room.game.psychicUid, {}, env());
  room = R.submitGuess(room, room.game.guesserUid, { guess: room.server.target }, env());
  assert.equal(room.game.winnerTeam, 0);
  room = R.nextTurn(room, 'p1', {}, env());
  assert.equal(room.game.state, STATES.FINISHED);
  throwsCode(() => R.nextTurn(room, 'p0', {}, env()), 'invalid-state');
  throwsCode(() => R.playAgain(room, 'p1', {}, env()), 'permission-denied');
  const again = R.playAgain(room, 'p0', {}, env());
  assert.equal(again.game.state, STATES.LOBBY);
  assert.deepEqual(again.game.scores, [0, 0]);
  assert.equal(Object.keys(again.players).length, 4);
});

test('winner tie-break', () => {
  assert.equal(S.determineWinner([5, 3], 10, 0), null);
  assert.equal(S.determineWinner([10, 3], 10, 1), 0);
  assert.equal(S.determineWinner([11, 12], 10, 0), 1);
  assert.equal(S.determineWinner([12, 12], 10, 1), 1);
  assert.equal(S.determineWinner([12, 12, 3], 10, 2), 0);
});

test('state machine transitions', () => {
  assert.ok(S.canTransition('lobby', 'clue'));
  assert.ok(!S.canTransition('lobby', 'reveal'));
  assert.ok(!S.canTransition('clue', 'reveal'));
  assert.ok(!S.canTransition('guessing', 'clue'));
  assert.ok(!S.canTransition('finished', 'clue'));
  assert.throws(() => S.transition({ state: 'finished' }, 'guessing'), S.GameError);
});

test('leaving mid-game returns to lobby; host transfer; empty room deleted', () => {
  let room = started(2);
  const left = R.removePlayer(room, 'p3', {}, env());
  assert.equal(left.game.state, STATES.LOBBY);
  assert.ok(left.meta.notice);
  assert.deepEqual(left.secret, {});
  throwsCode(() => R.removePlayer(room, 'p1', { targetUid: 'p2' }, env()), 'permission-denied');
  throwsCode(() => R.removePlayer(room, 'p0', { targetUid: 'nobody' }, env()), 'permission-denied');
  const hostLeft = R.removePlayer(lobby(2), 'p0', {}, env());
  assert.equal(hostLeft.meta.hostUid, 'p1');
  const kicked = R.removePlayer(lobby(2), 'p0', { targetUid: 'p3' }, env());
  assert.equal(kicked.players.p3, undefined);
  throwsCode(() => R.removePlayer(lobby(2), 'p1', { targetUid: 'p0' }, env()), 'permission-denied');
  const solo = S.createRoom('p0', 'H', {}, env());
  assert.equal(R.removePlayer(solo, 'p0', {}, env()), null);
});

test('claimHost only when host offline', () => {
  const room = lobby(2);
  throwsCode(() => R.claimHost(room, 'p1', {}, env({ hostOnline: true })), 'invalid-state');
  assert.equal(R.claimHost(room, 'p1', {}, env({ hostOnline: false })).meta.hostUid, 'p1');
});

test('room codes', () => {
  const c = S.generateRoomCode(mkRng(5));
  assert.ok(S.isValidRoomCode(c));
  assert.ok(!S.isValidRoomCode('ABC'));
  assert.ok(!S.isValidRoomCode('ABCD0'));
  assert.equal(S.normalizeRoomCode(' ab-c12 '), 'ABC12');
});

test('settings update shrinks teams and resets players', () => {
  let room = lobby(3);
  room = R.updateSettings(room, 'p0', { teamCount: 2 }, env());
  assert.equal(room.players.p4.team, null);
  throwsCode(() => R.updateSettings(room, 'p1', { teamCount: 2 }, env()), 'permission-denied');
});
