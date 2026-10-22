import { normalizeRoomCode } from './shared.js';

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
const callable = firebase.functions().httpsCallable('roomAction');

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
  if (code === 'functions/unavailable' || code === 'functions/deadline-exceeded' || (e && /network/i.test(e.message || '')))
    return 'Network problem – check your connection and try again.';
  if (code === 'functions/not-found' && /not found|NOT_FOUND/i.test(e.message || '') && !/room/i.test(e.message)) return 'The game server is not deployed yet (see README: deploy Cloud Functions).';
  if (code === 'auth/operation-not-allowed' || code === 'auth/admin-restricted-operation') return 'Anonymous sign-in is disabled in Firebase Authentication.';
  if (code === 'functions/internal') return 'Server error. Please try again in a moment.';
  return (e && e.message) || 'Something went wrong.';
}

export async function action(name, payload = {}) {
  const res = await callable({ action: name, ...payload });
  return res.data;
}
export const createRoom = (name, settings) => action('createRoom', { name, settings });

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
export const liveRef = (code) => db.ref(`live/${code}/pos`);
export const secretRef = (code, uid) => db.ref(`rooms/${code}/secret/${uid}`);
export const connectionRef = () => db.ref('.info/connected');
