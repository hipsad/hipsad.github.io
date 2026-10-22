import { SCORING, SPECTRUM } from './shared.js';

const NS = 'http://www.w3.org/2000/svg';
const CX = 200, CY = 200, R = 170, R_IN = 70;

const svgEl = (tag, attrs = {}) => {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
};
// position 0 (left) .. 100 (right)  ->  angle 180deg .. 0deg
const angleOf = (pos) => Math.PI * (1 - (pos - SPECTRUM.MIN) / (SPECTRUM.MAX - SPECTRUM.MIN));
const pt = (r, pos) => [CX + r * Math.cos(angleOf(pos)), CY - r * Math.sin(angleOf(pos))];
const f = (n) => n.toFixed(2);

function sector(from, to, r1 = R_IN, r2 = R) {
  const [x1, y1] = pt(r2, from), [x2, y2] = pt(r2, to), [x3, y3] = pt(r1, to), [x4, y4] = pt(r1, from);
  return `M${f(x1)} ${f(y1)} A${r2} ${r2} 0 0 1 ${f(x2)} ${f(y2)} L${f(x3)} ${f(y3)} A${r1} ${r1} 0 0 0 ${f(x4)} ${f(y4)} Z`;
}

/**
 * Wavelength dial. Positions are on the 0..100 spectrum.
 *  setTarget(t|null)   show/hide scoring bands around target (hidden for the guesser until reveal)
 *  setGuess(p|null)    needle position (null = neutral)
 *  setInteractive(b)   whether this user can drag/keyboard-move the needle
 *  reveal(t, animate)  show target bands + marker with animation
 */
