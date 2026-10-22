import { h, replace, clear, append } from './dom.js';
import * as api from './api.js';
import { createDial } from './dial.js';
import { settingsForm } from './forms.js';
import { LIMITS, STATES, TEAM_COLORS, scoringBands, lobbyReadiness, normalizeRoomCode, isValidRoomCode, arr, decorateGame, teamMembers, teamOf } from './shared.js';

const root = document.getElementById('app');
const put = (...c) => append(root, c);
const toastEl = document.getElementById('toast');
const LS_NAME = 'wl.name', LS_ROOM = 'wl.room';

const S = {
  uid: null, code: null, meta: null, players: null, teams: null, rawGame: null, game: null, used: null, presence: {}, live: null, secret: null, lock: null,
  needsJoin: false, closed: null, offline: false, busy: false, hadMembership: false,
};
let unsubs = [];
let viewKey = null;
let view = null; // current view's update function
let rafPending = false;
let secretUnsub = null, secretSig = null;

/* ---------- helpers ---------- */
function toast(msg, kind = 'error') {
  toastEl.textContent = msg;
  toastEl.className = `toast show ${kind}`;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => { toastEl.className = 'toast'; }, 5000);
}
const teamColor = (t) => TEAM_COLORS[t % TEAM_COLORS.length];
const teamName = (t) => (S.meta && arr(S.meta.settings.teamNames)[t]) || `Team ${t + 1}`;
const savedName = () => localStorage.getItem(LS_NAME) || '';
const roster = (team) => teamMembers({ teams: S.teams }, team)
  .filter((uid) => S.players && S.players[uid]).map((uid) => ({ uid, ...S.players[uid] }));
const isHost = () => S.meta && S.meta.hostUid === S.uid;
const online = (uid) => S.presence && S.presence[uid] === true;
const myTeam = () => teamOf({ teams: S.teams }, S.uid);
const roomView = () => ({ meta: S.meta, players: S.players, teams: S.teams || {}, game: S.rawGame, used: arr(S.used), secret: S.secret, lock: S.lock });
const inviteLink = () => `${location.origin}${location.pathname}?room=${S.code}`;

/** Runs a server action once at a time (guards against double clicks). */
async function run(fn, { quiet } = {}) {
  if (S.busy) return;
  S.busy = true;
  root.classList.add('busy');
  try { return await fn(); }
  catch (e) { if (!quiet) toast(api.friendlyError(e)); }
  finally { S.busy = false; root.classList.remove('busy'); }
}
const act = (name, payload, extraEnv) => run(() => api.action(name, roomView(), S.uid, S.code, payload, extraEnv));
/** Fire-and-forget helper action; failures are expected when another client got there first. */
const quietAct = (name, payload) => api.action(name, roomView(), S.uid, S.code, payload).catch(() => {});

/* ---------- room lifecycle ---------- */
function stopListeners() { unsubs.forEach((u) => { try { u(); } catch (_) { /* ignore */ } }); unsubs = []; }

