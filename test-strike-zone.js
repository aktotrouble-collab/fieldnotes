// Run: node test-strike-zone.js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { createRequire } = require('node:module');
const filename = path.join(__dirname, 'game-engine.js');
const source = fs.readFileSync(filename, 'utf8').replace('const GameEngine = {', 'const GameEngine = { zoneDistance, rollUmp, absCall,');
const context = { module: { exports: {} }, require: createRequire(filename) };
vm.runInNewContext(source, context, { filename });
const E = context.module.exports;
const { halfWidth: w, bottom, top } = E.ZONE, r = E.PITCH_RADIUS;
const middle = (bottom + top) / 2;
const touches = [[w + r, middle], [-w - r, middle], [0, top + r], [0, bottom - r]];
for (const side of [-1, 1]) for (const height of [bottom, top]) {
  const vertical = height === top ? 1 : -1;
  touches.push([side * (w + r / Math.sqrt(2)), height + vertical * r / Math.sqrt(2)]);
}
for (const [x, z] of touches) {
  assert.equal(E.zoneDistance(x, z), 0, 'Exact tangency is a strike, including corners');
  const pitch = { d: E.zoneDistance(x, z) };
  const game = { rng: { chance: () => false }, half: 0, count: { balls: 0, strikes: 0 } };
  E.rollUmp(game, pitch);
  assert.equal(pitch.truth, 'strike');
  const review = E.absCall(game, pitch);
  assert(review.wrong, 'ABS recognizes a ball call on a touching pitch as incorrect');
  review.flip();
  assert.equal(pitch.ump, 'strike');
}
for (const [x, z] of [[w + r + 0.0001, middle], [-w - r - 0.0001, middle], [0, top + r + 0.0001], [0, bottom - r - 0.0001], [w + r, top + r]]) {
  assert(E.zoneDistance(x, z) > 0, 'A ball with a real gap, including past a corner, is outside');
}
for (const [x, z] of [[0, middle], [w, top], [-w, bottom], [w + r / 2, middle]]) {
  assert(E.zoneDistance(x, z) < 0, 'Partial overlap and centers on the boundary are strikes');
}
console.log('Passed: edge/corner tangency, partial overlaps, clear misses, and ABS truth/correction.');
