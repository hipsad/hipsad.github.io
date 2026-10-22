import { h, replace } from './dom.js';
import { LIMITS, parsePrompts } from './shared.js';

const MODES = [
  ['builtin', 'Built-in prompts'],
  ['custom', 'Custom prompts only'],
  ['mixed', 'Mixed (built-in + custom)'],
];

/** Room settings form (used when creating a room and by the host in the lobby). */
export function settingsForm(initial = {}, { submitLabel, onSubmit }) {
  const teamCount = h('select', { id: 'f-teams' },
    Array.from({ length: LIMITS.MAX_TEAMS - LIMITS.MIN_TEAMS + 1 }, (_, i) => h('option', { value: LIMITS.MIN_TEAMS + i }, `${LIMITS.MIN_TEAMS + i} team${LIMITS.MIN_TEAMS + i === 1 ? "" : "s"}`)));
  const target = h('input', { id: 'f-target', type: 'number', min: LIMITS.MIN_TARGET_SCORE, max: LIMITS.MAX_TARGET_SCORE, inputmode: 'numeric' });
  const gameMode = h('select', { id: 'f-gamemode' }, h('option', { value: 'versus' }, 'Teams (versus)'), h('option', { value: 'coop' }, 'Shared clue, individual scores'));
  const mode = h('select', { id: 'f-mode' }, MODES.map(([v, l]) => h('option', { value: v }, l)));
  const teamLabel = h('label', { class: 'field' }, 'Teams (2 players each)', teamCount);
  const names = h('div', { class: 'team-names' });
  const text = h('textarea', {
    id: 'f-custom', rows: 5, spellcheck: 'false', placeholder: '(Expensive, Cheap)\n(Hot, Cold)\n(Great Movie, Terrible Movie)',
  });
  const customWrap = h('div', { class: 'field' },
    h('label', { for: 'f-custom' }, 'Custom prompts — one "(higher, lower)" pair per line'),
    text, h('div', { class: 'preview', 'aria-live': 'polite' }));
  const preview = customWrap.querySelector('.preview');
  const err = h('p', { class: 'form-error', role: 'alert' });
  const submit = h('button', { class: 'btn primary', type: 'submit' }, submitLabel);
  let dirty = false;
  const nameValues = [];

  function renderNames() {
    const n = gameMode.value === 'coop' ? 0 : Number(teamCount.value);
    names.querySelectorAll('input').forEach((el, i) => { nameValues[i] = el.value; });
    replace(names, Array.from({ length: n }, (_, i) => h('label', { class: 'field small' }, `Team ${i + 1} name`,
      h('input', {
        type: 'text', maxlength: LIMITS.MAX_TEAM_NAME_LENGTH, placeholder: `Team ${i + 1}`, value: nameValues[i] || '',
        oninput: (e) => { nameValues[i] = e.target.value; dirty = true; },
      }))));
  }
  function renderPreview() {
    const m = mode.value;
    customWrap.hidden = m === 'builtin';
    if (m === 'builtin') return;
    const { prompts, errors } = parsePrompts(text.value);
    replace(preview,
      errors.length ? h('ul', { class: 'errors' }, errors.slice(0, 6).map((e) => h('li', {}, e.line ? `Line ${e.line}: ${e.message}` : e.message))) : null,
      prompts.length ? h('details', { open: prompts.length <= 6 },
        h('summary', {}, `${prompts.length} valid prompt${prompts.length === 1 ? '' : 's'}`),
        h('ul', { class: 'prompt-preview' }, prompts.slice(0, 50).map((p) => h('li', {}, `${p.low} ◀ ▶ ${p.high}`)))) : h('p', { class: 'muted' }, 'No valid prompts yet.'));
  }
  function setValues(s) {
    gameMode.value = s.gameMode || 'versus';
    teamLabel.hidden = gameMode.value === 'coop';
    teamCount.value = String(gameMode.value === 'coop' ? LIMITS.DEFAULT_TEAMS : s.teamCount || LIMITS.DEFAULT_TEAMS);
    target.value = String(s.targetScore || LIMITS.DEFAULT_TARGET_SCORE);
    mode.value = s.promptMode || 'builtin';
    text.value = s.customPromptsText || '';
    (s.teamNames || []).forEach((n, i) => { nameValues[i] = /^Team \d+$/.test(n) ? '' : n; });
    renderNames(); renderPreview(); dirty = false;
  }
  teamCount.addEventListener('change', () => { dirty = true; renderNames(); });
  gameMode.addEventListener('change', () => { dirty = true; teamLabel.hidden = gameMode.value === 'coop'; renderNames(); });
  mode.addEventListener('change', () => { dirty = true; renderPreview(); });
  target.addEventListener('input', () => { dirty = true; });
  text.addEventListener('input', () => { dirty = true; renderPreview(); });

  const getValues = () => ({
    gameMode: gameMode.value,
    teamCount: Number(teamCount.value),
    targetScore: Number(target.value),
    promptMode: mode.value,
    customPromptsText: mode.value === 'builtin' && !text.value.trim() ? '' : text.value,
    teamNames: Array.from(names.querySelectorAll('input')).map((i) => i.value),
  });
  const el = h('form', {
    class: 'settings-form', novalidate: true,
    onsubmit: (e) => {
      e.preventDefault();
      const v = getValues();
      const { errors } = parsePrompts(v.customPromptsText);
      if (!Number.isInteger(v.targetScore) || v.targetScore < LIMITS.MIN_TARGET_SCORE || v.targetScore > LIMITS.MAX_TARGET_SCORE) err.textContent = `Target score must be a whole number from ${LIMITS.MIN_TARGET_SCORE} to ${LIMITS.MAX_TARGET_SCORE}.`;
      else if (errors.length) err.textContent = 'Fix the custom prompt errors first.';
      else if (v.promptMode !== 'builtin' && parsePrompts(v.customPromptsText).prompts.length === 0) err.textContent = 'Add at least one custom prompt or use built-in prompts.';
      else { err.textContent = ''; onSubmit(v); }
    },
  },
  h('label', { class: 'field' }, 'Game mode', gameMode),
  h('div', { class: 'grid2' },
    teamLabel,
    h('label', { class: 'field' }, 'Target score', target)),
  names,
  h('label', { class: 'field' }, 'Prompt mode', mode),
  customWrap, err, submit);
  setValues(initial);
  return {
    el, getValues, setValues,
    isDirty: () => dirty,
    setBusy: (b) => { submit.disabled = b; },
  };
}