function startRoom(code) {
  stopListeners();
  Object.assign(S, { code, meta: null, players: null, teams: null, rawGame: null, game: null, used: null, presence: {}, live: null, secret: null, lock: null, needsJoin: false, closed: null, hadMembership: false });
  secretSig = null;
  viewKey = null;
  history.replaceState(null, '', `${location.pathname}?room=${code}`);
  localStorage.setItem(LS_ROOM, code);
  const fail = (e) => {
    const denied = e && /permission_denied/i.test(e.code || e.message || '');
    if (S.hadMembership) S.closed = 'You are no longer in this room (it may have been closed or you were removed).';
    else if (denied) S.needsJoin = true;
    else toast(api.friendlyError(e));
    stopListeners(); schedule();
  };
  const sub = (ref, key, extra) => unsubs.push(api.listen(ref, (v) => {
    S[key] = v;
    if (key === 'meta' && v) S.hadMembership = true;
    if (key === 'meta' && v === null && S.hadMembership) { S.closed = 'This room has been closed.'; stopListeners(); }
    if (S.rawGame && S.meta) S.game = decorateGame(S.rawGame, S.meta.settings.teamCount);
    else if (!S.rawGame) S.game = null;
    if (extra) extra(v);
    schedule();
  }, key === 'meta' ? fail : (e) => { if (!/permission_denied/i.test(e.code || '')) toast(api.friendlyError(e)); }));
  sub(api.roomRef(code, 'meta'), 'meta');
  sub(api.roomRef(code, 'players'), 'players');
  sub(api.roomRef(code, 'teams'), 'teams');
  sub(api.roomRef(code, 'used'), 'used');
  sub(api.roomRef(code, 'lock'), 'lock');
  sub(api.roomRef(code, 'game'), 'rawGame', (v) => watchSecret(v));
  sub(api.presenceRef(code), 'presence', (v) => { S.presence = v || {}; });
  sub(api.liveRef(code), 'live');
  unsubs.push(api.trackPresence(code, S.uid));
  unsubs.push(api.listen(api.connectionRef(), (c) => { S.offline = c === false; schedule(); }));
}

/**
 * The target is only readable for people allowed to see it. For the active Guesser the read is denied (and the listener is cancelled by
 * Firebase), so the listener is re-attached whenever the turn, phase or roles change.
 */
function watchSecret(g) {
  const sig = g ? `${g.turn}|${g.state}|${g.psychicUid}|${g.guesserUid}` : null;
  if (sig === secretSig) return;
  secretSig = sig;
  if (secretUnsub) { secretUnsub(); unsubs = unsubs.filter((u) => u !== secretUnsub); secretUnsub = null; }
  S.secret = null;
  if (!g || g.state === STATES.LOBBY) return;
  secretUnsub = api.listen(api.roomRef(S.code, 'secret'), (v) => { S.secret = v; schedule(); }, () => {});
  unsubs.push(secretUnsub);
}

function goHome() {
  stopListeners();
  Object.assign(S, { code: null, meta: null, players: null, teams: null, rawGame: null, game: null, needsJoin: false, closed: null, hadMembership: false });
  localStorage.removeItem(LS_ROOM);
  history.replaceState(null, '', location.pathname);
  viewKey = null;
  schedule();
}

async function leave() {
  if (!confirm('Leave this room?')) return;
  const ok = await run(async () => { await api.action('removePlayer', roomView(), S.uid, S.code); return true; });
  if (ok) goHome();
}

/* ---------- rendering ---------- */
function schedule() {
  if (rafPending) return;
  rafPending = true;
  requestAnimationFrame(() => { rafPending = false; render(); });
}

function mount(key, build) {
  if (viewKey !== key) { viewKey = key; clear(root); view = build(); }
  if (view) view();
}

function render() {
  document.body.classList.toggle('offline', S.offline);
  if (!S.code) return mount('landing', landingView);
  if (S.closed) return mount('closed', () => messageView('Room unavailable', S.closed));
  if (S.needsJoin) return mount('join:' + S.code, joinView);
  if (!S.meta || !S.players || !S.game) return mount('loading', () => messageView('Loading room…', null, true));
  if (!S.players[S.uid]) return mount('closed', () => messageView('Room unavailable', 'You are not in this room.'));
  const st = S.game.state;
  if (st === STATES.LOBBY) return mount('lobby:' + S.code, lobbyView);
  if (st === STATES.FINISHED) return mount('finished:' + S.code, finishedView);
  return mount(`game:${S.code}:${S.game.turn}`, gameView);
}

function messageView(title, text, loading) {
  const el = h('section', { class: 'card center' }, h('h2', {}, title), text && h('p', {}, text),
    loading ? h('div', { class: 'spinner', role: 'status', 'aria-label': 'Loading' }) : h('button', { class: 'btn primary', onclick: goHome }, 'Back to start'),
    loading && h('button', { class: 'btn ghost', onclick: goHome }, 'Cancel'));
  root.appendChild(el);
  return null;
}

