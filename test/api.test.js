const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../shared/game-logic.js');

let fixtureId = 0;

async function setup(t, { user = null, writeError = null } = {}) {
  const previousFirebase = globalThis.firebase;
  const previousWindow = globalThis.window;
  const previousConsoleError = console.error;
  const state = { writes: [], reads: [], updates: [], updatePaths: [], logs: [], authReady: false, signIns: 0, writeError, config: null };
  let currentUser = user;
  let authListener;

  const auth = {
    onAuthStateChanged(callback) {
      authListener = (u) => {
        if (u) state.authReady = true;
        callback(u);
      };
      queueMicrotask(() => authListener(currentUser));
      return () => {};
    },
    signInAnonymously() {
      state.signIns++;
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
          assert.equal(state.authReady, true);
          state.writes.push({ path, value });
          if (state.writeError) throw state.writeError;
        },
        async once() {
          state.reads.push(path);
          return { val: () => null };
        },
        async update(value) {
          state.updatePaths.push(path);
          state.updates.push(value);
        },
      };
    },
  });
  database.ServerValue = { TIMESTAMP: 123 };

  globalThis.window = { WavelengthShared: S };
  globalThis.firebase = {
    apps: [],
    initializeApp(value) { state.config = value; this.apps.push({}); },
    auth: () => auth,
    database,
  };
  console.error = (...args) => state.logs.push(args);
  t.after(() => {
    globalThis.firebase = previousFirebase;
    globalThis.window = previousWindow;
    console.error = previousConsoleError;
  });

  const api = await import(`../wavelength/js/api.js?test=${++fixtureId}`);
  return { api, state };
}

test('room creation waits for anonymous auth and writes to its individual code path', async (t) => {
  const { api, state } = await setup(t);
  const code = await api.createRoom('host', 'Host', {});

  assert.equal(state.signIns, 1);
  assert.equal(state.authReady, true);
  assert.match(code, /^[A-HJKMNP-Z2-9]{5}$/);
  assert.equal(state.writes.length, 1);
  assert.equal(state.writes[0].path, `wavelengthRooms/${code}`);
  assert.equal(state.writes[0].value.meta.hostUid, 'host');
  assert.equal(state.config.databaseURL, 'https://sprint-planner-5e1b0-default-rtdb.firebaseio.com');
});

test('room creation reuses an existing authenticated identity', async (t) => {
  const { api, state } = await setup(t, { user: { uid: 'host' } });
  await api.createRoom('host', 'Host', {});

  assert.equal(state.signIns, 0);
  assert.equal(state.writes.length, 1);
  assert.match(state.writes[0].path, /^wavelengthRooms\/[A-HJKMNP-Z2-9]{5}$/);
});

test('permission denials are logged and report setup/retry guidance', async (t) => {
  const error = { code: 'PERMISSION_DENIED', message: 'write rejected by rules' };
  const { api, state } = await setup(t, { user: { uid: 'host' }, writeError: error });

  await assert.rejects(api.createRoom('host', 'Host', {}), (e) =>
    e.code === 'room/creation-denied' && e.cause === error && /try again/.test(e.message));

  assert.equal(state.writes.length, 1);
  assert.equal(state.logs[0][1].path, state.writes[0].path);
  assert.equal(state.logs[0][1].code, error.code);
  assert.equal(state.logs[0][1].message, error.message);
});

test('non-permission Firebase errors are logged and rethrown unchanged', async (t) => {
  const error = { code: 'NETWORK_ERROR', message: 'connection failed' };
  const { api, state } = await setup(t, { user: { uid: 'host' }, writeError: error });

  await assert.rejects(api.createRoom('host', 'Host', {}), (e) => e === error);
  assert.equal(state.logs[0][1].path, state.writes[0].path);
  assert.equal(state.logs[0][1].code, error.code);
  assert.equal(state.logs[0][1].message, error.message);
});

test('join and room listeners use individual wavelengthRooms paths', async (t) => {
  const { api, state } = await setup(t, { user: { uid: 'host' } });

  await api.joinRoom('host', 'ABCD2', 'Host');
  assert.deepEqual(state.reads, ['wavelengthRooms/ABCD2/players/host']);
  assert.deepEqual(Object.keys(state.updates[0]), ['players/host']);
  assert.equal(state.updatePaths[0], 'wavelengthRooms/ABCD2');
  assert.equal(api.roomRef('ABCD2', 'meta').path, 'wavelengthRooms/ABCD2/meta');
});

test('room creation rejects a mismatched auth identity before database access', async (t) => {
  const { api, state } = await setup(t, { user: { uid: 'host' } });

  await assert.rejects(api.createRoom('different-user', 'Host', {}), { code: 'auth/user-mismatch' });
  assert.equal(state.writes.length, 0);
});
