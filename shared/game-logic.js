/*
 * Pure, framework-free Wavelength game rules. Used by the Cloud Functions (trusted) and by the
 * browser (display only: band geometry, prompt preview/validation). Contains no Firebase calls.
 */
(function (root, factory) {
  const deps = typeof module === 'object' && module.exports
    ? { ...require('./constants.js'), ...require('./prompts.js') }
    : root.WavelengthShared;
  const api = factory(deps);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.WavelengthShared = Object.assign(root.WavelengthShared || {}, api);
})(typeof self !== 'undefined' ? self : this, function (deps) {
  const { SCORING, SPECTRUM, LIMITS, ROOM_CODE_ALPHABET, STATES, TRANSITIONS, PROMPT_MODES, GAME_MODES, BUILTIN_PROMPTS } = deps;

  class GameError extends Error {
    constructor(code, message) {
      super(message);
      this.name = 'GameError';
      this.code = code; // e.g. 'invalid-state', 'permission-denied', 'team-full', 'invalid-argument'
    }
  }

  const clone = (o) => (o === undefined ? undefined : JSON.parse(JSON.stringify(o)));
  // Firebase RTDB turns empty arrays into missing values and sparse arrays into objects.
  const arr = (x) => {
    if (Array.isArray(x)) return x;
    if (x && typeof x === 'object') return Object.keys(x).sort((a, b) => a - b).map((k) => x[k]);
    return [];
  };
  const cleanText = (s, max) =>
    String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

  /* ---------- Scoring ---------- */
  const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

  function scoreGuess(target, guess) {
    const d = Math.abs(guess - target);
    if (d <= SCORING.BULLSEYE_RADIUS) return SCORING.BULLSEYE_POINTS;
    if (d <= SCORING.CENTER_RADIUS) return SCORING.CENTER_POINTS;
    if (d <= SCORING.SIDE_RADIUS) return SCORING.SIDE_POINTS;
    return 0;
  }

  /** Scoring bands aligned on the target and clipped to the dial. Ordered left to right. */
  function scoringBands(target) {
    const b = SCORING.BULLSEYE_RADIUS, c = SCORING.CENTER_RADIUS, s = SCORING.SIDE_RADIUS;
    const raw = [
      { from: target - s, to: target - c, points: SCORING.SIDE_POINTS },
      { from: target - c, to: target - b, points: SCORING.CENTER_POINTS },
      { from: target - b, to: target + b, points: SCORING.BULLSEYE_POINTS },
      { from: target + b, to: target + c, points: SCORING.CENTER_POINTS },
      { from: target + c, to: target + s, points: SCORING.SIDE_POINTS },
    ];
    return raw
      .map((x) => ({ ...x, from: clamp(x.from, SPECTRUM.MIN, SPECTRUM.MAX), to: clamp(x.to, SPECTRUM.MIN, SPECTRUM.MAX) }))
      .filter((x) => x.to > x.from);
  }

  /* ---------- Prompts ---------- */
  /** Parses "(higher, lower)" lines. Returns { prompts: [{high, low}], errors: [{line, text, message}] }. */
  function parsePrompts(text) {
    const prompts = [];
    const errors = [];
    String(text == null ? '' : text).split(/\r?\n/).forEach((raw, i) => {
      const line = raw.trim();
      if (!line) return;
      const err = (message) => errors.push({ line: i + 1, text: line, message });
      if (!line.startsWith('(') || !line.endsWith(')')) return err('Wrap the pair in parentheses, e.g. (Hot, Cold).');
      const inner = line.slice(1, -1);
      if (/[()]/.test(inner)) return err('Unexpected extra parentheses.');
      const parts = inner.split(',');
      if (parts.length < 2) return err('Separate the two values with a comma, e.g. (Hot, Cold).');
      if (parts.length > 2) return err('Use exactly one comma (values cannot contain commas).');
      const [high, low] = parts.map((p) => p.replace(/\s+/g, ' ').trim());
      if (!high || !low) return err('Both values must be non-empty.');
      if (high.length > LIMITS.MAX_PROMPT_LENGTH || low.length > LIMITS.MAX_PROMPT_LENGTH)
        return err(`Each value must be at most ${LIMITS.MAX_PROMPT_LENGTH} characters.`);
      if (/[<>]/.test(high + low)) return err('The characters < and > are not allowed.');
      prompts.push({ high, low });
    });
    if (prompts.length > LIMITS.MAX_CUSTOM_PROMPTS)
      errors.push({ line: 0, text: '', message: `At most ${LIMITS.MAX_CUSTOM_PROMPTS} custom prompts are allowed.` });
    return { prompts, errors };
  }

  function promptPool(settings) {
    const custom = arr(settings.customPrompts);
    if (settings.promptMode === 'custom') return custom;
    if (settings.promptMode === 'mixed') return [...BUILTIN_PROMPTS, ...custom];
    return [...BUILTIN_PROMPTS];
  }

  function drawPrompt(pool, used, rng) {
    let u = arr(used).filter((i) => Number.isInteger(i) && i >= 0 && i < pool.length);
    if (u.length >= pool.length) u = [];
    const free = [];
    for (let i = 0; i < pool.length; i++) if (!u.includes(i)) free.push(i);
    const idx = free[Math.floor(rng() * free.length)];
    return { prompt: { high: pool[idx].high, low: pool[idx].low }, used: [...u, idx] };
  }

  /* ---------- Rooms & teams ---------- */
  const teamKey = (i) => `t${i}`;
  const MAX_KEYS = LIMITS.MAX_TEAMS;
  function generateRoomCode(rng) {
    let s = '';
    for (let i = 0; i < LIMITS.ROOM_CODE_LENGTH; i++) s += ROOM_CODE_ALPHABET[Math.floor(rng() * ROOM_CODE_ALPHABET.length)];
    return s;
  }
  const normalizeRoomCode = (c) => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const isValidRoomCode = (c) =>
    typeof c === 'string' && c.length === LIMITS.ROOM_CODE_LENGTH && [...c].every((ch) => ROOM_CODE_ALPHABET.includes(ch));

  /** Slots of a team: [a, b] uids (undefined when empty). Slot "a" of the team's first turn is the Psychic. */
  const teamSlots = (room, t) => {
    const e = (room.teams || {})[teamKey(t)] || {};
    return [e.a, e.b];
  };
  const teamMembers = (room, t) => teamSlots(room, t).filter(Boolean);
  function teamOf(room, uid) {
    for (let t = 0; t < MAX_KEYS; t++) if (teamSlots(room, t).includes(uid)) return t;
    return null;
  }

  const isCoop = (room) => !!(room && room.meta && room.meta.settings && room.meta.settings.gameMode === 'coop');
  /** Co-op rotation order: join order (uid as tie-break), so every device agrees on who is next. */
  function coopOrder(room) {
    return Object.entries(room.players || {})
      .sort((a, b) => (a[1].joinedAt - b[1].joinedAt) || (a[0] < b[0] ? -1 : 1))
      .map(([u]) => u);
  }

  function lobbyReadiness(room) {
    if (isCoop(room)) {
      const c = Object.keys(room.players || {}).length;
      const problems = c >= LIMITS.MIN_COOP_PLAYERS ? [] : [`Co-op needs at least ${LIMITS.MIN_COOP_PLAYERS} players (${c} so far).`];
      return { ready: problems.length === 0, problems };
    }
    const n = room.meta.settings.teamCount;
    const problems = [];
    for (let t = 0; t < n; t++) {
      const c = teamMembers(room, t).length;
      if (c !== LIMITS.PLAYERS_PER_TEAM)
        problems.push(`${arr(room.meta.settings.teamNames)[t]} has ${c}/${LIMITS.PLAYERS_PER_TEAM} players.`);
    }
    return { ready: problems.length === 0, problems };
  }

  /* ---------- State machine ---------- */
  const canTransition = (from, to) => (TRANSITIONS[from] || []).includes(to);
  function transition(game, to) {
    if (!canTransition(game.state, to)) throw new GameError('invalid-state', `Cannot go from "${game.state}" to "${to}".`);
    game.state = to;
  }

  /** Highest score >= target wins; ties go to the active team if tied, otherwise the lowest team index. */
  function determineWinner(scores, targetScore, activeTeam) {
    const s = arr(scores);
    const best = Math.max(...s);
    if (best < targetScore) return null;
    const tied = s.map((v, i) => (v === best ? i : -1)).filter((i) => i >= 0);
    return tied.includes(activeTeam) ? activeTeam : tied[0];
  }

  /** Converts stored team scores or co-op player scores into UI-friendly fields. */
  function decorateGame(game, teamCount) {
    if (!game) return game;
    const key = game.activeKey || 't0';
    const sc = game.scores || {};
    const coop = !!game.psychicUid && !game.guesserUid;
    return {
      ...game,
      activeTeam: Number(key.slice(1)),
      scores: coop ? sc : Array.from({ length: teamCount }, (_, t) => sc[teamKey(t)] || 0),
      winnerTeam: game.winnerKey && /^t[0-3]$/.test(game.winnerKey) ? Number(game.winnerKey.slice(1)) : null,
      winnerUid: game.winnerKey && !/^t[0-3]$/.test(game.winnerKey) ? game.winnerKey : null,
    };
  }

  /* ---------- Settings ---------- */
  function sanitizeSettings(input, prev) {
    const base = prev || {};
    const i = input || {};
    const pick = (k, d) => (i[k] !== undefined ? i[k] : base[k] !== undefined ? base[k] : d);
    const teamCount = Number(pick('teamCount', LIMITS.DEFAULT_TEAMS));
    const targetScore = Number(pick('targetScore', LIMITS.DEFAULT_TARGET_SCORE));
    const promptMode = pick('promptMode', 'builtin');
    const gameMode = pick('gameMode', 'versus');
    if (!GAME_MODES.includes(gameMode)) throw new GameError('invalid-argument', 'Unknown game mode.');
    if (!Number.isInteger(teamCount) || teamCount < LIMITS.MIN_TEAMS || teamCount > LIMITS.MAX_TEAMS)
      throw new GameError('invalid-argument', `Teams must be between ${LIMITS.MIN_TEAMS} and ${LIMITS.MAX_TEAMS}.`);
    if (!Number.isInteger(targetScore) || targetScore < LIMITS.MIN_TARGET_SCORE || targetScore > LIMITS.MAX_TARGET_SCORE)
      throw new GameError('invalid-argument', `Target score must be between ${LIMITS.MIN_TARGET_SCORE} and ${LIMITS.MAX_TARGET_SCORE}.`);
    if (!PROMPT_MODES.includes(promptMode)) throw new GameError('invalid-argument', 'Unknown prompt mode.');
    const coop = gameMode === 'coop';
    const rawNames = arr(pick('teamNames', []));
    const teamNames = Array.from({ length: coop ? 1 : teamCount }, (_, t) => cleanText(rawNames[t], LIMITS.MAX_TEAM_NAME_LENGTH) || `Team ${t + 1}`);
    const customPromptsText = String(pick('customPromptsText', '')).slice(0, 20000);
    const { prompts, errors } = parsePrompts(customPromptsText);
    if (errors.length) throw new GameError('invalid-argument', `Custom prompts: ${errors[0].message}${errors[0].line ? ` (line ${errors[0].line})` : ''}`);
    if ((promptMode === 'custom' || promptMode === 'mixed') && prompts.length === 0)
      throw new GameError('invalid-argument', 'Add at least one valid custom prompt or switch to built-in prompts.');
    const out = { teamCount: coop ? 1 : teamCount, targetScore, promptMode, teamNames, gameMode };
    if (prompts.length) { out.customPrompts = prompts; out.customPromptsText = customPromptsText; }
    return out;
  }

  /* ---------- Planners ----------
   * Each planner is pure: (room, actorUid, payload, env) -> { updates } where `updates` is a
   * multi-path update map keyed by absolute database paths ({code} is substituted by the caller).
   * The database rules re-check every transition, so a hostile client cannot do more than a planner can.
   * env = { now: <number or server-timestamp sentinel>, rng: () => [0,1) }.
   */
  const R = (p) => `wavelengthRooms/{code}/${p}`;
  const emptyScores = () => ({ t0: 0, t1: 0, t2: 0, t3: 0 });
  const activeLocks = (room, turn) => {
    const out = {};
    Object.entries(room.locks || {}).forEach(([u, l]) => { if (l && l.turn === turn) out[u] = l; });
    return out;
  };

  function emptyGame() {
    return { state: STATES.LOBBY, turn: 0, activeKey: 't0', scores: emptyScores(), teamTurns: emptyScores() };
  }
  const requireMember = (room, uid) => {
    if (!room.players || !room.players[uid]) throw new GameError('permission-denied', 'You are not in this room.');
  };
  const requireHost = (room, uid) => {
    if (room.meta.hostUid !== uid) throw new GameError('permission-denied', 'Only the host can do that.');
  };
  const requireState = (room, st, msg) => {
    if (room.game.state !== st) throw new GameError('invalid-state', msg || `Not allowed during "${room.game.state}".`);
  };
  const stamp = (env) => ({ [R('meta/updatedAt')]: env.now });
  const cleanName = (name) => {
    const n = cleanText(name, LIMITS.MAX_NAME_LENGTH);
    if (!n) throw new GameError('invalid-argument', 'Please enter a display name.');
    return n;
  };

  function createRoom(hostUid, name, settingsInput, env) {
    const settings = sanitizeSettings(settingsInput);
    return {
      meta: { hostUid, createdAt: env.now, updatedAt: env.now, settings },
      players: { [hostUid]: { name: cleanName(name), joinedAt: env.now } },
      game: emptyGame(),
    };
  }

  /** Does not need room state (a non-member cannot read it); the rules reject joins unless the room exists and is in the lobby. */
  function joinRoom(_room, uid, { name, exists }, env) {
    const n = cleanName(name);
    if (exists) return { updates: { [R(`players/${uid}/name`)]: n, ...stamp(env) } };
    return { updates: { [R(`players/${uid}`)]: { name: n, joinedAt: env.now } } };
  }

  function setTeam(room, actor, { team, targetUid }, env) {
    requireMember(room, actor);
    const target = targetUid || actor;
    if (target !== actor) requireHost(room, actor);
    requireMember(room, target);
    requireState(room, STATES.LOBBY, 'Teams are locked once the game starts.');
    if (isCoop(room)) throw new GameError('invalid-state', 'Everyone is on one team in co-op mode.');
    const updates = {};
    const cur = teamOf(room, target);
    if (team === null || team === undefined) {
      if (cur === null) return { updates };
    } else {
      if (!Number.isInteger(team) || team < 0 || team >= room.meta.settings.teamCount) throw new GameError('invalid-argument', 'No such team.');
      if (cur === team) return { updates };
    }
    if (cur !== null) updates[R(`teams/${teamKey(cur)}/${teamSlots(room, cur)[0] === target ? 'a' : 'b'}`)] = null;
    if (team !== null && team !== undefined) {
      const [a, b] = teamSlots(room, team);
      if (a && b) throw new GameError('team-full', 'That team is already full.');
      updates[R(`teams/${teamKey(team)}/${a ? 'b' : 'a'}`)] = target;
    }
    return { updates: { ...updates, ...stamp(env) } };
  }

  function updateSettings(room, actor, input, env) {
    requireMember(room, actor);
    requireHost(room, actor);
    requireState(room, STATES.LOBBY, 'Settings can only be changed in the lobby.');
    const settings = sanitizeSettings(input, room.meta.settings);
    const updates = { [R('meta/settings')]: settings, ...stamp(env) };
    for (let t = isCoop({ meta: { settings } }) ? 0 : settings.teamCount; t < MAX_KEYS; t++) {
      const [a, b] = teamSlots(room, t);
      if (a) updates[R(`teams/${teamKey(t)}/a`)] = null;
      if (b) updates[R(`teams/${teamKey(t)}/b`)] = null;
    }
    return { updates };
  }

  function beginTurn(room, team, usedIn, env) {
    const [a, b] = teamSlots(room, team);
    if (!a || !b) throw new GameError('invalid-state', 'Team does not have exactly 2 players.');
    const old = room.game;
    const k = teamKey(team);
    const turns = ((old.teamTurns || {})[k] || 0) + 1;
    const { prompt, used } = drawPrompt(promptPool(room.meta.settings), usedIn, env.rng);
    const game = {
      state: STATES.CLUE,
      turn: old.turn + 1,
      activeKey: k,
      scores: { ...emptyScores(), ...(old.scores || {}) },
      teamTurns: { ...emptyScores(), ...(old.teamTurns || {}), [k]: turns },
      psychicUid: turns % 2 === 1 ? a : b, // roles alternate every time this team plays
      guesserUid: turns % 2 === 1 ? b : a,
      prompt,
    };
    return { game, used };
  }

  /** Co-op: everyone is on team t0; the Psychic rotates through the players and everyone else guesses. */
  function beginCoopTurn(room, usedIn, env) {
    const old = room.game;
    const order = coopOrder(room);
    if (order.length < LIMITS.MIN_COOP_PLAYERS) throw new GameError('invalid-state', 'Not enough players.');
    const turns = ((old.teamTurns || {}).t0 || 0) + 1;
    const { prompt, used } = drawPrompt(promptPool(room.meta.settings), usedIn, env.rng);
    const scores = Object.fromEntries(order.map((uid) => [uid, (old.scores || {})[uid] || 0]));
    const game = {
      state: STATES.CLUE,
      turn: old.turn + 1,
      activeKey: 't0',
      scores,
      teamTurns: { ...emptyScores(), ...(old.teamTurns || {}), t0: turns },
      psychicUid: order[(turns - 1) % order.length],
      prompt,
    };
    return { game, used };
  }

  function startGame(room, actor, _p, env) {
    requireMember(room, actor);
    requireHost(room, actor);
    requireState(room, STATES.LOBBY, 'The game has already started.');
    const { ready, problems } = lobbyReadiness(room);
    if (!ready) throw new GameError('lobby-not-ready', problems.join(' '));
    const fresh = { ...room, game: emptyGame() };
    const { game, used } = isCoop(room) ? beginCoopTurn(fresh, [], env) : beginTurn(fresh, 0, [], env);
    return {
      updates: {
        [R('game')]: game, [R('used')]: used, [R('secret')]: null, [R('lock')]: null, [R('locks')]: null, 'live/{code}': null,
        [R('meta/notice')]: null, ...stamp(env),
      },
    };
  }

  /** The Psychic's browser picks the target (rules guarantee only the Psychic can write it, and the Guesser cannot read it). */
  function writeTarget(room, actor, _p, env) {
    requireMember(room, actor);
    requireState(room, STATES.CLUE);
    if (room.game.psychicUid !== actor) throw new GameError('permission-denied', 'Only the Psychic can set the target.');
    if (room.secret && room.secret.turn === room.game.turn) return { updates: {} };
    const target = clamp(Math.round(env.rng() * (SPECTRUM.MAX - SPECTRUM.MIN) * 10) / 10 + SPECTRUM.MIN, SPECTRUM.MIN, SPECTRUM.MAX);
    return { updates: { [R('secret')]: { target, turn: room.game.turn } } };
  }

  function clueGiven(room, actor, _p, env) {
    requireMember(room, actor);
    requireState(room, STATES.CLUE, 'Not waiting for a clue.');
    if (room.game.psychicUid !== actor) throw new GameError('permission-denied', 'Only the Psychic can do that.');
    if (!room.secret || room.secret.turn !== room.game.turn) throw new GameError('invalid-state', 'The target is still being set. Try again in a second.');
    return { updates: { [R('game')]: { ...room.game, state: STATES.GUESSING }, ...stamp(env) } };
  }

  /** Step 1 of a guess: the Guesser (who cannot see the target) locks the guess. Can only be done once per turn. */
  function lockGuess(room, actor, { guess }, env) {
    requireMember(room, actor);
    const g = room.game;
    requireState(room, STATES.GUESSING, 'No guess is expected right now.');
    if (isCoop(room)) {
      if (g.psychicUid === actor) throw new GameError('permission-denied', 'The Psychic does not guess.');
      if (activeLocks(room, g.turn)[actor]) throw new GameError('invalid-state', 'Your guess is already locked.');
    } else if (g.guesserUid !== actor) throw new GameError('permission-denied', 'Only the active Guesser can submit.');
    if (!isCoop(room) && room.lock && room.lock.turn === g.turn) throw new GameError('invalid-state', 'The guess is already locked.');
    const gv = Number(guess);
    if (typeof guess === 'boolean' || guess === null || guess === '' || !Number.isFinite(gv) || gv < SPECTRUM.MIN || gv > SPECTRUM.MAX)
      throw new GameError('invalid-argument', 'Guess must be a number from 0 to 100.');
    const lock = { turn: g.turn, guess: Math.round(gv * 10) / 10 };
    return { updates: { [R(isCoop(room) ? `locks/${actor}` : 'lock')]: lock, ...stamp(env) } };
  }

  /** Step 2: any other player who can see the target publishes the result; the rules recompute and verify it. */
  /** Co-op: the Psychic (the only one who can read the target) publishes once every guesser has locked in. */
  function revealCoop(room, actor, env) {
    const g = room.game;
    requireState(room, STATES.GUESSING, 'The guesses are not locked yet.');
    if (g.psychicUid !== actor) throw new GameError('permission-denied', 'Only the Psychic can reveal.');
    if (!room.secret || room.secret.turn !== g.turn) throw new GameError('invalid-state', 'The target is missing.');
    const locks = activeLocks(room, g.turn);
    const guessers = Object.keys(room.players).filter((u) => u !== g.psychicUid);
    if (guessers.some((u) => !locks[u])) throw new GameError('invalid-state', 'Waiting for everyone to lock in a guess.');
    const target = room.secret.target;
    const guesserPoints = Object.fromEntries(guessers.map((uid) => [uid, scoreGuess(target, locks[uid].guess)]));
    const total = Object.values(guesserPoints).reduce((sum, points) => sum + points, 0);
    const bullseyeUid = guessers.find((uid) => guesserPoints[uid] === SCORING.BULLSEYE_POINTS);
    const psychicPoints = bullseyeUid
      ? 1
      : total === 0 ? -LIMITS.COOP_PENALTY : 0;
    let best = locks[guessers[0]].guess;
    guessers.forEach((u) => { if (Math.abs(locks[u].guess - target) < Math.abs(best - target)) best = locks[u].guess; });
    const scores = { ...(g.scores || {}) };
    Object.entries(guesserPoints).forEach(([uid, points]) => { scores[uid] = (scores[uid] || 0) + points; });
    scores[g.psychicUid] = (scores[g.psychicUid] || 0) + psychicPoints;
    const result = {
      guess: best, target, diff: Math.abs(best - target),
      points: total + psychicPoints, guesserPoints, psychicPoints, bullseyeUid: bullseyeUid || null,
    };
    const order = coopOrder(room);
    const candidates = order.filter((uid) => scores[uid] >= room.meta.settings.targetScore);
    const winner = candidates.sort((a, b) => scores[b] - scores[a] || order.indexOf(a) - order.indexOf(b))[0];
    const game = { ...g, state: STATES.REVEAL, scores, result };
    if (winner) game.winnerKey = winner;
    return { updates: { [R('game')]: game, ...stamp(env) } };
  }

  function reveal(room, actor, _p, env) {
    requireMember(room, actor);
    if (isCoop(room)) return revealCoop(room, actor, env);
    const g = room.game;
    requireState(room, STATES.GUESSING, 'The guess is not locked yet.');
    if (g.guesserUid === actor) throw new GameError('permission-denied', 'The Guesser cannot reveal the target.');
    if (!room.lock || room.lock.turn !== g.turn) throw new GameError('invalid-state', 'The guess is not locked yet.');
    if (!room.secret || room.secret.turn !== g.turn) throw new GameError('invalid-state', 'The target is missing.');
    const target = room.secret.target, guess = room.lock.guess;
    const diff = Math.abs(guess - target);
    const points = scoreGuess(target, guess);
    const scores = { ...emptyScores(), ...(g.scores || {}) };
    scores[g.activeKey] += points;
    const game = { ...g, state: STATES.REVEAL, scores, result: { guess, target, diff, points } };
    if (scores[g.activeKey] >= room.meta.settings.targetScore) game.winnerKey = g.activeKey;
    return { updates: { [R('game')]: game, ...stamp(env) } };
  }

  function nextTurn(room, actor, _p, env) {
    requireMember(room, actor);
    const g = room.game;
    requireState(room, STATES.REVEAL, 'The turn is not finished yet.');
    if (room.meta.hostUid !== actor && actor !== g.psychicUid && (isCoop(room) || actor !== g.guesserUid))
      throw new GameError('permission-denied', 'Only the host or the active team can advance.');
    if (g.winnerKey) {
      const game = { ...g };
      transition(game, STATES.FINISHED);
      return { updates: { [R('game')]: game, ...stamp(env) } };
    }
    if (isCoop(room)) {
      const t = beginCoopTurn(room, room.used, env);
      return { updates: { [R('game')]: t.game, [R('used')]: t.used, ...stamp(env) } };
    }
    const next = (Number(g.activeKey.slice(1)) + 1) % room.meta.settings.teamCount;
    const { game, used } = beginTurn(room, next, room.used, env);
    return { updates: { [R('game')]: game, [R('used')]: used, ...stamp(env) } };
  }

  function playAgain(room, actor, _p, env) {
    requireMember(room, actor);
    requireHost(room, actor);
    requireState(room, STATES.FINISHED, 'The game is not over.');
    return { updates: { [R('game')]: emptyGame(), [R('used')]: null, [R('secret')]: null, [R('lock')]: null, [R('locks')]: null, 'live/{code}': null, ...stamp(env) } };
  }

  /** Leave (target === actor) or host removal. Deletes the room when the last player leaves. */
  function removePlayer(room, actor, { targetUid }, env) {
    requireMember(room, actor);
    const target = targetUid || actor;
    if (target !== actor) {
      requireHost(room, actor);
      if (target === room.meta.hostUid) throw new GameError('invalid-argument', 'The host cannot be removed.');
    }
    requireMember(room, target);
    const others = Object.entries(room.players).filter(([u]) => u !== target).sort((a, b) => a[1].joinedAt - b[1].joinedAt);
    if (others.length === 0) {
      return { updates: { 'wavelengthRooms/{code}': null, 'presence/{code}': null, 'live/{code}': null } };
    }
    const updates = { [R(`players/${target}`)]: null, ...stamp(env) };
    const t = teamOf(room, target);
    if (t !== null) updates[R(`teams/${teamKey(t)}/${teamSlots(room, t)[0] === target ? 'a' : 'b'}`)] = null;
    if (room.meta.hostUid === target) updates[R('meta/hostUid')] = others[0][0];
    if (room.game.state !== STATES.LOBBY) {
      updates[R('game')] = emptyGame();
      updates[R('meta/notice')] = `${room.players[target].name} left, so the game returned to the lobby.`;
      if (room.meta.hostUid === actor) { updates[R('secret')] = null; updates[R('lock')] = null; updates[R('locks')] = null; updates[R('used')] = null; updates['live/{code}'] = null; }
    }
    return { updates };
  }

  /** Any member may take over hosting if the host is offline (env.hostOnline comes from presence; rules re-check it). */
  function claimHost(room, actor, _p, env) {
    requireMember(room, actor);
    if (room.meta.hostUid === actor) return { updates: {} };
    if (env.hostOnline) throw new GameError('invalid-state', 'The host is still connected.');
    return { updates: { [R('meta/hostUid')]: actor, ...stamp(env) } };
  }

  const planners = { joinRoom, setTeam, updateSettings, startGame, writeTarget, clueGiven, lockGuess, reveal, nextTurn, playAgain, removePlayer, claimHost };

  return {
    GameError, arr, cleanText, scoreGuess, scoringBands, parsePrompts, promptPool, drawPrompt,
    generateRoomCode, normalizeRoomCode, isValidRoomCode, teamKey, teamSlots, teamMembers, teamOf, lobbyReadiness,
    isCoop, coopOrder, activeLocks, canTransition, transition, determineWinner, decorateGame, sanitizeSettings, createRoom, emptyGame, planners,
  };
});
