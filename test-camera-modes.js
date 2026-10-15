// Run: node test-camera-modes.js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync(require('node:path').join(__dirname, 'index.html'), 'utf8');
const source = html.slice(html.indexOf('      const GAME_BASES ='), html.indexOf('      let labelRects ='));
assert(source.includes('function updateGameCamera'));
const messages = [];
const stored = {};
let now = 1000;
const context = vm.createContext({
  performance: { now: () => now },
  localStorage: { setItem: (key, value) => { stored[key] = value; } },
  window: { parent: { postMessage: (message) => messages.push(message) } }
});
vm.runInContext(`
  const IS_GAME = true;
  let camera = { yaw: 0.2, elevation: 0.62, scale: 1.05, targetX: 12, targetY: 24 };
  let freeCamera = { ...camera };
  let gameCameraMode = "free", cameraUpdatedAt = 0, cameraRunner = null;
  let chaseCamera = null;
  const MAX_ELEVATION = 1.55;
  const chaseDistances = {runner:12,ball:18};
  ${source}
  ${html.slice(html.indexOf('      function worldToScreen('), html.indexOf('      function groundShapeToWorld('))}
  ${html.slice(html.indexOf('      function drawChaseGround('), html.indexOf('      function render()'))}
  const zoomMinimum = 0.65, zoomMaximum = 4.5;
  function render3D() {}
  ${html.slice(html.indexOf('      function zoomCamera('), html.indexOf('      function panCameraByPixels('))}
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
run(`gameState.live = { trail: [], frame: {
  fielders: [],
  t: 0,
  ball: { x: 220, y: 300, z: 90 },
  runners: [{ id: 'lead', state: 'run', base: 3, x: -35, y: 35 }, { id: 'batter', isBatter: true, state: 'run', base: 1, x: 35, y: 35 }]
} };`);
let c = update('ball');
assert.equal(run('chaseCamera.eye.y'), 318, 'Ball camera starts behind the ball');
c = update('runner');
function checkHitterView(runner) {
  const hitter = run(`worldToScreen(${JSON.stringify({...runner,z:3})},960,720)`);
  assert(Math.abs(hitter.x-480) < 1e-6, 'Hitter stays directly in front of the camera');
  const ball = run('worldToScreen(gameState.live.frame.ball,960,720)');
  assert(Math.abs(ball.x-480) < 1e-6 && Math.abs(ball.y-720*0.44) < 1e-6 && ball.depth > 0.5, 'Hitter camera always faces the ball horizontally and vertically');
  assert(Math.abs(run('Math.hypot(chaseCamera.eye.x-chaseCamera.last.x,chaseCamera.eye.y-chaseCamera.last.y)')-run('chaseDistances.runner')) < 1e-8, 'Actual eye distance matches follow distance');
}
checkHitterView({x:35,y:35});
run('gameState.live.frame.runners.reverse();');
c = update('runner');
checkHitterView({x:35,y:35});
for (const runner of [{x:63.64,y:63.64},{x:0,y:127.28},{x:-63.64,y:63.64},{x:0,y:0}]) {
  run(`gameState.live.frame.t += 1;Object.assign(gameState.live.frame.runners[0],${JSON.stringify(runner)});`);
  c = update('runner');
  checkHitterView(runner);
}
run('zoomCamera(100)');
assert.equal(run('gameCameraMode'), 'runner');
assert.equal(run('chaseDistances.runner'), 3, 'Zoom reaches exactly 3 feet behind the hitter');
assert.equal(JSON.parse(stored['field-notes-chase-distances']).runner, 3, 'Follow zoom is persisted');
update('runner');
checkHitterView({x:0,y:0});
for (const ball of [{x:-100,y:-80,z:3},{x:0,y:0,z:100},{x:100,y:50,z:0}]) {
  run(`gameState.live.frame.ball = ${JSON.stringify(ball)};`);
  update('runner');
  checkHitterView({x:0,y:0});
}
run('zoomFollowCamera(0.001)');
assert.equal(run('chaseDistances.runner'), 180);
run('gameState.live.frame.ball = {x:220,y:300,z:90};');
update('ball');
run('gameState.live.frame.t += 0.1;gameState.live.frame.ball = {x:230,y:310,z:95};');
update('ball');
assert(Math.abs(run('chaseCamera.yaw')-Math.PI/4) < 1e-8, 'Ball camera faces travel direction');
assert(run('chaseCamera.pitch > 0'), 'Ball camera follows vertical travel too');
assert.equal(run('zoomFollowCamera(100)'), true);
assert.equal(run('chaseDistances.ball'), 3);
assert.equal(run('gameCameraMode'), 'ball');
assert.equal(run('chaseDistances.runner'), 180, 'Each mode keeps its own zoom');
run('gameState.live.frame.t += 1;gameState.live.frame.ball = {x:10,y:20,z:3};');
update('ball');
assert(run('chaseCamera.yaw < 0'), 'Camera turns with return throws');
const stillHeading = run('chaseCamera.yaw');
run('gameState.live.frame.t += 1;');
update('ball');
assert.equal(run('chaseCamera.yaw'), stillHeading, 'Held ball retains its last travel heading');
run('gameState.live.frame.t += 1;gameState.live.frame.ball = {x:10,y:20,z:0.2};');
update('ball');
run('gameState.live.frame.t += 0.1;gameState.live.frame.ball = {x:10.01,y:20.01,z:0.5};');
update('ball');
assert(run('worldToScreen(gameState.live.frame.ball,960,720).depth > 0.5'), 'Launching ball remains visible even with the eye above ground');
let textureStrips = 0;
context.context = new Proxy({}, {
  get: (_, method) => (...args) => {
    if (method === 'drawImage') textureStrips += 1;
    for (const arg of args) if (typeof arg === 'number') assert(Number.isFinite(arg), `${String(method)}: finite render coordinates`);
  },
  set: () => true
});
context.worldToReferencePixel = (x,y) => ({x:384+x,y:600-y});
run(`drawChaseGround({}, {width:768,height:768}, 960,720);
  drawWorldPolygon([{x:-100,y:-100},{x:100,y:-100},{x:100,y:100},{x:-100,y:100}],"green",null,960,720);
  drawWorldLine([{x:0,y:0},{x:100,y:100}],"white",2,960,720);`);
assert(textureStrips > 0, 'Ground reprojects the original image with finite texture strips');
const clipped = run('clipChasePolygon([{x:0,y:0,d:-1},{x:1,y:0,d:2},{x:0,y:1,d:2}])');
assert(clipped.length >= 3 && clipped.every((p) => p.d >= 0.5), 'Near-plane clipping keeps walls and field geometry valid');
run('gameState.live.frame.runners[0].out = true;');
update('runner');
assert.equal(run('cameraAction().runner.id'), 'batter', 'An out must not switch tracking to another runner');
assert(!html.includes('drawHitterView'), 'Hitter camera must use the same field and actor renderer');
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
assert.equal(run('chaseCamera'), null, 'Manual movement releases the chase projection');
assert.equal(messages.at(-1).mode, 'free');
run('setGameCamera("invalid");');
assert.equal(run('gameCameraMode'), 'free');
run(`gameState.live = null;
  gameState.play = { start: 0, lead: 0, points: [{t: 0, x: 0, y: 0, z: 3}, {t: 1, x: 50, y: 100, z: 0}],
    throws: [{release: 2, arrive: 3, from: {x: 50, y: 100}, to: {x: 0, y: 0}}], runners: [] };`);
assert.equal(run('gamePlayBallPoint(gameState.play, 2.5).x'), 25);
c = update('ball');
assert(Object.values(c).every(Number.isFinite), 'Non-live plays and replays also support tracking');
run('gameState.play.runners = [{from:0,to:1,delay:0,perBase:4,name:"Hitter"},{from:2,to:3,delay:0,perBase:4,name:"Lead"}];');
update('runner');
assert(run('cameraAction().runner.x >= 0'), 'Replay follows hitter rather than lead runner');
console.log('Passed: seven modes, 3 ft chase distance, independent persistent zoom, hitter tracking around bases, ball travel/throw headings, ground texture projection, near-plane clipping, fixed views and manual override.');