/* ---------- landing / join ---------- */
function nameField() {
  return h('input', { id: 'name', type: 'text', maxlength: LIMITS.MAX_NAME_LENGTH, autocomplete: 'nickname', placeholder: 'Your display name', value: savedName() });
}
function readName(input) {
  const n = input.value.trim();
  if (!n) { toast('Please enter a display name first.'); input.focus(); return null; }
  localStorage.setItem(LS_NAME, n);
  return n;
}

function landingView() {
  const name = nameField();
  const codeIn = h('input', { id: 'code', type: 'text', maxlength: 8, autocapitalize: 'characters', autocomplete: 'off', placeholder: 'ABCDE', class: 'code-input' });
  const form = settingsForm({}, {
    submitLabel: 'Create room',
    onSubmit: async (settings) => {
      const n = readName(name); if (!n) return;
      const res = await run(() => api.createRoom(S.uid, n, settings));
      if (res) startRoom(res);
    },
  });
  const rejoin = localStorage.getItem(LS_ROOM);
  put(
    h('section', { class: 'hero' }, h('h1', {}, 'Wavelength'), h('p', {}, 'A real-time team guessing game. Read your partner\'s mind… on a dial.')),
    rejoin && h('div', { class: 'card rejoin' }, h('span', {}, `You were in room ${rejoin}.`), h('button', { class: 'btn primary', onclick: () => startRoom(rejoin) }, 'Rejoin')),
    h('section', { class: 'card' }, h('label', { class: 'field', for: 'name' }, 'Display name'), name),
    h('div', { class: 'grid2 cols' },
      h('section', { class: 'card' }, h('h2', {}, 'Create a room'), form.el),
      h('section', { class: 'card' }, h('h2', {}, 'Join a room'),
        h('form', {
          onsubmit: async (e) => {
            e.preventDefault();
            const code = normalizeRoomCode(codeIn.value);
            if (!isValidRoomCode(code)) return toast('Room codes are 5 characters, like K7QMD.');
            const n = readName(name); if (!n) return;
            const res = await run(async () => { await api.joinRoom(S.uid, code, n); return true; });
            if (res) startRoom(code);
          },
        }, h('label', { class: 'field' }, 'Room code', codeIn), h('button', { class: 'btn primary', type: 'submit' }, 'Join room')),
        h('p', { class: 'muted' }, 'Or open an invite link from your host.'))),
    howToPlay());
  return null;
}

function joinView() {
  const name = nameField();
  put(h('section', { class: 'card center' },
    h('h2', {}, `Join room ${S.code}`),
    h('label', { class: 'field', for: 'name' }, 'Display name'), name,
    h('form', {
      onsubmit: async (e) => {
        e.preventDefault();
        const n = readName(name); if (!n) return;
        const ok = await run(async () => { await api.joinRoom(S.uid, S.code, n); return true; });
        if (ok) startRoom(S.code);
      },
    }, h('button', { class: 'btn primary', type: 'submit' }, 'Join')),
    h('button', { class: 'btn ghost', onclick: goHome }, 'Back')));
  return null;
}

function howToPlay() {
  return h('section', { class: 'card how' }, h('h2', {}, 'How to play'),
    h('ol', {},
      h('li', {}, 'One or more teams of exactly two players take turns.'),
      h('li', {}, 'The Psychic sees a hidden target on the dial and says a clue (out loud) that fits the spectrum.'),
      h('li', {}, 'Their teammate, the Guesser, moves the needle to where they think the target is, then locks it in.'),
      h('li', {}, 'Bullseye = 2 points, next to it = 1 point. Roles swap each time a team plays.'),
      h('li', {}, 'First team to the target score wins. Other teams can see the target while they spectate.')));
}

