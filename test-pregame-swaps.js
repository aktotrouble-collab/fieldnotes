// Run: node test-pregame-swaps.js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const E = require('./game-engine.js');
const html = fs.readFileSync(path.join(__dirname, 'game.html'), 'utf8');
const source = html.slice(html.indexOf('    function swapBenchStarter('), html.indexOf('    /* Real MLB players'));
const listeners = new Map(), windowListeners = new Map();
const classes = () => {
  const set = new Set();
  return { add: (s) => set.add(s), remove: (s) => set.delete(s), contains: (s) => set.has(s) };
};
const lineupBody = {}, otherBody = {};
const row = { classList: classes() };
const target = { dataset: { i: '2' }, parentElement: lineupBody, classList: classes() };
const foreign = { dataset: { i: '0' }, parentElement: otherBody, classList: classes() };
let hit = target, saves = 0, renders = 0;
const team = E.generateTeam('Test', 'balanced', 1);
const context = vm.createContext({
  document: {
    elementFromPoint: () => hit && { closest: () => hit },
    addEventListener: (type, callback) => listeners.set(type, callback),
    removeEventListener: (type) => listeners.delete(type)
  },
  window: {
    addEventListener: (type, callback) => windowListeners.set(type, callback),
    removeEventListener: (type) => windowListeners.delete(type)
  },
  saveTeams: () => saves++, renderTeams: () => renders++,
  team, row, lineupBody
});
vm.runInContext(source, context);
const start = () => context.startBenchDrag({ button: 0, pointerId: 7, preventDefault() {} }, row, lineupBody, team, 0);
const event = (type, pointerId = 7) => ({ type, pointerId, clientX: 100, clientY: 100 });
const starter = team.lineup[2], substitute = team.bench[0], position = starter.pos;
Object.defineProperty(substitute, '_orig', { value: { pos: substitute.pos, height: 72 }, enumerable: false });
const lineupCount = team.lineup.length, benchCount = team.bench.length;
start();
listeners.get('pointermove')(event('pointermove'));
assert(target.classList.contains('bench-drop'));
listeners.get('pointerup')(event('pointerup', 8));
assert.equal(team.lineup[2], starter, 'Unrelated pointers cannot complete a drag');
listeners.get('pointerup')(event('pointerup'));
assert.equal(team.lineup[2], substitute);
assert.equal(team.bench[0], starter);
assert.equal(substitute.pos, position, 'Incoming player takes exact defensive slot');
assert.equal(substitute._orig.pos, position, 'Saved/session-reset player retains the assigned lineup position');
assert.equal(substitute.natural, 'C', 'Natural eligibility is retained');
assert.equal(team.lineup.length, lineupCount);
assert.equal(team.bench.length, benchCount);
assert.equal(new Set([...team.lineup, ...team.bench]).size, lineupCount + benchCount);
assert.equal(saves, 1);
assert.equal(renders, 1);
assert.equal(listeners.size, 0);
assert.equal(windowListeners.size, 0);
assert(!row.classList.contains('dragging') && !target.classList.contains('bench-drop'));
assert.deepEqual(E.validateTeam(team), [], 'Roster positions remain valid');
for (const finish of ['pointercancel', 'blur', 'outside', 'foreign']) {
  hit = target;
  start();
  listeners.get('pointermove')(event('pointermove'));
  if (finish === 'blur') windowListeners.get('blur')({ type: 'blur' });
  else {
    hit = finish === 'foreign' ? foreign : finish === 'outside' ? null : target;
    listeners.get(finish === 'pointercancel' ? 'pointercancel' : 'pointerup')(event(finish === 'pointercancel' ? 'pointercancel' : 'pointerup'));
  }
  assert.equal(team.lineup[2], substitute, `${finish} does not swap`);
  assert.equal(saves, 1);
  assert.equal(listeners.size, 0);
  assert(!row.classList.contains('dragging') && !target.classList.contains('bench-drop'));
}
hit = target;
start();
listeners.get('pointerup')(event('pointerup'));
assert.equal(team.lineup[2], starter, 'Players can be swapped back');
assert.equal(team.bench[0], substitute);
assert.equal(starter.pos, position);
assert.equal(substitute.height, 72);
assert.equal(substitute.weight, 200);
console.log('Passed: bench/starter swaps, batting and field slots, eligibility, roster integrity, save/render, cancellation, outside/cross-team drops and pointer cleanup.');
