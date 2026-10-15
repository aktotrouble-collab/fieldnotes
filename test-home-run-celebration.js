// Run: node test-home-run-celebration.js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const E = require('./game-engine.js');
const html = fs.readFileSync(path.join(__dirname, 'game.html'), 'utf8');
const elements = new Map(), timers = new Map();
let timerId = 0;
function $(id) {
  if (!elements.has(id)) {
    const classes = new Set();
    elements.set(id, {
      hidden: true, textContent: '', classList: {
        add: c => classes.add(c), remove: c => classes.delete(c), contains: c => classes.has(c)
      }
    });
  }
  return elements.get(id);
}
const c = vm.createContext({
  $, E, preRoll: () => 0.7,
  setTimeout: (fn, delay) => { const id = ++timerId; timers.set(id, { fn, delay }); return id; },
  clearTimeout: id => timers.delete(id)
});
vm.runInContext(html.slice(html.indexOf('    let hrTimer ='), html.indexOf('    // Plays back every plate appearance')), c);
const run = code => vm.runInContext(code, c);
const ball = { hr: true, ev: 112.37, la: 29.84, touch: { d: 437.6 }, pts: [{ t: 0 }, { t: 3.1 }, { t: 3.2 }], wallHit: 1 };
c.ball = ball;
c.snap = { batter: 'Elly De La Cruz' };
run('celebrateHomeRun(ball, {}, snap, {mph:92})');
assert.equal($('hr-celebration').hidden, true, 'No spoiler before the ball clears the fence');
assert.equal(timers.size, 1);
let scheduled = [...timers.values()][0];
assert.equal(scheduled.delay, 3800, 'Celebration starts at fence crossing plus pitch pre-roll');
timers.clear();
scheduled.fn();
assert.equal($('hr-celebration').hidden, false);
assert($('hr-celebration').classList.contains('hr-active'));
assert.equal($('hr-batter').textContent, 'Elly De La Cruz');
assert.equal($('hr-ev').textContent, '112.4');
assert.equal($('hr-la').textContent, '29.8');
assert.equal($('hr-distance').textContent, '438', 'Uses full projected distance, not fence distance');
assert.equal($('hr-tag').textContent, 'Over the wall');
assert.equal($('pitch-result').textContent, '', 'Never writes HR text onto the strike zone');
scheduled = [...timers.values()][0];
assert.equal(scheduled.delay, 6200);
scheduled.fn();
assert($('hr-celebration').hidden, 'Automatically clears after readable celebration');
assert.equal(timers.size, 0);
run('celebrateHomeRun({...ball,pole:true}, {}, snap, {})');
[...timers.values()][0].fn();
assert.equal($('hr-tag').textContent, 'Off the pole');
run('celebrateHomeRun({...ball,hr:false}, {}, snap, {})');
assert($('hr-celebration').hidden, 'Non-HR play clears earlier celebration');
assert.equal(timers.size, 0, 'No animation or scheduled celebration for other hits');
run('celebrateHomeRun(ball, {}, snap, {});clearHomeRun()');
assert.equal(timers.size, 0, 'Skipping or changing plays cancels pending celebration');
run('celebrateHomeRun(ball, {}, snap, {});celebrateHomeRun(ball, {}, snap, {})');
assert.equal(timers.size, 1, 'Consecutive homers restart instead of overlapping timers');
const playBall = html.slice(html.indexOf('    function playBall('), html.indexOf('    // Seconds from release'));
assert.match(playBall, /celebrateHomeRun\(ball, play, snap, pitch\)/, 'One shared hookup covers manual, pending contact, simulation and replay');
assert.equal(html.split('celebrateHomeRun(ball, play, snap, pitch);').length, 2, 'No duplicate calls from clip/reveal paths');
assert(!html.includes('hrPopup('));
assert(!html.includes('"HOME RUN!"'));
assert.match(html, /@media \(prefers-reduced-motion:reduce\)/, 'Reduced-motion preference is respected');
assert.match(html, /id="hr-celebration" hidden role="status" aria-live="polite"/, 'Stats are available to assistive technology');
assert.match(html, /#hr-celebration \{[^}]*pointer-events:none/, 'Graphic never blocks the field controls');
console.log('Passed: HR-only animation, fence-crossing timing, EV/LA/distance, pole variants, replay/manual/sim hookup, cleanup, reduced motion and no strike-zone popup.');