/* ---------- shared pieces ---------- */
function topBar() {
  const copy = (text, label) => navigator.clipboard.writeText(text).then(() => toast(`${label} copied`, 'ok'), () => toast(text, 'ok'));
  return h('header', { class: 'topbar' },
    h('button', { class: 'chip', title: 'Copy room code', onclick: () => copy(S.code, 'Room code') }, 'Room ', h('strong', {}, S.code)),
    h('button', { class: 'btn small', onclick: () => copy(inviteLink(), 'Invite link') }, 'Copy invite link'),
    h('span', { class: 'spacer' }),
    h('button', { class: 'btn small ghost', onclick: leave }, 'Leave'));
}
function offlineBanner() { return h('div', { class: 'banner', role: 'status' }, 'Connection lost — reconnecting…'); }

function playerLine(p, extra) {
  return h('li', { class: 'player' },
    h('span', { class: `dot ${online(p.uid) ? 'on' : 'off'}`, title: online(p.uid) ? 'Connected' : 'Disconnected' }),
    h('span', { class: 'pname' }, p.name, p.uid === S.uid && h('em', {}, ' (you)'), S.meta.hostUid === p.uid && h('span', { class: 'tag' }, 'host')),
    extra);
}

function scoreboard() {
  const g = S.game, n = S.meta.settings.teamCount;
  return h('div', { class: 'scoreboard', role: 'list' }, Array.from({ length: n }, (_, t) => h('div', {
    class: `score ${g.activeTeam === t && g.state !== STATES.LOBBY ? 'active' : ''}`, role: 'listitem', style: { '--team': teamColor(t) },
  }, h('span', { class: 'sname' }, teamName(t)), h('span', { class: 'sval' }, arr(g.scores)[t] || 0),
  h('span', { class: 'smembers' }, roster(t).map((p) => (p.uid === g.psychicUid && g.activeTeam === t ? '🔮 ' : p.uid === g.guesserUid && g.activeTeam === t ? '🎯 ' : '') + p.name).join(' · ')))));
}

