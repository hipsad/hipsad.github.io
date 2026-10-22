// Structural checks of the permission boundaries in database.rules.json.
// (Full behavioural tests need the Firebase emulator; see README "Testing".)
const test = require('node:test');
const assert = require('node:assert/strict');
const rules = require('../database.rules.json').rules;
const room = rules.rooms.$code;
const member = "root.child('rooms/' + $code + '/players/' + auth.uid).exists()";

test('clients can never write rooms (all mutations go through Cloud Functions)', () => {
  const hasWrite = (n) => n && typeof n === 'object' && Object.entries(n).some(([k, v]) => k === '.write' || hasWrite(v));
  assert.equal(hasWrite(rules.rooms), false);
  assert.equal(rules.rooms['.read'], undefined);
  assert.equal(room['.read'], undefined);
  assert.equal(room['.write'], undefined);
});

test('server-only node is not readable or writable by clients', () => {
  assert.equal(room.server, undefined); // holds the true target and prompt deck
});

test('public room data is readable by members only', () => {
  for (const k of ['meta', 'players', 'game']) {
    assert.match(room[k]['.read'], /auth != null/);
    assert.ok(room[k]['.read'].includes(member));
  }
});

test('secret target is readable only by its owner and never by the active guesser', () => {
  const r = room.secret.$uid['.read'];
  assert.ok(r.includes('auth.uid === $uid'));
  assert.equal(room.secret['.read'], undefined); // cannot list other players' secrets
  assert.equal(room.game.target, undefined);
  assert.equal(room.meta.target, undefined);
});

test('presence: members read; each user writes only their own boolean', () => {
  const p = rules.presence.$code;
  assert.ok(p['.read'].includes(member));
  assert.ok(p.$uid['.write'].includes('auth.uid === $uid'));
  assert.equal(p.$uid['.validate'], 'newData.isBoolean()');
});

test('live slider: only the guesser during the guessing state, numeric 0..100', () => {
  const pos = rules.live.$code.pos;
  assert.ok(pos['.write'].includes('game/guesserUid'));
  assert.ok(pos['.write'].includes("=== 'guessing'"));
  assert.ok(pos['.validate'].includes('>= 0') && pos['.validate'].includes('<= 100'));
  assert.equal(rules.live.$code.$other['.validate'], false);
  assert.equal(rules.live.$code['.write'], undefined);
});

test('existing sprint planner rules are preserved', () => {
  assert.equal(rules.sessions.$sessionId['.read'], true);
  assert.equal(rules.sessions.$sessionId['.write'], true);
});
