// Run: node test-contact-reviews.js
const assert = require('node:assert/strict');
const E = require('./game-engine.js');
const opts = { human: [true, true], hold: true, live: { batHuman: true, fieldHuman: false } };
function game(seed = 8) {
  return E.createGame({
    away: E.generateTeam('Away', 'balanced', 1),
    home: E.generateTeam('Home', 'balanced', 2), park: 'red-sox', seed
  });
}
function contact(g, ev, la, dir, ctl = opts) {
  const event = E.stepPitch(g, { swing: true, ball: { ev, la, dir } }, ctl);
  assert.equal(event.held, 'ff');
  return E.playHeldContact(g, ctl);
}
function finishLive(g, event) {
  let ticks = 0;
  while (!event.live.done && ticks++ < 20000) event.live.step(1 / 120);
  assert(event.live.done);
}
{
  const g = game();
  const e = contact(g, 100, 15, 15);
  assert(e.live);
  finishLive(g, e);
  const frames = e.live.snapshot();
  assert(frames.runners.some((r) => Math.hypot(r.x, r.y) > 10), 'Runners must move in the original play');
  const review = E.reviewLive(g, opts);
  assert(review.calls.some((c) => c.id === 'ff'));
  const result = e.live.result();
  const calls = g.review.calls.filter((c) => c.id !== 'ff').map((c) => c.id);
  for (const id of calls) E.challengeCall(g, id);
  const done = E.completeLive(g, opts);
  assert.equal(done.play.entries.length, result.entries.length);
  assert.equal(g.battedBalls.length, 1);
  assert.equal(g.pitches, 1);
  assert.equal(g.pendingLive, null);
  assert.equal(g.pa && g.pa.held, null);
}
for (const [ev, la, dir] of [[120, 30, 0], [90, 15, 70], [40, 65, 100]]) {
  const g = game();
  const e = contact(g, ev, la, dir);
  assert(e.contactPending);
  assert.equal(g.battedBalls.length, 0, 'Do not apply provisional contact twice');
  E.challengeCall(g, 'ff');
  const done = E.completeContact(g, opts);
  assert.equal(done, e, 'Completion must use the play that was already shown');
  assert(!done.contactPending);
  assert.equal(g.pitches, 1);
  assert.equal(g.pendingContact, null);
  if (done.ball) assert.equal(g.battedBalls.length, 1);
}
// Force a review correction through the same call interface used by the UI.
{
  const g = game();
  const e = contact(g, 100, 15, 15);
  finishLive(g, e);
  E.reviewLive(g, opts);
  const call = g.review.calls.find((c) => c.id === 'ff');
  call.wrong = true;
  const held = g.pendingLive.heldContact;
  held.ff.truthFair = false;
  assert(E.challengeCall(g, 'ff').overturned);
  const done = E.completeLive(g, opts);
  assert(done.foul && !done.ball);
  assert.equal(g.battedBalls.length, 0);
  assert.equal(g.pitches, 1);
}
{
  const g = game();
  const e = contact(g, 90, 15, 70);
  const call = g.review.calls[0];
  call.wrong = true;
  g.pendingContact.held.ff.truthFair = true;
  E.challengeCall(g, 'ff');
  const done = E.completeContact(g, opts);
  assert(done.live && !done.foul);
  finishLive(g, done);
  E.completeLive(g, opts);
  assert.equal(g.pitches, 1);
  assert.equal(g.battedBalls.length, 1);
}
for (const seed of [5, 8]) {
  const g = game(seed);
  let guard = 0;
  while (!g.over && guard++ < 3000) {
    let e = E.stepPitch(g, undefined, opts);
    while (e && e.held) {
      if (e.held === 'ff') e = E.playHeldContact(g, opts);
      else if (e.held === 'steal') e = E.resumeSteal(g, opts);
      else e = E.stepPitch(g, undefined, opts);
    }
    if (e && e.live) {
      finishLive(g, e);
      E.reviewLive(g, opts);
      E.completeLive(g, opts);
    } else if (e && e.contactPending) E.completeContact(g, opts);
  }
  assert(g.over, 'A game with every review held must finish');
  assert(!g.pendingContact && !g.pendingLive && !g.heldSteal);
}
console.log('Passed: live fielding/runners, combined reviews, HR/foul/caught contact, both fair/foul overturn directions, and single application.');