/* ---------- lobby ---------- */
function lobbyView() {
  const rosterEl = h('div', { class: 'teams' });
  const unassignedEl = h('div', { class: 'card' });
  const statusEl = h('div', { class: 'card' });
  const noticeEl = h('div');
  const summaryEl = h('div');
  const form = isHost() ? settingsForm(S.meta.settings, {
    submitLabel: 'Save settings',
    onSubmit: async (v) => { form.setBusy(true); await act('updateSettings', v); form.setBusy(false); },
  }) : null;
  let formSig = null;

  put(topBar(), h('div', { class: 'offline-slot' }), noticeEl,
    h('h1', { class: 'title' }, 'Lobby'),
    h('div', { class: 'lobby-grid' },
      h('div', {}, rosterEl, unassignedEl),
      h('div', {}, statusEl, h('section', { class: 'card' }, h('h2', {}, 'Settings'), form ? form.el : summaryEl))));

  return function update() {
    const m = S.meta, s = m.settings, host = isHost();
    replace(root.querySelector('.offline-slot'), S.offline && offlineBanner());
    replace(noticeEl, m.notice && h('div', { class: 'banner info', role: 'status' }, m.notice));
    replace(rosterEl, Array.from({ length: s.teamCount }, (_, t) => {
      const members = roster(t);
      const full = members.length >= LIMITS.PLAYERS_PER_TEAM;
      const mine = myTeam() === t;
      return h('section', { class: 'card team', style: { '--team': teamColor(t) } },
        h('h3', {}, teamName(t), h('span', { class: 'count' }, `${members.length}/${LIMITS.PLAYERS_PER_TEAM}`)),
        h('ul', {}, members.map((p) => playerLine(p, host && p.uid !== S.uid && h('span', { class: 'row-actions' },
          h('button', { class: 'btn tiny', onclick: () => act('setTeam', { team: null, targetUid: p.uid }) }, 'Unassign'),
          h('button', { class: `btn tiny ${online(p.uid) ? '' : 'danger'}`, onclick: () => act('removePlayer', { targetUid: p.uid }) }, 'Remove'))))),
        mine ? h('button', { class: 'btn small ghost', onclick: () => act('setTeam', { team: null }) }, 'Leave team')
          : h('button', { class: 'btn small', disabled: full, onclick: () => act('setTeam', { team: t }) }, full ? 'Team full' : 'Join team'));
    }));
    const un = Object.entries(S.players).map(([uid, p]) => ({ uid, ...p })).filter((p) => { const t = teamOf({ teams: S.teams }, p.uid); return t === null || t >= s.teamCount; });
    replace(unassignedEl, h('h3', {}, 'Waiting for a team'), un.length ? h('ul', {}, un.map((p) => playerLine(p, host && h('span', { class: 'row-actions' },
      h('select', {
        'aria-label': `Assign ${p.name} to a team`,
        onchange: (e) => { if (e.target.value !== '') act('setTeam', { team: Number(e.target.value), targetUid: p.uid }); },
      }, h('option', { value: '' }, 'Assign…'), Array.from({ length: s.teamCount }, (_, t) => h('option', { value: t }, teamName(t)))),
      p.uid !== S.uid && h('button', { class: `btn tiny ${online(p.uid) ? '' : 'danger'}`, onclick: () => act('removePlayer', { targetUid: p.uid }) }, 'Remove'))))) : h('p', { class: 'muted' }, 'Everyone is on a team.'));

    const ready = lobbyReadiness({ meta: m, teams: S.teams || {} });
    const hostOffline = !host && !online(m.hostUid) && Object.keys(S.presence).length > 0;
    replace(statusEl, h('h2', {}, host ? 'Ready to start?' : 'Waiting for the host'),
      ready.ready ? h('p', { class: 'ok' }, 'All teams are full.') : h('ul', { class: 'problems' }, ready.problems.map((p) => h('li', {}, p))),
      host ? h('button', { class: 'btn primary big', disabled: !ready.ready, onclick: () => act('startGame') }, 'Start game') : null,
      hostOffline ? h('div', {}, h('p', { class: 'muted' }, 'The host appears to be disconnected.'), h('button', { class: 'btn small', onclick: () => act('claimHost', {}, { hostOnline: online(m.hostUid) }) }, 'Take over as host')) : null);

    if (form) {
      const sig = JSON.stringify(s);
      if (sig !== formSig && !form.isDirty()) { form.setValues(s); formSig = sig; }
    } else {
      replace(summaryEl, h('ul', { class: 'summary' },
        h('li', {}, `Teams: ${s.teamCount}`), h('li', {}, `Target score: ${s.targetScore}`),
        h('li', {}, `Prompts: ${{ builtin: 'built-in', custom: 'custom only', mixed: 'built-in + custom' }[s.promptMode]}`),
        arr(s.customPrompts).length ? h('li', {}, `${arr(s.customPrompts).length} custom prompts`) : null));
    }
  };
}

