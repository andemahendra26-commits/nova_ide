/**
 * The Nova mascot — a rigged pixel character.
 *
 * Built as a parts-based SVG rather than a sprite sheet so each piece (pupils,
 * brows, mouth, each arm, each leg, props) animates independently. That is what
 * lets it *act* rather than loop: it reads with its eyes tracking a line, thinks
 * with a hand at its chin, types with alternating hands on a keyboard.
 *
 * Layer order matters and is easy to get wrong: props render AFTER the body so
 * the character is holding them in front of itself. Behind the body they are
 * occluded and every working pose collapses into "standing there".
 *
 * Props also stay below y=13 so they never cover the face — the expression is
 * the point, and an object over the eyes kills it.
 */

const P = 4;
const W = 32;
const H = 26;

function r(x, y, w, h, cls = 'mc-fill') {
  return `<rect x="${x * P}" y="${y * P}" width="${w * P}" height="${h * P}" class="${cls}"/>`;
}

export function mascotSvg(scale = 1) {
  return `
<svg class="mascot" viewBox="0 0 ${W * P} ${H * P}" width="${W * P * scale}" height="${H * P * scale}"
     shape-rendering="crispEdges" aria-hidden="true">

  <g class="mc-root">

    <!-- ══ the character ══ -->
    <g class="mc-body">

      <g class="mc-torso">
        ${r(8, 3, 16, 13)}

        <!-- antenna: a small tell that perks up when alert -->
        <g class="mc-antenna">
          ${r(15, 1, 2, 2)}
          ${r(15, 0, 2, 1, 'mc-accent2')}
        </g>

        <g class="mc-face">
          <g class="mc-brows">
            <g class="mc-brow mc-brow-l">${r(10, 5, 4, 1, 'mc-ink')}</g>
            <g class="mc-brow mc-brow-r">${r(18, 5, 4, 1, 'mc-ink')}</g>
          </g>

          <g class="mc-eyes">
            <g class="mc-eye-l">
              ${r(10, 7, 4, 4, 'mc-eye-white')}
              <g class="mc-pupil mc-pupil-l">${r(11, 8, 2, 2, 'mc-ink')}</g>
            </g>
            <g class="mc-eye-r">
              ${r(18, 7, 4, 4, 'mc-eye-white')}
              <g class="mc-pupil mc-pupil-r">${r(19, 8, 2, 2, 'mc-ink')}</g>
            </g>
            <g class="mc-eyes-happy">
              ${r(10, 9, 1, 1, 'mc-ink')}${r(11, 8, 2, 1, 'mc-ink')}${r(13, 9, 1, 1, 'mc-ink')}
              ${r(18, 9, 1, 1, 'mc-ink')}${r(19, 8, 2, 1, 'mc-ink')}${r(21, 9, 1, 1, 'mc-ink')}
            </g>
          </g>

          <g class="mc-mouth">
            <g class="mc-mouth-flat">${r(14, 13, 4, 1, 'mc-ink')}</g>
            <g class="mc-mouth-smile">
              ${r(13, 12, 1, 1, 'mc-ink')}${r(14, 13, 4, 1, 'mc-ink')}${r(18, 12, 1, 1, 'mc-ink')}
            </g>
            <g class="mc-mouth-o">${r(15, 12, 2, 2, 'mc-ink')}</g>
            <g class="mc-mouth-wavy">
              ${r(13, 13, 1, 1, 'mc-ink')}${r(14, 12, 1, 1, 'mc-ink')}
              ${r(15, 13, 1, 1, 'mc-ink')}${r(16, 12, 1, 1, 'mc-ink')}${r(17, 13, 1, 1, 'mc-ink')}
            </g>
          </g>
        </g>
      </g>

      <g class="mc-legs">
        <g class="mc-leg mc-leg-1">${r(10, 16, 2, 4)}</g>
        <g class="mc-leg mc-leg-2">${r(13, 16, 2, 4)}</g>
        <g class="mc-leg mc-leg-3">${r(17, 16, 2, 4)}</g>
        <g class="mc-leg mc-leg-4">${r(20, 16, 2, 4)}</g>
      </g>
    </g>

    <!-- props sit above the body but below the arms, so the hands read as
         holding them rather than being swallowed by them -->
    <g class="mc-props">

      <!-- OPEN BOOK — understanding/reading -->
      <g class="mc-prop mc-book">
        ${r(5, 14, 22, 1, 'mc-prop-edge')}
        ${r(5, 15, 10, 7, 'mc-prop-page')}
        ${r(17, 15, 10, 7, 'mc-prop-page')}
        ${r(15, 14, 2, 8, 'mc-prop-edge')}
        ${r(5, 22, 22, 1, 'mc-prop-edge')}
        <g class="mc-book-lines">
          ${r(7, 17, 6, 1, 'mc-prop-ink')}
          ${r(7, 19, 5, 1, 'mc-prop-ink')}
          ${r(19, 17, 6, 1, 'mc-prop-ink')}
          ${r(19, 19, 4, 1, 'mc-prop-ink')}
        </g>
        <g class="mc-read-line">${r(7, 17, 6, 1, 'mc-prop-read')}</g>
      </g>

      <!-- CLIPBOARD — planning -->
      <g class="mc-prop mc-clip">
        ${r(9, 13, 14, 1, 'mc-prop-edge')}
        ${r(14, 12, 4, 2, 'mc-prop-clip')}
        ${r(9, 14, 14, 9, 'mc-prop-page')}
        ${r(9, 23, 14, 1, 'mc-prop-edge')}
        <!-- Rows live in the top half: the arms occupy the lower half while
             writing, and a checklist nobody can see defeats the pose. -->
        <g class="mc-plan-rows">
          <g class="mc-tk-1">${r(11, 15, 2, 2, 'mc-prop-tick')}</g>
          ${r(14, 15, 7, 1, 'mc-prop-ink')}
          <g class="mc-tk-2">${r(11, 18, 2, 2, 'mc-prop-tick')}</g>
          ${r(14, 18, 6, 1, 'mc-prop-ink')}
          ${r(11, 21, 2, 1, 'mc-prop-ink')}
          ${r(14, 21, 5, 1, 'mc-prop-ink')}
        </g>
      </g>

      <!-- KEYBOARD + floating code — writing -->
      <g class="mc-prop mc-laptop">
        ${r(4, 17, 24, 5, 'mc-prop-screen')}
        ${r(5, 18, 22, 3, 'mc-prop-keys')}
        <g class="mc-keycaps">
          ${r(6, 19, 2, 1, 'mc-prop-cap mc-kc-1')}
          ${r(9, 19, 2, 1, 'mc-prop-cap mc-kc-2')}
          ${r(12, 19, 3, 1, 'mc-prop-cap mc-kc-3')}
          ${r(16, 19, 2, 1, 'mc-prop-cap mc-kc-4')}
          ${r(19, 19, 3, 1, 'mc-prop-cap mc-kc-1')}
          ${r(23, 19, 2, 1, 'mc-prop-cap mc-kc-2')}
        </g>
        ${r(4, 22, 24, 1, 'mc-prop-edge')}
      </g>

      <!-- MAGNIFIER — reviewing. Held clear of the face, up and to the side. -->
      <g class="mc-prop mc-glass">
        <g class="mc-glass-head">
          ${r(23, 0, 7, 1, 'mc-prop-edge')}
          ${r(22, 1, 1, 6, 'mc-prop-edge')}
          ${r(30, 1, 1, 6, 'mc-prop-edge')}
          ${r(23, 7, 7, 1, 'mc-prop-edge')}
          ${r(23, 1, 7, 6, 'mc-prop-lens')}
          ${r(24, 2, 3, 1, 'mc-prop-shine')}
        </g>
        ${r(21, 8, 2, 2, 'mc-prop-edge')}
        ${r(20, 10, 2, 2, 'mc-prop-edge')}
      </g>
    </g>

    <!-- arms last: they must paint over both the torso and whatever is held -->
    <g class="mc-arms">
      <g class="mc-arm mc-arm-l">
        ${r(4, 9, 5, 3)}
        ${r(2, 9, 2, 3, 'mc-hand-fill')}
      </g>
      <g class="mc-arm mc-arm-r">
        ${r(23, 9, 5, 3)}
        ${r(28, 9, 2, 3, 'mc-hand-fill')}
      </g>
    </g>
  </g>

  <!-- ══ effects ══ -->
  <g class="mc-fx">
    <g class="mc-thought">
      ${r(24, 6, 2, 2, 'mc-accent2 mc-td-1')}
      ${r(26, 3, 3, 3, 'mc-accent2 mc-td-2')}
      ${r(28, 0, 4, 3, 'mc-accent2 mc-td-3')}
    </g>
    <g class="mc-codefx">
      ${r(26, 8, 5, 1, 'mc-accent2 mc-cf-1')}
      ${r(27, 11, 4, 1, 'mc-accent2 mc-cf-2')}
      ${r(26, 14, 6, 1, 'mc-accent2 mc-cf-3')}
    </g>
    <g class="mc-sweat">${r(23, 4, 2, 3, 'mc-drop')}</g>
    <g class="mc-sparks">
      ${r(3, 2, 2, 2, 'mc-accent2 mc-sp-1')}
      ${r(28, 6, 2, 2, 'mc-accent2 mc-sp-2')}
      ${r(26, 15, 2, 2, 'mc-accent2 mc-sp-3')}
    </g>
  </g>
</svg>`;
}

