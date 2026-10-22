import { normalizeRoomCode, planners, generateRoomCode, createRoomData } from './shared.js';

const firebaseConfig = {
  apiKey: 'AIzaSyDpMvjjDseguE4yK7E3IBdj14PYEXhdEc4', // public web config (not a secret); access is enforced by rules
  authDomain: 'sprint-planner-5e1b0.firebaseapp.com',
  databaseURL: 'https://sprint-planner-5e1b0-default-rtdb.firebaseio.com',
  projectId: 'sprint-planner-5e1b0',
  storageBucket: 'sprint-planner-5e1b0.firebasestorage.app',
  messagingSenderId: '116012473986',
  appId: '1:116012473986:web:8078da761a673e75d49e9b',
};

if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.database();

/** Persistent anonymous identity (survives refreshes). */
export function ensureUser() {
  return new Promise((resolve, reject) => {
    let signingIn = false;
    const off = auth.onAuthStateChanged((u) => {
      if (u) { off(); resolve(u); }
      else if (!signingIn) { signingIn = true; auth.signInAnonymously().catch((e) => { off(); reject(e); }); }
    }, reject);
  });
}

export function friendlyError(e) {
  const code = (e && e.code) || '';
  const msg = (e && e.message) || '';
  if (/permission[_-]denied/i.test(code + msg))
    return 'That is not allowed right now – the game may have moved on, or the room is full, started or closed.';
  if (/network|unavailable|disconnected/i.test(code + msg)) return 'Network problem – check your connection and try again.';
  if (code === 'auth/operation-not-allowed' || code === 'auth/admin-restricted-operation') return 'Anonymous sign-in is disabled in Firebase Authentication.';
  return msg || 'Something went wrong.';
}
export const isDenied = (e) => /permission[_-]denied/i.test(((e && e.code) || '') + ((e && e.message) || ''));

const planEnv = (extra) => ({ now: firebase.database.ServerValue.TIMESTAMP, rng: Math.random, ...extra });

/** Creates a room under a fresh random code. The rules only allow creating a room that does not exist, so a collision is retried. */
export async function createRoom(uid, name, settings) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const code = generateRoomCode(Math.random);
    const room = createRoomData(uid, name, settings, planEnv());
    try {
      await db.ref(`rooms/${code}`).set(room);
      return code;
    } catch (e) {
      if (!isDenied(e)) throw e;
    }
  }
  throw new Error('Could not find a free room code – please try again.');
}

/** Joins (or re-joins) a room. Rules refuse unknown rooms and rooms that already started. */
export async function joinRoom(uid, code, name) {
  let exists = false;
  try { exists = !!(await db.ref(`rooms/${code}/players/${uid}`).once('value')).val(); } catch (_) { /* not a member yet */ }
  const { updates } = planners.joinRoom(null, uid, { name, exists }, planEnv());
  try { await db.ref().update(subst(code, updates)); }
  catch (e) { if (isDenied(e)) throw new Error('Room not found, or the game has already started.'); throw e; }
}

const subst = (code, updates) => Object.fromEntries(Object.entries(updates).map(([k, v]) => [k.replace('{code}', code), v]));

/** Plans an action from the current room view, then submits it as one atomic multi-path update (the rules re-validate it). */
export async function action(name, room, uid, code, payload = {}, extraEnv) {
  const { updates } = planners[name](room, uid, payload, planEnv(extraEnv));
  if (!Object.keys(updates).length) return;
  await db.ref().update(subst(code, updates));
}

export const roomRef = (code, path = '') => db.ref(`rooms/${normalizeRoomCode(code)}${path ? '/' + path : ''}`);

/** Subscribes to a path; returns an unsubscribe function. */
export function listen(ref, onValue, onError) {
  const cb = ref.on('value', (s) => onValue(s.val()), onError);
  return () => ref.off('value', cb);
}

/** Marks this user online in the room; automatically offline on disconnect. Returns a cleanup function. */
export function trackPresence(code, uid) {
  const me = db.ref(`presence/${code}/${uid}`);
  const connected = db.ref('.info/connected');
  const cb = connected.on('value', (s) => {
    if (s.val() === true) me.onDisconnect().set(false).then(() => me.set(true)).catch(() => {});
  });
  return () => { connected.off('value', cb); me.set(false).catch(() => {}); };
}
export const presenceRef = (code) => db.ref(`presence/${code}`);
export const liveRef = (code) => db.ref(`live/${code}`);
export const connectionRef = () => db.ref('.info/connected');
