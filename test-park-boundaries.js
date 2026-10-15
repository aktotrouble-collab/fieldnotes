// Run with node test-park-boundaries.js after regenerating the park boundaries.
const assert = require('node:assert/strict');
const E = require('./game-engine.js');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
require('./park-walls.js');
const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
function artObject(name) {
  const start = html.indexOf(`const ${name} = {`);
  const end = html.indexOf('\n      };', start);
  return vm.runInNewContext(`${html.slice(start, end + 9)}\n${name};`);
}
const art = artObject('REFERENCE_ART'), foulWalls = artObject('FOUL_WALLS');
for (const [id, reference] of Object.entries(art)) {
  const foul = foulWalls[id];
  assert.equal(JSON.stringify(foul[0]), JSON.stringify(reference.walls[0]), `${id}: left foul fence stays attached to outfield`);
  assert.equal(JSON.stringify(foul.at(-1)), JSON.stringify(reference.walls.at(-1)), `${id}: right foul fence stays attached to outfield`);
  const collision = globalThis.PARK_BOUNDARIES[id];
  const outline = [...reference.walls, ...foul.slice().reverse()];
  assert.equal(outline.length, collision.points.length);
  outline.forEach(([x, y], i) => {
    assert(Math.abs(collision.points[i][0] - (x - reference.homeX) / reference.pixelsPerFootX) < 1e-9);
    assert(Math.abs(collision.points[i][1] - (reference.homeY - y) / reference.pixelsPerFootY) < 1e-9, `${id}: visible fence and collision fence agree`);
  });
}
assert.equal(JSON.stringify(foulWalls['red-sox'].slice(-8)), JSON.stringify([
  [519,489],[529,470],[539,450],[553,420],[562,401],[569,386],[574,375],[576,368]
]), 'Fenway RF fence follows the painted field edge through and below the pole');

function inside(p, polygon) {
  let yes = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [ax, ay] = polygon[i];
    const [bx, by] = polygon[j];
    if ((ay > p.y) !== (by > p.y) && p.x < (bx - ax) * (p.y - ay) / (by - ay) + ax) yes = !yes;
  }
  return yes;
}

let rays = 0;
let flights = 0;
let trackPoints = 0;
let livePlays = 0;
for (const park of E.PARK_LIST) {
  const polygon = globalThis.PARK_BOUNDARIES[park.id].points;
  for (let angle = -180; angle < 180; angle += 0.25) {
    const a = angle * Math.PI / 180;
    const distance = E.boundaryAt(park, angle);
    assert(inside({ x: Math.sin(a) * (distance - 0.05), y: Math.cos(a) * (distance - 0.05) }, polygon), `${park.id}: inside ray ${angle}`);
    assert(!inside({ x: Math.sin(a) * (distance + 0.05), y: Math.cos(a) * (distance + 0.05) }, polygon), `${park.id}: outside ray ${angle}`);
    assert(inside(E.keepInside(park, Math.sin(a) * 600, Math.cos(a) * 600), polygon), `${park.id}: fielder ${angle}`);
    rays += 1;
  }
  // Low liners and grounders cannot pass through either foul corner or wall notches.
  const angles = new Set([-44.9, 44.9]);
  for (const [x, y] of polygon.slice(0, globalThis.PARK_BOUNDARIES[park.id].outfield + 1)) {
    const angle = Math.atan2(x, y) * 180 / Math.PI;
    for (const offset of [-0.1, 0, 0.1]) angles.add(angle + offset);
  }
  for (const angle of angles) {
    for (const la of [0, 6]) {
      const ball = E.flightSim(115, la, angle, park, { foulOver: false });
      assert(!ball.hr && !ball.grd, `${park.id}: low ball unexpectedly left park`);
      for (const [i, p] of ball.pts.entries()) {
        const bearing = Math.atan2(p.x, p.y) * 180 / Math.PI;
        const clearedFoulWall = i === ball.pts.length - 1 && i === ball.firstLand && p.z > E.wallAt(park, bearing) && ball.wallHit < 0;
        assert(inside(p, polygon) || clearedFoulWall, `${park.id}: ball outside at ${angle}, t=${p.t}`);
        if (i > 0 && !clearedFoulWall) {
          const prev = ball.pts[i - 1];
          assert(inside({ x: (p.x + prev.x) / 2, y: (p.y + prev.y) / 2 }, polygon), `${park.id}: ball crosses wall between frames at ${angle}`);
        }
      }
      flights += 1;
    }
  }
  const corner = polygon[globalThis.PARK_BOUNDARIES[park.id].outfield];
  const target = { x: corner[0] * 1.1, y: corner[1] * 1.1 };
  const tracks = E.fieldTracks({
    park, fielders: [{ pos: 'RF', x: 140, y: 160, speed: 25 }],
    pts: [{ t: 0, x: 0, y: 0 }, { t: 5, ...target }], landing: target,
    primary: { pos: 'RF', ...target, t: 5 }, duration: 8, throws: [], runners: []
  });
  for (const [index, [, x, y]] of tracks.RF.entries()) {
    assert(inside({ x, y }, polygon), `${park.id}: animated fielder outside`);
    if (index > 0) {
      const [, px, py] = tracks.RF[index - 1];
      assert(inside({ x: (px + x) / 2, y: (py + y) / 2 }, polygon), `${park.id}: fielder crosses wall between frames`);
    }
    trackPoints += 1;
  }
  const game = E.createGame({
    away: E.generateTeam('Away', 'balanced', 12), home: E.generateTeam('Home', 'balanced', 14),
    park: park.id, seed: 81
  });
  const event = E.stepPitch(game, { swing: true, ball: { ev: 115, la: 0, dir: globalThis.PARK_FOUL[park.id][1] - 0.2 } },
    { human: [true, true], live: { batHuman: false, fieldHuman: true } });
  assert(event.live, `${park.id}: expected live corner play`);
  let ticks = 0;
  while (!event.live.done && ticks++ < 20000) {
    event.live.step(1 / 120);
    if (ticks % 10 === 0) {
      for (const f of event.live.snapshot().fielders) assert(inside(f, polygon), `${park.id}: live ${f.pos} outside fence`);
    }
  }
  assert(event.live.done, `${park.id}: live play must finish`);
  assert(E.completeLive(game, { human: [true, true] }).liveDone);
  livePlays += 1;
}
const fenway = E.parkById('red-sox');
assert(E.boundaryAt(fenway, 44.9) < 250, 'Fenway RF corner must not use the old 322-ft sample');
const homer = E.flightSim(120, 30, 0, fenway);
assert(homer.hr, 'Balls above the wall must still be home runs');
const open = E.flightSim(120, 30, 0, fenway, { noFence: true });
assert(open.landing.d > E.fenceAt(fenway, 0), 'Projected flight must still continue beyond the fence');
console.log(`Passed: ${E.PARK_LIST.length} parks, ${rays} boundary rays, ${flights} corner flights, ${trackPoints} fielder samples, ${livePlays} live corner plays.`);
