const S = require('../shared/game-logic.js');
const rules = require('../database.rules.json');
const { Database } = require('./rules-engine.js');

const mkRng = (seed = 1) => () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };

/** Simulates several browsers talking to the database; every write goes through the real rules file. */
class Sim {
  constructor(code = 'ABCDE') {
    this.db = new Database(rules);
    this.code = code;
    this.rng = mkRng(11);
  }
  env(extra) { this.db.now += 1000; return { now: this.db.now, rng: this.rng, hostOnline: true, ...extra }; }
  sub(updates) {
    return Object.fromEntries(Object.entries(updates).map(([k, v]) => [k.replace('{code}', this.code), v]));
  }
  /** What `uid`'s browser would see (children it is not allowed to read come back undefined). */
  view(uid) {
    const g = (p) => this.db.read(uid, `wavelengthRooms/${this.code}/${p}`).value;
    const room = { meta: g('meta'), players: g('players'), teams: g('teams'), game: g('game'), used: S.arr(g('used')), secret: g('secret'), lock: g('lock') };
    return room;
  }
  create(uid, name = 'Host', settings = {}) {
    const room = S.createRoom(uid, name, settings, this.env());
    return this.db.update(uid, { [`wavelengthRooms/${this.code}`]: room });
  }
  /** Plans with the client logic, then submits through the rules. Throws GameError from the planner; returns the rules verdict. */
  act(uid, action, payload = {}, extraEnv) {
    const room = action === 'joinRoom' ? null : this.view(uid);
    const { updates } = S.planners[action](room, uid, payload, this.env(extraEnv));
    return this.db.update(uid, this.sub(updates));
  }
  join(uid, name) {
    const exists = !!(this.db.read(uid, `wavelengthRooms/${this.code}/players/${uid}`).value);
    return this.act(uid, 'joinRoom', { name, exists });
  }
  raw(uid, updates) { return this.db.update(uid, this.sub(updates)); }
  get(path) { return this.db.read('__admin__', path); }
  data(path) { return path.split('/').filter(Boolean).reduce((o, k) => (o ? o[k] : undefined), this.db.data); }
  /** 4 players: p0,p1 on team 0; p2,p3 on team 1; p0 is host. */
  lobby4(settings = {}) {
    this.create('p0', 'Host', { teamCount: 2, ...settings });
    for (let i = 1; i < 4; i++) this.join('p' + i, 'P' + i);
    for (let i = 0; i < 4; i++) this.act('p' + i, 'setTeam', { team: Math.floor(i / 2) });
    return this;
  }
  game() { return this.data(`wavelengthRooms/${this.code}/game`); }
  /** Plays one complete turn; `guess` is relative to the target (offset) */
  playTurn(offset = 0) {
    const g = this.game();
    const others = ['p0', 'p1', 'p2', 'p3'].filter((u) => u !== g.guesserUid && u !== g.psychicUid);
    this.act(g.psychicUid, 'writeTarget');
    const t = this.data(`wavelengthRooms/${this.code}/secret/target`);
    this.act(g.psychicUid, 'clueGiven');
    const guess = Math.min(100, Math.max(0, t + offset));
    this.act(g.guesserUid, 'lockGuess', { guess });
    this.act(others[0] || g.psychicUid, 'reveal');
    return this.game();
  }
}
module.exports = { Sim, mkRng };