/* ---------- game ---------- */
function gameView() {
  const turn = S.game.turn;
  let lastState = null;
  let lastSent = 0, pending = null, timer = null;
  const pushLive = (pos) => {
    pending = pos;
    const wait = Math.max(0, 60 - (Date.now() - lastSent));
    clearTimeout(timer);
    timer = setTimeout(() => { lastSent = Date.now(); api.liveRef(S.code).set({ pos: pending, turn }).catch(() => {}); }, wait);
  };
  const dial = createDial({ bandsFor: scoringBands, onInput: pushLive, onCommit: pushLive });
  unsubs.push(() => clearTimeout(timer));
  const scoreEl = h('div');
  const statusEl = h('section', { class: 'status' });
  const promptEl = h('div', { class: 'spectrum-labels' });
  const dialWrap = h('div', { class: 'dial-wrap' }, dial.el);
  const nudge = h('div', { class: 'nudge', hidden: true },
    h('button', { class: 'btn small', 'aria-label': 'Move needle left', onclick: () => { dial.setGuess(dial.getGuess() - 1); pushLive(dial.getGuess()); } }, '◀ −1'),
    h('button', { class: 'btn small', 'aria-label': 'Move needle right', onclick: () => { dial.setGuess(dial.getGuess() + 1); pushLive(dial.getGuess()); } }, '+1 ▶'));
  const controls = h('div', { class: 'controls' });
  const resultEl = h('div');
  let wroteTarget = false, triedReveal = false;
  put(topBar(), h('div', { class: 'offline-slot' }), scoreEl, statusEl, promptEl, dialWrap, nudge, controls, resultEl);

  return function update() {
    const g = S.game, uid = S.uid;
    if (!g.prompt) return;
    replace(root.querySelector('.offline-slot'), S.offline && offlineBanner());
    replace(scoreEl, scoreboard());
    const active = g.activeTeam;
    const isPsychic = g.psychicUid === uid, isGuesser = g.guesserUid === uid;
    const nm = (u) => (S.players[u] ? S.players[u].name : 'Someone');
    dial.setAccent(teamColor(active));
    replace(promptEl, h('span', {}, g.prompt.low), h('span', {}, g.prompt.high));

    const secretTarget = S.secret && S.secret.turn === g.turn ? S.secret.target : null;
    const lock = S.lock && S.lock.turn === g.turn ? S.lock : null;
    // Trusted-client steps: the Psychic's browser rolls the target (only they and spectators can read it),
    // and any browser that can see the target publishes the result once the Guesser has locked in.
    if (g.state === STATES.CLUE && isPsychic && secretTarget === null && !wroteTarget) { wroteTarget = true; quietAct('writeTarget'); }
    if (g.state === STATES.GUESSING && lock && !isGuesser && secretTarget !== null && !triedReveal && !S.busy) {
      triedReveal = true;
      setTimeout(() => quietAct('reveal'), isPsychic ? 100 : 600);
    }
    const result = g.state === STATES.REVEAL ? g.result : null;
    const target = result ? result.target : isGuesser ? null : secretTarget;
    const justRevealed = result && lastState !== STATES.REVEAL;
    dial.setTarget(target, justRevealed);

    const canMove = isGuesser && g.state === STATES.GUESSING && !lock;
    dial.setInteractive(canMove);
    nudge.hidden = !canMove;
    if (result) dial.setGuess(result.guess);
    else if (lock) dial.setGuess(lock.guess);
    else if (!isGuesser || g.state !== STATES.GUESSING) dial.setGuess(g.state === STATES.GUESSING && S.live && S.live.turn === g.turn && typeof S.live.pos === 'number' ? S.live.pos : 50);
    dialWrap.classList.toggle('locked', !canMove);
    lastState = g.state;

    const role = isPsychic ? 'Psychic' : isGuesser ? 'Guesser' : 'Spectator';
    let info;
    if (g.state === STATES.CLUE) {
      info = isPsychic ? 'You are the Psychic. Say a clue out loud that fits where the target sits on this spectrum, then continue.'
        : isGuesser ? `You are the Guesser. Wait for ${nm(g.psychicUid)}'s clue — the target is hidden from you.`
          : `Spectating. You can see the target; ${nm(g.psychicUid)} is thinking of a clue.`;
    } else if (g.state === STATES.GUESSING) {
      info = isPsychic ? 'Your teammate is placing the needle. Don\'t give any more hints!'
        : isGuesser ? (lock ? 'Guess locked in – revealing…' : 'Drag the needle (or use arrow keys) to where you think the target is, then lock it in.')
          : `Spectating — watch ${nm(g.guesserUid)} move the needle live.`;
    } else info = 'Result';
    replace(statusEl,
      h('div', { class: 'turn', style: { '--team': teamColor(active) } },
        h('strong', {}, `${teamName(active)}'s turn`), h('span', {}, `🔮 ${nm(g.psychicUid)} · 🎯 ${nm(g.guesserUid)}`)),
      h('span', { class: `role role-${role.toLowerCase()}` }, `You: ${role}`),
      g.state !== STATES.REVEAL && h('p', {}, info));

    const btns = [];
    if (g.state === STATES.CLUE && isPsychic) btns.push(h('button', { class: 'btn primary big', disabled: secretTarget === null, onclick: () => act('clueGiven') }, 'I\'ve given my clue'));
    if (g.state === STATES.GUESSING && isGuesser && !lock) btns.push(h('button', {
      class: 'btn primary big',
      onclick: () => act('lockGuess', { guess: dial.getGuess() }),
    }, 'Lock in guess'));
    if (g.state === STATES.GUESSING && lock && !isGuesser) btns.push(h('button', { class: 'btn primary big', onclick: () => act('reveal') }, 'Reveal result'));
    replace(controls, btns);

    if (result) {
      const canAdvance = isHost() || myTeam() === active;
      const won = g.winnerTeam != null;
      replace(resultEl, h('section', { class: `card result pts-${result.points}`, 'aria-live': 'polite' },
        h('h2', {}, result.points === 2 ? 'Bullseye! +2' : result.points === 1 ? 'Close! +1' : 'Miss — 0 points'),
        h('p', {}, `Target ${result.target} · Guess ${result.guess} · ${teamName(active)} now has ${arr(g.scores)[active]} point${arr(g.scores)[active] === 1 ? '' : 's'}.`),
        won && h('p', { class: 'ok' }, `${teamName(g.winnerTeam)} reached ${S.meta.settings.targetScore} points!`),
        canAdvance ? h('button', { class: 'btn primary big', onclick: () => act('nextTurn') }, won ? 'See final results' : 'Next turn')
          : h('p', { class: 'muted' }, 'Waiting for the host or the active team to continue…')));
    } else replace(resultEl);
  };
}

