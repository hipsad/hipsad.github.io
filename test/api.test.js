const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../shared/game-logic.js');

test('room creation waits for auth, writes one room path, and logs Firebase failures', async (t) => {
  const previousFirebase = globalThis.firebase;
  const previousWindow = globalThis.window;
  const previousConsoleError = console.error;
  const writes = [];
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
        async set(value) {
          assert.equal(authReady, true);
          writes.push({ path, value });
          if (writeError) throw writeError;
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

  const writesBeforeMismatch = writes.length;
  await assert.rejects(api.createRoom('different-user', 'Host', {}), { code: 'auth/user-mismatch' });
  assert.equal(writes.length, writesBeforeMismatch);
});
