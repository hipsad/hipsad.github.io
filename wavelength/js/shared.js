// The shared (UMD) game rules are loaded with plain <script> tags before this module.
const S = window.WavelengthShared;
if (!S) throw new Error('Shared game logic failed to load');
export const { SCORING, SPECTRUM, LIMITS, STATES, TEAM_COLORS, BUILTIN_PROMPTS, scoringBands, parsePrompts, lobbyReadiness, normalizeRoomCode, isValidRoomCode, arr } = S;
