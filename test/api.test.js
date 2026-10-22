const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../shared/game-logic.js');

test('room creation waits for auth, uses individual room paths, and logs Firebase failures', async (t) => {
  const previousFirebase = globalThis.firebase;
  const previousWindow = globalThis.window;
  const previousConsoleError = console.error;
  const writes = [];
  const reads = [];
  const updates = [];
  const logs = [];
  let authReady = false;
  let currentUser = null;
  let authListener;
  let writeError = null;
  let config;

  const auth = {
    onAuthStateChanged(callback) {
      authListener = (user) => {
        if (user) authReady = true;
        callback(user);
      };
      queueMicrotask(() => authListener(currentUser));
      return () => {};
    },
    signInAnonymously() {
      return new Promise((resolve) => queueMicrotask(() => {
        currentUser = { uid: 'host' };
        resolve(currentUser);
        authListener(currentUser);
      }));
    },
  };
  const database = () => ({
    ref(path) {
      return {
        path,
        async set(value) {
          assert.equal(authReady, true);
          writes.push({ path, value });
          if (writeError) throw writeError;
        },
        async once() {
          reads.push(path);
          return { val: () => null };
        },
        async update(value) {
          updates.push(value);
        },
      };
    },
  });
  database.ServerValue = { TIMESTAMP: 123 };

  globalThis.window = { WavelengthShared: S };
  globalThis.firebase = {
    apps: [],
    initializeApp(value) { config = value; this.apps.push({}); },
    auth: () => auth,
    database,
  };
  console.error = (...args) => logs.push(args);
  t.after(() => {
    globalThis.firebase = previousFirebase;
    globalThis.window = previousWindow;
    console.error = previousConsoleError;
  });

  const api = await import('../wavelength/js/api.js');
  const code = await api.createRoom('host', 'Host', {});

  assert.match(code, /^[A-HJKMNP-Z2-9]{5}$/);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].path, `wavelengthRooms/${code}`);
  assert.equal(writes[0].value.meta.hostUid, 'host');
  assert.equal(config.databaseURL, 'https://sprint-planner-5e1b0-default-rtdb.firebaseio.com');

  writeError = { code: 'PERMISSION_DENIED', message: 'write rejected by rules' };
  await assert.rejects(api.createRoom('host', 'Host', {}), (e) =>
    e.code === 'room/creation-denied' && e.cause === writeError && /try again/.test(e.message));
  assert.equal(writes.length, 2);
  assert.match(writes[1].path, /^wavelengthRooms\/[A-HJKMNP-Z2-9]{5}$/);
  assert.equal(logs[0][1].path, writes[1].path);
  assert.equal(logs[0][1].code, writeError.code);
  assert.equal(logs[0][1].message, writeError.message);

  writeError = { code: 'NETWORK_ERROR', message: 'connection failed' };
  await assert.rejects(api.createRoom('host', 'Host', {}), (e) => e === writeError);
  assert.equal(logs[1][1].code, writeError.code);
  assert.equal(logs[1][1].message, writeError.message);

  writeError = null;
  await api.joinRoom('host', 'ABCD2', 'Host');
  assert.deepEqual(reads, ['wavelengthRooms/ABCD2/players/host']);
  assert.deepEqual(Object.keys(updates[0]), ['wavelengthRooms/ABCD2/players/host']);
  assert.equal(api.roomRef('ABCD2', 'meta').path, 'wavelengthRooms/ABCD2/meta');

  const writesBeforeMismatch = writes.length;
  await assert.rejects(api.createRoom('different-user', 'Host', {}), { code: 'auth/user-mismatch' });
  assert.equal(writes.length, writesBeforeMismatch);
});