/** Phases where the eyes have a job and must not wander. */
const BUSY_GAZE = new Set(['understanding', 'writing', 'reviewing']);

export function mountMascot(container, { scale = 1 } = {}) {
  container.innerHTML = mascotSvg(scale);
  const svg = container.querySelector('.mascot');

  let blinkTimer = null;
  let glanceTimer = null;
  let phase = 'idle';

  const scheduleBlink = () => {
    blinkTimer = setTimeout(() => {
      svg.classList.add('blinking');
      setTimeout(() => svg.classList.remove('blinking'), 130);
      // Occasional double-blink, which is what real faces do.
      if (Math.random() < 0.22) {
        setTimeout(() => {
          svg.classList.add('blinking');
          setTimeout(() => svg.classList.remove('blinking'), 110);
        }, 230);
      }
      scheduleBlink();
    }, 1800 + Math.random() * 4200);
  };

  const scheduleGlance = () => {
    glanceTimer = setTimeout(() => {
      if (!BUSY_GAZE.has(phase)) {
        const dirs = ['left', 'right', 'up', 'center', 'center'];
        const dir = dirs[(Math.random() * dirs.length) | 0];
        svg.dataset.gaze = dir;
        setTimeout(() => {
          if (svg.dataset.gaze === dir) svg.dataset.gaze = 'center';
        }, 700 + Math.random() * 900);
      }
      scheduleGlance();
    }, 2400 + Math.random() * 3400);
  };

  scheduleBlink();
  scheduleGlance();
  svg.dataset.phase = 'idle';
  svg.dataset.gaze = 'center';

  return {
    el: svg,

    setPhase(next) {
      phase = next || 'idle';
      svg.dataset.phase = phase;
      svg.dataset.gaze =
        phase === 'thinking' || phase === 'planning' ? 'up'
          : BUSY_GAZE.has(phase) ? 'down'
            : 'center';
    },

    react(kind) {
      svg.classList.add(`react-${kind}`);
      setTimeout(() => svg.classList.remove(`react-${kind}`), 700);
    },

    destroy() {
      clearTimeout(blinkTimer);
      clearTimeout(glanceTimer);
      container.innerHTML = '';
    },
  };
}