/* ---------- finished ---------- */
function finishedView() {
  const el = h('div');
  put(topBar(), el);
  return function update() {
    const g = S.game, n = S.meta.settings.teamCount;
    const w = g.winnerTeam == null ? 0 : g.winnerTeam;
    const order = Array.from({ length: n }, (_, t) => t).sort((a, b) => arr(g.scores)[b] - arr(g.scores)[a]);
    replace(el, h('section', { class: 'card center winner', style: { '--team': teamColor(w) } },
      h('div', { class: 'trophy', 'aria-hidden': 'true' }, '🏆'),
      h('h1', {}, `${teamName(w)} wins!`),
      h('p', {}, roster(w).map((p) => p.name).join(' & ')),
      h('ol', { class: 'final' }, order.map((t) => h('li', { style: { '--team': teamColor(t) } }, h('span', {}, teamName(t)), h('strong', {}, arr(g.scores)[t] || 0)))),
      isHost() ? h('button', { class: 'btn primary big', onclick: () => act('playAgain') }, 'Play again')
        : h('p', { class: 'muted' }, 'Waiting for the host to start a new game…'),
      h('a', { class: 'btn ghost', href: '../' }, 'Back to homepage')));
  };
}

/* ---------- boot ---------- */
async function boot() {
  root.appendChild(h('div', { class: 'spinner', role: 'status', 'aria-label': 'Signing in' }));
  try {
    const user = await api.ensureUser();
    S.uid = user.uid;
  } catch (e) {
    clear(root);
    root.appendChild(h('section', { class: 'card center' }, h('h2', {}, 'Could not connect'), h('p', {}, api.friendlyError(e)),
      h('button', { class: 'btn primary', onclick: () => location.reload() }, 'Retry')));
    return;
  }
  clear(root);
  const fromUrl = normalizeRoomCode(new URLSearchParams(location.search).get('room'));
  const code = isValidRoomCode(fromUrl) ? fromUrl : null;
  if (code) startRoom(code); else schedule();
}
window.addEventListener('pagehide', stopListeners);
boot();
