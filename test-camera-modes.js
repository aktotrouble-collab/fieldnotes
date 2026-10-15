// Run: node test-camera-modes.js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync(require('node:path').join(__dirname, 'index.html'), 'utf8');
const source = html.slice(html.indexOf('      const GAME_BASES ='), html.indexOf('      let labelRects ='));
assert(source.includes('function updateGameCamera'));
const messages = [];
let now = 1000;
const context = vm.createContext({
  performance: { now: () => now },
  window: { parent: { postMessage: (message) => messages.push(message) } }
});
vm.runInContext(`
  const IS_GAME = true;
  let camera = { yaw: 0.2, elevation: 0.62, scale: 1.05, targetX: 12, targetY: 24 };
  let freeCamera = { ...camera };
  let gameCameraMode = "free", cameraUpdatedAt = 0, cameraRunner = null;
  ${source}
`, context);
function run(code) { return vm.runInContext(code, context); }
function update(mode, frames = 120) {
  run(`setGameCamera("${mode}");`);
  for (let i = 0; i < frames; i += 1) {
    now += 1000 / 60;
    run('updateGameCamera(960, 720);');
  }
  return JSON.parse(run('JSON.stringify(camera)'));
}
function screen(p, c) {
  const x = p.x - c.targetX;
  const y = p.y - c.targetY;
  return {
    x: 480 + (x * Math.cos(c.yaw) - y * Math.sin(c.yaw)) * 960 * c.scale / 700,
    y: 720 * 0.82 - ((x * Math.sin(c.yaw) + y * Math.cos(c.yaw)) * Math.cos(c.elevation) + (p.z || 0) * Math.sin(c.elevation)) * 960 * c.scale / 700
  };
}
for (const mode of ['action', 'ball', 'runner', 'high', 'first', 'third']) {
  const camera = update(mode);
  assert(Object.values(camera).every(Number.isFinite), `${mode}: finite idle view`);
}
assert.deepEqual(update('free'), { yaw: 0.2, elevation: 0.62, scale: 1.05, targetX: 12, targetY: 24 });
run(`gameState.live = { frame: {
  ball: { x: 220, y: 300, z: 90 },
  runners: [{ id: 'lead', state: 'run', base: 3, x: -35, y: 35 }, { id: 'batter', state: 'run', base: 1, x: 35, y: 35 }]
} };`);
let c = update('ball');
for (const p of [{ x: 220, y: 300, z: 90 }, { x: 220, y: 300, z: 0 }]) {
  const s = screen(p, c);
  assert(s.x > 0 && s.x < 960 && s.y > 0 && s.y < 720, 'Ball and its ground shadow remain in view');
}
c = update('runner');
assert.equal(run('cameraRunner'), 'lead');
const runner = screen({ x: -35, y: 35 }, c);
assert(Math.abs(runner.x - 480) < 2 && Math.abs(runner.y - 367.2) < 2);
run('gameState.live.frame.runners.reverse();');
update('runner');
assert.equal(run('cameraRunner'), 'lead', 'Runner tracking must not jump when array order changes');
c = update('action');
for (const p of [{ x: 0, y: 0 }, { x: -200, y: 330 }, { x: 200, y: 330 }, { x: 220, y: 300, z: 90 }]) {
  const s = screen(p, c);
  assert(s.x > 0 && s.x < 960 && s.y > 0 && s.y < 720, 'Wide Action keeps the field and ball visible');
}
for (const mode of ['high', 'first', 'third']) {
  c = update(mode);
  run('gameState.live.frame.ball = { x: -220, y: 350, z: 5 };');
  const after = update(mode);
  for (const key of Object.keys(c)) assert(Math.abs(after[key] - c[key]) < 1e-6, `${mode}: fixed view must not chase the ball`);
}
run('takeCameraControl();');
assert.equal(run('gameCameraMode'), 'free');
assert.equal(messages.at(-1).mode, 'free');
run('setGameCamera("invalid");');
assert.equal(run('gameCameraMode'), 'free');
run(`gameState.live = null;
  gameState.play = { start: 0, lead: 0, points: [{t: 0, x: 0, y: 0, z: 3}, {t: 1, x: 50, y: 100, z: 0}],
    throws: [{release: 2, arrive: 3, from: {x: 50, y: 100}, to: {x: 0, y: 0}}], runners: [] };`);
assert.equal(run('gamePlayBallPoint(gameState.play, 2.5).x'), 25);
c = update('ball');
assert(Object.values(c).every(Number.isFinite), 'Non-live plays and replays also support tracking');
console.log('Passed: seven modes, preserved Free view, ball/shadow framing, stable runner selection, wide field visibility, fixed views, manual override, and throw tracking.');