export function createDial({ onInput, onCommit, bandsFor }) {
  const svg = svgEl('svg', {
    viewBox: '0 0 400 235', class: 'dial', role: 'slider', tabindex: '-1',
    'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': '50', 'aria-label': 'Wavelength guess dial',
  });
  const track = svgEl('path', { d: sector(0, 100), class: 'dial-track' });
  const ticks = svgEl('g', { class: 'dial-ticks' });
  for (let p = 0; p <= 100; p += 10) {
    const [x1, y1] = pt(R + 2, p), [x2, y2] = pt(R + (p % 50 === 0 ? 14 : 8), p);
    ticks.appendChild(svgEl('line', { x1: f(x1), y1: f(y1), x2: f(x2), y2: f(y2) }));
  }
  const bandsG = svgEl('g', { class: 'dial-bands' });
  const targetMark = svgEl('line', { class: 'dial-target', visibility: 'hidden' });
  const guessG = svgEl('g', { class: 'dial-needle' });
  guessG.appendChild(svgEl('line', { x1: CX, y1: CY, x2: CX - R + 6, y2: CY, class: 'needle-line' }));
  guessG.appendChild(svgEl('circle', { cx: CX - R + 6, cy: CY, r: 7, class: 'needle-tip' }));
  const hub = svgEl('circle', { cx: CX, cy: CY, r: 16, class: 'dial-hub' });
  svg.append(track, ticks, bandsG, targetMark, guessG, hub);

  let guess = SPECTRUM.NEUTRAL, interactive = false, dragging = false, targetPos = null;

  const rotate = () => {
    // needle is drawn pointing left (0); rotating clockwise by up to 180deg sweeps it to the right end (100)
    const deg = (guess - SPECTRUM.MIN) / (SPECTRUM.MAX - SPECTRUM.MIN) * 180;
    guessG.style.transform = `rotate(${deg}deg)`;
    guessG.style.transformOrigin = `${CX}px ${CY}px`;
    svg.setAttribute('aria-valuenow', String(Math.round(guess)));
  };
  const setGuessInternal = (p) => { guess = Math.min(SPECTRUM.MAX, Math.max(SPECTRUM.MIN, p)); rotate(); };

  function posFromEvent(ev) {
    const m = svg.getScreenCTM();
    const p = svg.createSVGPoint();
    p.x = ev.clientX; p.y = ev.clientY;
    const local = p.matrixTransform(m.inverse());
    let a = Math.atan2(CY - local.y, local.x - CX); // 0..pi on the upper half
    if (a < 0) a = local.x < CX ? Math.PI : 0; // below the baseline: snap to nearest end
    return Math.round((1 - a / Math.PI) * SPECTRUM.MAX * 10) / 10;
  }

  svg.addEventListener('pointerdown', (ev) => {
    if (!interactive) return;
    dragging = true;
    svg.setPointerCapture(ev.pointerId);
    svg.classList.add('dragging');
    setGuessInternal(posFromEvent(ev));
    onInput && onInput(guess);
    ev.preventDefault();
  });
  svg.addEventListener('pointermove', (ev) => {
    if (!dragging) return;
    setGuessInternal(posFromEvent(ev));
    onInput && onInput(guess);
    ev.preventDefault();
  });
  const end = () => {
    if (!dragging) return;
    dragging = false;
    svg.classList.remove('dragging');
    onCommit && onCommit(guess);
  };
  svg.addEventListener('pointerup', end);
  svg.addEventListener('pointercancel', end);
  svg.addEventListener('keydown', (ev) => {
    if (!interactive) return;
    const step = ev.shiftKey ? 5 : 1;
    const d = { ArrowLeft: -step, ArrowDown: -step, ArrowRight: step, ArrowUp: step, PageDown: -10, PageUp: 10 }[ev.key];
    if (ev.key === 'Home') setGuessInternal(0);
    else if (ev.key === 'End') setGuessInternal(100);
    else if (d !== undefined) setGuessInternal(Math.round((guess + d) * 10) / 10);
    else return;
    ev.preventDefault();
    onInput && onInput(guess);
    onCommit && onCommit(guess);
  });

  function drawBands(t, animate) {
    clear(bandsG);
    if (t == null) { targetMark.setAttribute('visibility', 'hidden'); return; }
    for (const b of bandsFor(t)) {
      bandsG.appendChild(svgEl('path', {
        d: sector(b.from, b.to), class: `band band-${b.points === SCORING.BULLSEYE_POINTS ? 'bullseye' : b.points === SCORING.CENTER_POINTS ? 'center' : 'side'}`,
      }));
      const mid = (b.from + b.to) / 2;
      if (b.to - b.from >= (b.points === SCORING.BULLSEYE_POINTS ? 1.5 : 4)) {
        const [x, y] = pt((R + R_IN) / 2, mid);
        const label = svgEl('text', { x: f(x), y: f(y + 5), class: 'band-label', 'text-anchor': 'middle' });
        label.textContent = String(b.points);
        bandsG.appendChild(label);
      }
    }
    const [x1, y1] = pt(R_IN - 6, t), [x2, y2] = pt(R + 12, t);
    targetMark.setAttribute('x1', f(x1)); targetMark.setAttribute('y1', f(y1));
    targetMark.setAttribute('x2', f(x2)); targetMark.setAttribute('y2', f(y2));
    targetMark.setAttribute('visibility', 'visible');
    bandsG.classList.remove('reveal-anim'); targetMark.classList.remove('reveal-anim');
    if (animate) { void svg.getBoundingClientRect(); bandsG.classList.add('reveal-anim'); targetMark.classList.add('reveal-anim'); }
  }
  function clear(n) { while (n.firstChild) n.removeChild(n.firstChild); }

  rotate();
  return {
    el: svg,
    setTarget(t, animate = false) { if (t !== targetPos) { targetPos = t; drawBands(t, animate); } },
    setGuess(p) { if (!dragging) setGuessInternal(p == null ? SPECTRUM.NEUTRAL : p); },
    getGuess: () => guess,
    setInteractive(b) {
      interactive = b;
      svg.classList.toggle('interactive', b);
      svg.setAttribute('tabindex', b ? '0' : '-1');
      svg.setAttribute('aria-readonly', String(!b));
    },
    setAccent(color) { svg.style.setProperty('--accent', color); },
  };
}
