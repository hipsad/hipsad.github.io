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
  const { SCORING, SPECTRUM, LIMITS, ROOM_CODE_ALPHABET, STATES, TRANSITIONS, PROMPT_MODES, BUILTIN_PROMPTS } = deps;

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
    if (d <= SCORING.CENTER_RADIUS) return SCORING.CENTER_POINTS;
    if (d <= SCORING.SIDE_RADIUS) return SCORING.SIDE_POINTS;
    return 0;
  }

  /** Scoring bands aligned on the target and clipped to the dial. Ordered left to right. */
  function scoringBands(target) {
    const c = SCORING.CENTER_RADIUS, s = SCORING.SIDE_RADIUS;
    const raw = [
      { from: target - s, to: target - c, points: SCORING.SIDE_POINTS },
      { from: target - c, to: target + c, points: SCORING.CENTER_POINTS },
      { from: target + c, to: target + s, points: SCORING.SIDE_POINTS },
    ];
    return raw
      .map((b) => ({ ...b, from: clamp(b.from, SPECTRUM.MIN, SPECTRUM.MAX), to: clamp(b.to, SPECTRUM.MIN, SPECTRUM.MAX) }))
      .filter((b) => b.to > b.from);
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

  function shuffledIndices(n, rng) {
    const a = Array.from({ length: n }, (_, i) => i);
    for (let i = n - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  /** Draws without repeats until the pool is exhausted, then reshuffles. Returns { prompt, deck }. */
  function drawPrompt(pool, deck, rng) {
    let d = arr(deck).filter((i) => Number.isInteger(i) && i >= 0 && i < pool.length);
    if (d.length === 0) d = shuffledIndices(pool.length, rng);
    const idx = d[0];
    return { prompt: { high: pool[idx].high, low: pool[idx].low }, deck: d.slice(1) };
  }

  /* ---------- Rooms & teams ---------- */
  function generateRoomCode(rng) {
    let s = '';
    for (let i = 0; i < LIMITS.ROOM_CODE_LENGTH; i++) s += ROOM_CODE_ALPHABET[Math.floor(rng() * ROOM_CODE_ALPHABET.length)];
    return s;
  }
  const normalizeRoomCode = (c) => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const isValidRoomCode = (c) =>
    typeof c === 'string' && c.length === LIMITS.ROOM_CODE_LENGTH && [...c].every((ch) => ROOM_CODE_ALPHABET.includes(ch));

  const teamMembers = (room, team) =>
    Object.entries(room.players || {})
      .filter(([, p]) => p.team === team)
      .sort((a, b) => a[1].joinedAt - b[1].joinedAt || (a[0] < b[0] ? -1 : 1))
      .map(([uid]) => uid);

  function lobbyReadiness(room) {
    const n = room.meta.settings.teamCount;
    const problems = [];
    for (let t = 0; t < n; t++) {
      const c = teamMembers(room, t).length;
      if (c !== LIMITS.PLAYERS_PER_TEAM)
        problems.push(`${room.meta.settings.teamNames[t]} has ${c}/${LIMITS.PLAYERS_PER_TEAM} players.`);
    }
    const unassigned = Object.values(room.players || {}).filter((p) => p.team == null || p.team >= n).length;
    if (unassigned) problems.push(`${unassigned} player(s) have not joined a team.`);
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

  /* ---------- Settings ---------- */
  function sanitizeSettings(input, prev) {
    const base = prev || {};
    const i = input || {};
    const pick = (k, d) => (i[k] !== undefined ? i[k] : base[k] !== undefined ? base[k] : d);
    const teamCount = Number(pick('teamCount', LIMITS.DEFAULT_TEAMS));
    const targetScore = Number(pick('targetScore', LIMITS.DEFAULT_TARGET_SCORE));
    const promptMode = pick('promptMode', 'builtin');
    if (!Number.isInteger(teamCount) || teamCount < LIMITS.MIN_TEAMS || teamCount > LIMITS.MAX_TEAMS)
      throw new GameError('invalid-argument', `Teams must be between ${LIMITS.MIN_TEAMS} and ${LIMITS.MAX_TEAMS}.`);
    if (!Number.isInteger(targetScore) || targetScore < LIMITS.MIN_TARGET_SCORE || targetScore > LIMITS.MAX_TARGET_SCORE)
      throw new GameError('invalid-argument', `Target score must be between ${LIMITS.MIN_TARGET_SCORE} and ${LIMITS.MAX_TARGET_SCORE}.`);
    if (!PROMPT_MODES.includes(promptMode)) throw new GameError('invalid-argument', 'Unknown prompt mode.');
    const rawNames = arr(pick('teamNames', []));
    const teamNames = Array.from({ length: teamCount }, (_, t) => cleanText(rawNames[t], LIMITS.MAX_TEAM_NAME_LENGTH) || `Team ${t + 1}`);
    const customPromptsText = String(pick('customPromptsText', '')).slice(0, 20000);
    const { prompts, errors } = parsePrompts(customPromptsText);
    if (errors.length) throw new GameError('invalid-argument', `Custom prompts: ${errors[0].message}${errors[0].line ? ` (line ${errors[0].line})` : ''}`);
    if ((promptMode === 'custom' || promptMode === 'mixed') && prompts.length === 0)
      throw new GameError('invalid-argument', 'Add at least one valid custom prompt or switch to built-in prompts.');
    return { teamCount, targetScore, promptMode, teamNames, customPromptsText, customPrompts: prompts };
  }

  /* ---------- Reducers (pure: return a new room; throw GameError) ---------- */
  const MAX_PLAYERS = LIMITS.MAX_TEAMS * LIMITS.PLAYERS_PER_TEAM + 4;

  function cleanName(name) {
    const n = cleanText(name, LIMITS.MAX_NAME_LENGTH);
    if (!n) throw new GameError('invalid-argument', 'Please enter a display name.');
    return n;
  }
  const requireMember = (room, uid) => {
    if (!room.players || !room.players[uid]) throw new GameError('permission-denied', 'You are not in this room.');
  };
  const requireHost = (room, uid) => {
    if (room.meta.hostUid !== uid) throw new GameError('permission-denied', 'Only the host can do that.');
  };
  const touch = (room, env) => { room.meta.updatedAt = env.now; return room; };

  function createRoom(hostUid, name, settingsInput, env) {
    const settings = sanitizeSettings(settingsInput);
    return {
      meta: { hostUid, createdAt: env.now, updatedAt: env.now, settings, notice: null },
      players: { [hostUid]: { name: cleanName(name), team: null, joinedAt: env.now } },
      game: emptyGame(settings),
    };
  }

  function emptyGame(settings) {
    return {
      state: STATES.LOBBY, turn: 0, activeTeam: 0,
      scores: Array(settings.teamCount).fill(0), teamTurns: Array(settings.teamCount).fill(0),
      psychicUid: null, guesserUid: null, prompt: null, result: null, winnerTeam: null,
    };
  }

  function joinRoom(r, uid, { name }, env) {
    const room = clone(r);
    const existing = room.players[uid];
    if (existing) {
      if (name) existing.name = cleanName(name);
      return touch(room, env); // reconnect: never create a duplicate slot
    }
    if (room.game.state !== STATES.LOBBY) throw new GameError('game-in-progress', 'This game has already started.');
    if (Object.keys(room.players).length >= MAX_PLAYERS) throw new GameError('room-full', 'This room is full.');
    room.players[uid] = { name: cleanName(name), team: null, joinedAt: env.now };
    return touch(room, env);
  }

  function setTeam(r, actor, { team, targetUid }, env) {
    const room = clone(r);
    requireMember(room, actor);
    const target = targetUid || actor;
    if (target !== actor) requireHost(room, actor);
    requireMember(room, target);
    if (room.game.state !== STATES.LOBBY) throw new GameError('invalid-state', 'Teams are locked once the game starts.');
    if (team !== null && team !== undefined) {
      if (!Number.isInteger(team) || team < 0 || team >= room.meta.settings.teamCount)
        throw new GameError('invalid-argument', 'No such team.');
      const others = teamMembers(room, team).filter((u) => u !== target);
      if (others.length >= LIMITS.PLAYERS_PER_TEAM) throw new GameError('team-full', 'That team is already full.');
      room.players[target].team = team;
    } else {
      room.players[target].team = null;
    }
    return touch(room, env);
  }

  function updateSettings(r, actor, input, env) {
    const room = clone(r);
    requireMember(room, actor);
    requireHost(room, actor);
    if (room.game.state !== STATES.LOBBY) throw new GameError('invalid-state', 'Settings can only be changed in the lobby.');
    const settings = sanitizeSettings(input, room.meta.settings);
    // For a changed team list, drop players from teams that no longer exist.
    Object.values(room.players).forEach((p) => { if (p.team != null && p.team >= settings.teamCount) p.team = null; });
    room.meta.settings = settings;
    room.game = emptyGame(settings);
    return touch(room, env);
  }

  function beginTurn(room, team, env) {
    const members = teamMembers(room, team);
    if (members.length !== LIMITS.PLAYERS_PER_TEAM) throw new GameError('invalid-state', 'Team does not have exactly 2 players.');
    const g = room.game;
    const n = arr(g.teamTurns)[team] || 0;
    const psychic = members[n % 2];
    const guesser = members[(n + 1) % 2];
    g.teamTurns = arr(g.teamTurns).slice();
    g.teamTurns[team] = n + 1;
    g.activeTeam = team;
    g.turn += 1;
    g.psychicUid = psychic;
    g.guesserUid = guesser;
    g.result = null;
    const pool = promptPool(room.meta.settings);
    const { prompt, deck } = drawPrompt(pool, (room.server || {}).deck, env.rng);
    g.prompt = prompt;
    const target = clamp(Math.round(env.rng() * (SPECTRUM.MAX - SPECTRUM.MIN) * 10) / 10 + SPECTRUM.MIN, SPECTRUM.MIN, SPECTRUM.MAX);
    room.server = { target, deck };
    // Everyone except the active guesser may read the target while the turn is in progress.
    room.secret = {};
    Object.keys(room.players).forEach((u) => { if (u !== guesser) room.secret[u] = { target, turn: g.turn }; });
    transition(g, STATES.CLUE);
  }

  function startGame(r, actor, _p, env) {
    const room = clone(r);
    requireMember(room, actor);
    requireHost(room, actor);
    if (room.game.state !== STATES.LOBBY) throw new GameError('invalid-state', 'The game has already started.');
    const { ready, problems } = lobbyReadiness(room);
    if (!ready) throw new GameError('lobby-not-ready', problems.join(' '));
    room.game = emptyGame(room.meta.settings);
    room.meta.notice = null;
    room.server = { deck: [] };
    beginTurn(room, 0, env);
    return touch(room, env);
  }

  function clueGiven(r, actor, _p, env) {
    const room = clone(r);
    requireMember(room, actor);
    if (room.game.state !== STATES.CLUE) throw new GameError('invalid-state', 'Not waiting for a clue.');
    if (room.game.psychicUid !== actor) throw new GameError('permission-denied', 'Only the Psychic can do that.');
    transition(room.game, STATES.GUESSING);
    return touch(room, env);
  }

  function submitGuess(r, actor, { guess }, env) {
    const room = clone(r);
    requireMember(room, actor);
    const g = room.game;
    if (g.state !== STATES.GUESSING) throw new GameError('invalid-state', 'No guess is expected right now (already submitted?).');
    if (g.guesserUid !== actor) throw new GameError('permission-denied', 'Only the active Guesser can submit.');
    const gv = Number(guess);
    if (typeof guess === 'boolean' || guess === null || !Number.isFinite(gv) || gv < SPECTRUM.MIN || gv > SPECTRUM.MAX)
      throw new GameError('invalid-argument', 'Guess must be a number from 0 to 100.');
    const value = Math.round(gv * 10) / 10;
    const target = room.server.target;
    const points = scoreGuess(target, value);
    g.scores = arr(g.scores).slice();
    g.scores[g.activeTeam] += points;
    g.result = { target, guess: value, points };
    g.winnerTeam = determineWinner(g.scores, room.meta.settings.targetScore, g.activeTeam);
    transition(g, STATES.REVEAL);
    room.secret = {};
    room.server = { deck: arr(room.server.deck) };
    return touch(room, env);
  }

  function nextTurn(r, actor, _p, env) {
    const room = clone(r);
    requireMember(room, actor);
    const g = room.game;
    if (g.state !== STATES.REVEAL) throw new GameError('invalid-state', 'The turn is not finished yet.');
    const onActiveTeam = room.players[actor].team === g.activeTeam;
    if (room.meta.hostUid !== actor && !onActiveTeam)
      throw new GameError('permission-denied', 'Only the host or the active team can advance.');
    if (g.winnerTeam != null) {
      transition(g, STATES.FINISHED);
    } else {
      beginTurn(room, (g.activeTeam + 1) % room.meta.settings.teamCount, env);
    }
    return touch(room, env);
  }

  function resetToLobby(room, notice) {
    room.game = emptyGame(room.meta.settings);
    room.secret = {};
    room.server = { deck: [] };
    room.meta.notice = notice || null;
  }

  function playAgain(r, actor, _p, env) {
    const room = clone(r);
    requireMember(room, actor);
    requireHost(room, actor);
    if (room.game.state !== STATES.FINISHED) throw new GameError('invalid-state', 'The game is not over.');
    resetToLobby(room, null);
    return touch(room, env);
  }

  /** Leave (target === actor) or host removal. Returns null if the room becomes empty. */
  function removePlayer(r, actor, { targetUid }, env) {
    const room = clone(r);
    requireMember(room, actor);
    const target = targetUid || actor;
    if (target !== actor) {
      requireHost(room, actor);
      if (target === room.meta.hostUid) throw new GameError('invalid-argument', 'The host cannot be removed.');
    }
    requireMember(room, target);
    const name = room.players[target].name;
    const inGame = [STATES.CLUE, STATES.GUESSING, STATES.REVEAL].includes(room.game.state);
    delete room.players[target];
    if (Object.keys(room.players).length === 0) return null;
    if (room.meta.hostUid === target) {
      room.meta.hostUid = Object.entries(room.players).sort((a, b) => a[1].joinedAt - b[1].joinedAt)[0][0];
    }
    if (inGame) resetToLobby(room, `${name} left, so the game returned to the lobby.`);
    else if (room.game.state === STATES.FINISHED) { /* keep final screen; host can play again */ }
    return touch(room, env);
  }

  /** Any member may take over hosting if the host is offline (env.hostOnline is read from presence by trusted code). */
  function claimHost(r, actor, _p, env) {
    const room = clone(r);
    requireMember(room, actor);
    if (room.meta.hostUid === actor) return room;
    if (env.hostOnline) throw new GameError('invalid-state', 'The host is still connected.');
    room.meta.hostUid = actor;
    return touch(room, env);
  }

  const reducers = { joinRoom, setTeam, updateSettings, startGame, clueGiven, submitGuess, nextTurn, playAgain, removePlayer, claimHost };

  return {
    GameError, arr, cleanText, scoreGuess, scoringBands, parsePrompts, promptPool, drawPrompt, shuffledIndices,
    generateRoomCode, normalizeRoomCode, isValidRoomCode, teamMembers, lobbyReadiness, canTransition, transition,
    determineWinner, sanitizeSettings, createRoom, emptyGame, reducers,
  };
});
