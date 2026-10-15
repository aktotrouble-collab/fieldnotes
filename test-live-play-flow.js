// Run: node test-live-play-flow.js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const filename = path.join(__dirname, 'game-engine.js');
const source = fs.readFileSync(filename, 'utf8')
  .replace(/\r\n/g, '\n')
  .replace('const GameEngine = {', 'const GameEngine = { createLivePlay, applyBattedBall, throwFlight,')
  .replace('    return live;\n  }\n\n  const GameEngine', '    live.test = { entries, fielders, ballState, putOut, arrive, pickUp, catchInAir };\n    return live;\n  }\n\n  const GameEngine');
const sandbox = { module: { exports: {} }, require: createRequire(filename) };
vm.runInNewContext(source, sandbox, { filename });
const E = sandbox.module.exports;
const dt = 1 / 120;
function setup(outs = 0) {
  const g = E.createGame({
    away: E.generateTeam('Away', 'balanced', 1), home: E.generateTeam('Home', 'balanced', 2),
    park: 'dodgers', seed: 10
  });
  g.outs = outs;
  const live = E.createLivePlay(g, E.flightSim(85, 0, 10, g.park), { p: g.teams[0].lineup[0] }, { batHuman: true, fieldHuman: true });
  live.command({ kind: 'throw', target: 'hold' });
  const runner = live.test.entries[0];
  const holder = live.test.fielders.find(f => f.pos === '1B');
  holder.move = null;
  holder.x = holder.y = 90 / Math.SQRT2;
  live.test.ballState.x = holder.x;
  live.test.ballState.y = holder.y;
  live.test.pickUp(holder);
  return { g, live, runner, holder };
}
function finish(live, limit = 30, step = dt) {
  while (!live.done && live.t < limit) {
    live.step(step);
    const frame = live.snapshot();
    if (frame.done) {
      assert.equal(frame.ball.mode, 'held', 'Cannot end with a flying, thrown, or loose ball');
      assert(frame.ball.heldFor >= 1.5, 'Possession must last at least 1.5 seconds');
      assert(frame.runners.every(r => r.out || r.scored || r.state === 'hold'), 'Every active runner is stopped');
    }
  }
  assert(live.done, 'Play eventually settles');
}
{
  const { g, live, runner } = setup();
  runner.prog = 0.95;
  runner.reached = 0;
  runner.delay = 0;
  g.rng.chance = () => true;
  live.test.putOut(runner, 'force', 1);
  assert.equal(runner.out, false, 'Incorrect safe call leaves runner active');
  assert(live.prepare()[0].wrong);
  live.step(dt);
  assert(runner.prog > 0.95, 'Runner called safe keeps running instead of disappearing');
  assert.equal(live.snapshot().runners[0].out, false, 'Animation agrees with safe ruling');
  assert.equal(live.snapshot().umpireCalls[0].out, false, 'SAFE popup follows the incorrect on-field ruling');
  assert.equal(live.snapshot().umpireCalls[0].t, 0, 'Callout is stamped at the call, not the end of the play');
  finish(live);
  assert.equal(live.result().entries[0].out, false);
  const before = live.snapshot();
  live.prepare()[0].flip();
  assert.equal(live.result().entries[0].out, true, 'Replay correction restores true out for scoring');
  assert.deepEqual(live.snapshot(), before, 'Challenge changes result without rewriting the recorded animation');
}
{
  const { g, live, runner, holder } = setup();
  runner.prog = 0.999;
  runner.delay = 0;
  const b = live.test.ballState;
  b.mode = 'thrown';
  b.holder = null;
  const thrower = live.test.fielders.find(f => f.pos === 'SS');
  const flight = E.throwFlight({...thrower,x:0,y:120},holder,g.park);
  b.throwing = {
    from: { x: 0, y: 120 }, to: { x: holder.x, y: holder.y },
    t0: 0, t1: 0.1, receiver: holder, wild: false, base: 1,
    flight, target: {x:holder.x,y:holder.y}, thrower, record: {}, nextRead: 0.15
  };
  g.rng.chance = () => true;
  live.test.arrive(runner);
  assert.equal(runner.out, true, 'Incorrect out call immediately retires a physically safe runner');
  assert.equal(runner.state, 'out');
  assert.equal(live.snapshot().umpireCalls[0].out, true, 'OUT popup follows the incorrect on-field ruling');
  assert(live.prepare()[0].wrong);
  const position = live.snapshot().runners[0].x;
  live.step(dt);
  assert.equal(live.snapshot().runners[0].x, position, 'Called-out runner stops advancing');
  assert(!live.done, 'Out call does not instantly terminate animation');
  finish(live);
  assert.equal(live.result().entries[0].out, true);
  live.prepare()[0].flip();
  assert.equal(live.result().entries[0].out, false, 'Overturn restores safe runner');
  assert.equal(live.result().entries[0].base, 1);
}
for (const step of [1 / 60, 1 / 120, 1 / 240]) {
  const { live, runner } = setup();
  runner.prog = runner.target = runner.reached = 1;
  runner.state = 'hold';
  while (live.t + step < 1.5) {
    live.step(step);
    assert(!live.done, 'Stable runners alone cannot end play before 1.5 seconds of possession');
  }
  {
    const { live, runner } = setup();
    runner.prog = runner.target = runner.reached = 1;
    runner.state = 'hold';
    live.test.ballState.mode = 'loose';
    live.test.ballState.holder = null;
    live.test.ballState.pickupAt = null;
    while (live.t < 2) live.step(dt);
    assert(!live.done, 'Stopped runners cannot end play while the ball is loose');
    live.test.pickUp(live.test.fielders[0]);
    finish(live);
    assert(live.t>=3.5,'Possession timer starts only when the loose ball is gathered');
  }
  finish(live, 5, step);
  assert(live.t < 1.5 + step * 2, 'Completion uses elapsed time, not a fixed frame count');
}
{
  const { live, runner, holder } = setup();
  runner.prog = 0.1;
  runner.delay = 0;
  holder.x = 0;
  holder.y = 100;
  while (!live.done && live.t < 1.6) live.step(dt);
  assert(!live.done, 'A moving batter keeps play alive even after 1.5 seconds in the glove');
  const other = live.test.fielders.find(f => f.pos === '2B');
  other.x = holder.x;
  other.y = holder.y;
  live.test.pickUp(other);
  assert(live.snapshot().ball.heldFor < dt, 'Changing holders resets possession duration');
  finish(live);
  assert(live.snapshot().runners[0].state === 'hold');
}
{
  const { g, live, runner } = setup(2);
  g.rng.chance = () => false;
  runner.prog = 0.9;
  runner.delay = 0;
  live.test.putOut(runner, 'force', 1);
  live.step(dt);
  assert(!live.done, 'Third out does not cut off the play animation');
  finish(live);
  assert(live.result().thirdOutForce,'Third-out force remains a scoring cutoff');
  const current = live.snapshot();
  const calls = live.prepare();
  assert.strictEqual(live.prepare(),calls,'Preparing review does not regenerate calls');
  assert.deepEqual(live.snapshot(),current,'Preparing review cannot rewrite animation');
}
{
  const { live, runner } = setup(2);
  const trailing = { ...runner, id: 1, start: 1, prog: 1.3, target: 2, reached: 1, isBatter: false, state: 'run', out: false, scored: false, delay: 0 };
  live.test.entries.push(trailing);
  live.test.catchInAir();
  live.step(dt);
  assert(!live.done, 'Third-out catch waits for runners still between bases');
  finish(live);
  assert.equal(trailing.prog, 1, 'Runner returns to a base instead of freezing between bags');
}
{
  const { live, runner } = setup();
  runner.prog = runner.target = runner.reached = 1;
  runner.state = 'hold';
  live.t = 45;
  live.test.pickUp(live.test.fielders[0]);
  live.step(dt);
  assert(!live.done, 'Old 40-second cutoff cannot bypass required completion state');
  finish(live, 50);
}
for (const crossing of [0.5,1.5]) {
  const {g,live,runner}=setup(2);
  runner.isBatter=false;
  runner.start=1;
  runner.target=2;
  runner.prog=1.8;
  runner.reached=1;
  live.t=1;
  g.rng.chance=()=>false;
  live.test.putOut(runner,'tag',2);
  const scorer={...runner,id:3,start:3,prog:4,target:4,reached:4,out:false,rulings:undefined,call:null,scored:true,scoredAt:crossing,state:'scored',r:{p:g.teams[0].lineup[1],resp:E.currentPitcher(g)}};
  live.test.entries.push(scorer);
  const result=live.result();
  assert.equal(result.thirdOutAt,1);
  assert.equal(result.thirdOutForce,false);
  g.lineScore[0][0]=0;
  E.applyBattedBall(g,result.ball,runner.r,E.currentPitcher(g),result);
  assert.equal(result.runs,crossing<1?1:0,'Only runs crossing before third-out tag count during wind-down');
}
const html = fs.readFileSync(path.join(__dirname, 'game.html'), 'utf8');
assert.match(html, /lastPossession \+ \(fielded \? 1\.5 : 0\)/, 'Simulated-play playback preserves the possession hold');
assert.match(html, /r\.delay \+ r\.duration/, 'Simulated-play playback waits for accelerated runners');
console.log('Passed: live incorrect rulings and reactions, replay corrections, runner settlement, third outs, possession changes, and 1.5-second completion at multiple frame rates.');
