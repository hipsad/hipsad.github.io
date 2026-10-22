/* Central game constants. UMD: usable in the browser (window.WavelengthShared) and Node. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.WavelengthShared = Object.assign(root.WavelengthShared || {}, api);
})(typeof self !== 'undefined' ? self : this, function () {
  const SCORING = Object.freeze({
    BULLSEYE_RADIUS: 1, // |guess - target| <= 1 -> BULLSEYE_POINTS
    BULLSEYE_POINTS: 3,
    CENTER_RADIUS: 5, // 1 < |guess - target| <= 5  -> CENTER_POINTS
    SIDE_RADIUS: 15, // 5 < |guess - target| <= 15 -> SIDE_POINTS
    CENTER_POINTS: 2,
    SIDE_POINTS: 1,
  });
  const SPECTRUM = Object.freeze({ MIN: 0, MAX: 100, NEUTRAL: 50 });
  const LIMITS = Object.freeze({
    MIN_TEAMS: 1,
    MAX_TEAMS: 4,
    PLAYERS_PER_TEAM: 2,
    DEFAULT_TEAMS: 2,
    DEFAULT_TARGET_SCORE: 10,
    MIN_COOP_PLAYERS: 2,
    COOP_PENALTY: 1, // the Psychic costs the team this many points when nobody scores
    MIN_TARGET_SCORE: 1,
    MAX_TARGET_SCORE: 100,
    MAX_NAME_LENGTH: 20,
    MAX_TEAM_NAME_LENGTH: 20,
    MAX_PROMPT_LENGTH: 40,
    MAX_CUSTOM_PROMPTS: 200,
    ROOM_CODE_LENGTH: 5,
    ROOM_TTL_MS: 24 * 60 * 60 * 1000,
  });
  const ROOM_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O/1/I/L
  const STATES = Object.freeze({
    LOBBY: 'lobby',
    CLUE: 'clue',
    GUESSING: 'guessing',
    REVEAL: 'reveal',
    FINISHED: 'finished',
  });
  const TRANSITIONS = Object.freeze({
    lobby: ['clue'],
    clue: ['guessing', 'lobby'],
    guessing: ['reveal', 'lobby'],
    reveal: ['clue', 'finished', 'lobby'],
    finished: ['lobby'],
  });
  const GAME_MODES = Object.freeze(['versus', 'coop']);
  const PROMPT_MODES = Object.freeze(['builtin', 'custom', 'mixed']);
  const TEAM_COLORS = Object.freeze(['#ff6b8b', '#4cc9f0', '#ffd166', '#7bd88f']);
  return { SCORING, SPECTRUM, LIMITS, ROOM_CODE_ALPHABET, STATES, TRANSITIONS, PROMPT_MODES, GAME_MODES, TEAM_COLORS };
});
