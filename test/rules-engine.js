/*
 * Minimal evaluator for Firebase Realtime Database security rules (the subset used in database.rules.json),
 * used to test the rules together with the client-side planners without needing the Firebase emulator.
 * Semantics follow the documented behaviour: any granting .write along the path allows the write, then
 * .validate must hold at the written node, its descendants and its ancestors; .read is any-granting.
 */
String.prototype.matches = function (re) { return re.test(String(this)); }; // rules-language String.matches

const clone = (x) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));
const split = (p) => String(p).split('/').filter(Boolean);
const walk = (tree, parts) => parts.reduce((o, k) => (o !== null && typeof o === 'object' ? o[k] : undefined), tree);

class Snap {
  constructor(tree, parts) { this.tree = tree; this.parts = parts; }
  get raw() { return walk(this.tree, this.parts); }
  child(p) { return new Snap(this.tree, [...this.parts, ...split(p)]); }
  parent() { return new Snap(this.tree, this.parts.slice(0, -1)); }
  val() { return this.raw; }
  exists() { return this.raw !== undefined && this.raw !== null; }
  hasChildren(list) {
    const r = this.raw;
    if (r === null || typeof r !== 'object') return false;
    return (list || Object.keys(r)).every((k) => r[k] !== undefined && r[k] !== null);
  }
  isString() { return typeof this.raw === 'string'; }
  isNumber() { return typeof this.raw === 'number'; }
  isBoolean() { return typeof this.raw === 'boolean'; }
}

function prune(o) {
  if (o === null || typeof o !== 'object') return o;
  for (const k of Object.keys(o)) {
    const v = prune(o[k]);
    if (v === null || v === undefined || (typeof v === 'object' && Object.keys(v).length === 0)) delete o[k];
  }
  return o;
}
function setPath(tree, parts, value) {
  let o = tree;
  parts.slice(0, -1).forEach((k) => { if (o[k] === null || typeof o[k] !== 'object') o[k] = {}; o = o[k]; });
  if (value === null || value === undefined) delete o[parts.at(-1)]; else o[parts.at(-1)] = clone(value);
}

function matchChild(node, key) {
  if (Object.prototype.hasOwnProperty.call(node, key) && !key.startsWith('.')) return { rule: node[key], vars: {} };
  const w = Object.keys(node).find((k) => k.startsWith('$') && k !== '$other');
  if (w) return { rule: node[w], vars: { [w]: key } };
  if (node.$other) return { rule: node.$other, vars: { $other: key } };
  return null;
}
const compiled = new Map();
function evalExpr(expr, ctx) {
  if (typeof expr === 'boolean') return expr;
  const names = Object.keys(ctx);
  const key = names.join(',') + '|' + expr;
  if (!compiled.has(key)) compiled.set(key, new Function(...names, `return (${expr});`));
  return !!compiled.get(key)(...Object.values(ctx));
}

class Database {
  constructor(rules, data = {}) { this.rules = rules.rules; this.data = data; this.now = 1700000000000; }
  ctx(uid, oldTree, newTree, parts, vars) {
    return {
      auth: uid ? { uid } : null, now: this.now,
      root: new Snap(oldTree, []), data: new Snap(oldTree, parts), newData: new Snap(newTree, parts), ...vars,
    };
  }
  /** Can `uid` read `path`? */
  canRead(uid, path) {
    const parts = split(path);
    let node = this.rules, vars = {};
    for (let i = 0; i <= parts.length; i++) {
      if (node['.read'] !== undefined && evalExpr(node['.read'], this.ctx(uid, this.data, this.data, parts.slice(0, i), vars))) return true;
      if (i === parts.length) break;
      const m = matchChild(node, parts[i]);
      if (!m) return false;
      node = m.rule; vars = { ...vars, ...m.vars };
    }
    return false;
  }
  read(uid, path) {
    if (!this.canRead(uid, path)) return { denied: true, value: undefined };
    return { denied: false, value: clone(walk(this.data, split(path))) };
  }
  validateNode(node, vars, uid, newTree, parts) {
    const snap = new Snap(newTree, parts);
    if (!snap.exists()) return true;
    if (node['.validate'] !== undefined && !evalExpr(node['.validate'], this.ctx(uid, this.data, newTree, parts, vars))) return false;
    const val = snap.raw;
    if (val !== null && typeof val === 'object') {
      for (const k of Object.keys(val)) {
        const m = matchChild(node, k);
        if (m && !this.validateNode(m.rule, { ...vars, ...m.vars }, uid, newTree, [...parts, k])) return false;
      }
    }
    return true;
  }
  /** Atomic multi-path update. Returns { ok, reason }. */
  update(uid, updates) {
    const next = clone(this.data);
    const paths = Object.keys(updates);
    for (const p of paths) setPath(next, split(p), updates[p]);
    prune(next);
    for (const p of paths) {
      const parts = split(p);
      let node = this.rules, vars = {}, granted = false;
      for (let i = 0; i <= parts.length && !granted; i++) {
        if (node['.write'] !== undefined && evalExpr(node['.write'], this.ctx(uid, this.data, next, parts.slice(0, i), vars))) granted = true;
        if (i === parts.length || granted) break;
        const m = matchChild(node, parts[i]);
        if (!m) break;
        node = m.rule; vars = { ...vars, ...m.vars };
      }
      if (!granted) return { ok: false, reason: `write denied at ${p}` };
      // validate: ancestors (existing), the node itself and descendants
      let n2 = this.rules, v2 = {};
      for (let i = 0; i < parts.length; i++) {
        const m = matchChild(n2, parts[i]);
        if (!m) { n2 = null; break; }
        n2 = m.rule; v2 = { ...v2, ...m.vars };
        const isLeaf = i === parts.length - 1;
        if (!isLeaf) {
          const snap = new Snap(next, parts.slice(0, i + 1));
          if (snap.exists() && n2['.validate'] !== undefined && !evalExpr(n2['.validate'], this.ctx(uid, this.data, next, parts.slice(0, i + 1), v2)))
            return { ok: false, reason: `validate failed at ancestor ${parts.slice(0, i + 1).join('/')}` };
        }
      }
      if (n2 && !this.validateNode(n2, v2, uid, next, parts)) return { ok: false, reason: `validate failed at ${p}` };
      if (!n2) {
        // unknown path (no rule node): blocked if a sibling $other: false exists
        let nn = this.rules;
        for (let i = 0; i < parts.length; i++) {
          const m = matchChild(nn, parts[i]);
          if (!m) return { ok: false, reason: `no rule for ${p}` };
          nn = m.rule;
        }
      }
    }
    this.data = next;
    return { ok: true };
  }
}
module.exports = { Database, clone };
