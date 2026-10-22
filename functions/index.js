/*
 * Trusted backend for the Wavelength game. All state changes go through the `roomAction` callable,
 * which applies a pure reducer from shared/game-logic.js inside a Realtime Database transaction.
 * Clients can never write scores, roles, targets or game state directly (see database.rules.json).
 */
const crypto = require('crypto');
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const admin = require('firebase-admin');

const S = require('./shared/game-logic.js');
const { LIMITS } = require('./shared/constants.js');

admin.initializeApp({ databaseURL: process.env.DATABASE_URL || 'https://sprint-planner-5e1b0-default-rtdb.firebaseio.com' });
const db = admin.database();

const rng = () => crypto.randomInt(0, 2 ** 32) / 2 ** 32;

const CODE_TO_HTTPS = {
  'invalid-state': 'failed-precondition',
  'lobby-not-ready': 'failed-precondition',
  'game-in-progress': 'failed-precondition',
  'room-full': 'resource-exhausted',
  'team-full': 'resource-exhausted',
  'permission-denied': 'permission-denied',
  'invalid-argument': 'invalid-argument',
};

function toHttpsError(e) {
  if (e instanceof HttpsError) return e;
  if (e instanceof S.GameError) return new HttpsError(CODE_TO_HTTPS[e.code] || 'failed-precondition', e.message, { reason: e.code });
  console.error(e);
  return new HttpsError('internal', 'Something went wrong. Please try again.');
}

/** Restore arrays that RTDB collapsed and make sure container nodes exist. */
function normalize(room) {
  const r = JSON.parse(JSON.stringify(room));
  const s = r.meta.settings;
  s.teamNames = S.arr(s.teamNames);
  s.customPrompts = S.arr(s.customPrompts);
  s.customPromptsText = s.customPromptsText || '';
  r.game.scores = S.arr(r.game.scores);
  r.game.teamTurns = S.arr(r.game.teamTurns);
  r.players = r.players || {};
  r.secret = r.secret || {};
  r.server = r.server || {};
  r.server.deck = S.arr(r.server.deck);
  return r;
}

const roomRef = (code) => db.ref(`rooms/${code}`);

async function removeAux(code) {
  await Promise.all([db.ref(`presence/${code}`).remove(), db.ref(`live/${code}`).remove()]);
}

async function createRoom(uid, data) {
  const now = Date.now();
  const env = { now, rng };
  const room = S.createRoom(uid, data.name, data.settings, env);
  for (let attempt = 0; attempt < 8; attempt++) {
    const code = S.generateRoomCode(rng);
    const res = await roomRef(code).transaction((cur) => (cur === null ? room : undefined));
    if (res.committed) {
      await db.ref(`live/${code}`).set({ pos: 50 });
      return { code };
    }
  }
  throw new HttpsError('unavailable', 'Could not allocate a room code, please try again.');
}

async function applyAction(uid, code, action, payload) {
  if (!S.isValidRoomCode(code)) throw new HttpsError('invalid-argument', 'That room code looks invalid.');
  const reducer = S.reducers[action];
  if (!reducer) throw new HttpsError('invalid-argument', 'Unknown action.');
  const ref = roomRef(code);

  const env = { now: Date.now(), rng, hostOnline: true };
  if (action === 'claimHost') {
    const snap = await ref.child('meta/hostUid').get();
    if (!snap.exists()) throw new HttpsError('not-found', 'This room no longer exists.');
    env.hostOnline = (await db.ref(`presence/${code}/${snap.val()}`).get()).val() === true;
  }

  let gameError = null;
  let existed = true;
  let deleted = false;
  const result = await ref.transaction((cur) => {
    gameError = null; existed = true; deleted = false;
    if (cur === null) { existed = false; return cur; }
    try {
      const out = reducer(normalize(cur), uid, payload, env);
      if (out === null) { deleted = true; return null; }
      return out;
    } catch (e) {
      gameError = e;
      return undefined; // abort
    }
  });
  if (gameError) throw gameError;
  if (!existed) throw new HttpsError('not-found', 'This room no longer exists.');
  if (!result.committed) throw new HttpsError('aborted', 'The room changed at the same moment. Please try again.');

  if (deleted) await removeAux(code);
  else {
    const g = result.snapshot.child('game').val() || {};
    if (['startGame', 'nextTurn', 'updateSettings', 'playAgain'].includes(action) || g.state === 'lobby') {
      await db.ref(`live/${code}`).set({ pos: 50 });
    }
    if (action === 'removePlayer') await db.ref(`presence/${code}/${payload.targetUid || uid}`).remove();
  }
  return { ok: true };
}

exports.roomAction = onCall({ cors: true, maxInstances: 20 }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Please sign in first.');
  const uid = request.auth.uid;
  const data = request.data || {};
  try {
    if (data.action === 'createRoom') return await createRoom(uid, data);
    const code = S.normalizeRoomCode(data.code);
    const { action, code: _c, ...payload } = data;
    return await applyAction(uid, code, action, payload);
  } catch (e) {
    throw toHttpsError(e);
  }
});

/** Abandoned-room cleanup: removes rooms that have had no activity for ROOM_TTL_MS. */
exports.cleanupRooms = onSchedule('every 6 hours', async () => {
  const cutoff = Date.now() - LIMITS.ROOM_TTL_MS;
  const snap = await db.ref('rooms').orderByChild('meta/updatedAt').endAt(cutoff).limitToFirst(500).get();
  const codes = [];
  snap.forEach((child) => { codes.push(child.key); });
  await Promise.all(codes.map(async (code) => { await roomRef(code).remove(); await removeAux(code); }));
  console.log(`Removed ${codes.length} abandoned rooms`);
});
