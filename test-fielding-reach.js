// Run: node test-fielding-reach.js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { createRequire } = require('node:module');
const M = require('./fielding-motion.js');
const filename = path.join(__dirname, 'game-engine.js');
const source = fs.readFileSync(filename, 'utf8').replace(
  'const GameEngine = {', 'const GameEngine = { fieldProfile, fieldingPlan, fieldBall, defenseList, createLivePlay,'
);
const sandbox = { module: { exports: {} }, require: createRequire(filename) };
vm.runInNewContext(source, sandbox, { filename });
const E = sandbox.module.exports;
const defender = (field) => ({ pos: 'CF', x: 0, y: 0, p: { field, speed: 50, arm: 50 }, fp: E.fieldProfile({ field, speed: 50, arm: 50 }) });
const low = defender(10), high = defender(150);
assert(high.fp.ability.jump > low.fp.ability.jump);
assert(high.fp.ability.dive > low.fp.ability.dive);
assert(high.fp.ability.timing < low.fp.ability.timing);
assert(high.fp.ability.recovery < low.fp.ability.recovery);
assert.equal(high.fp.vmax, low.fp.vmax, 'FLD does not replace SPD');
assert.equal(M.HEIGHT, 6);
assert.equal(M.GLOVE_TOP, 8);
assert(M.reach(M.pose(null,0),7)>0,'Standing glove extends above figure');
assert.equal(M.reach(M.pose(null,0),8.01),0,'Standing player cannot grab above glove');
assert(M.canReach(M.pose(null,0),0,0,8),'Exactly at glove tip is reachable');
assert(!M.canReach(M.pose(null,0),0,0,8.01),'Vertical height must be checked even directly overhead');
assert(!M.canReach({z:0,tilt:1.25,dx:1,dy:0},-7,0,1.5),'Diving forward cannot reach behind the body');
assert(!M.canReach({z:0,tilt:1.25,dx:1,dy:0},0,7,1.5),'Dive reach is directional, not a giant circular catch radius');
assert.equal(E.fieldingPlan(low,{x:0,y:0,z:20,t:5}),null,'No impossible high catches');
assert.equal(E.fieldingPlan(high,{x:0,y:0,z:10.5,t:0.55}),null,'Jump must have time to prepare');
const leap = E.fieldingPlan(high,{x:0,y:0,z:10.5,t:1.5});
assert(leap && leap.move.kind==='jump','Good FLD can time a high jump catch');
assert.equal(E.fieldingPlan(low,{x:0,y:0,z:10.5,t:1.5}),null,'Low FLD cannot reach same high ball');
let diving = null;
for(let x=1;x<70;x+=0.1) {
  const point = {x,y:0,z:1.5,t:0.85};
  const plan = E.fieldingPlan(high,point);
  if(plan && plan.move && plan.move.kind==='dive' && !E.fieldingPlan(low,point)) { diving={point,plan};break; }
}
assert(diving,'FLD creates measurable differences in dive range');
for(const {point,plan} of [{point:{x:0,y:0,z:10.5,t:1.5},plan:leap},diving]) {
  const pose=M.pose(plan.move,point.t);
  assert(Math.hypot(plan.body.x-point.x,plan.body.y-point.y)<=M.reach(pose,point.z)+1e-8,'Contact lies within physical pose/glove reach');
  assert(M.canReach(pose,point.x-plan.body.x,point.y-plan.body.y,point.z),'Contact intersects the actual posed figure/glove volume');
  assert.equal(M.pose(plan.move,plan.move.start-0.01).z,0);
  assert.equal(M.pose(plan.move,plan.move.end).tilt,0);
}
const testBall={pts:[{t:0,x:0,y:0,z:3},{t:1.5,x:0,y:0,z:20},{t:3,x:0,y:0,z:0}],firstLand:2,wallHit:-1};
assert.equal(E.fieldBall(testBall,[high],{airOnly:true}),null,'Too-high fly stays uncaught');
assert.equal(E.fieldBall(testBall,[high]).air,false,'Too-high fly must reach ground');
const jumpBall={...testBall,pts:[testBall.pts[0],{t:1.5,x:0,y:0,z:10.5},testBall.pts[2]]};
assert.equal(E.fieldBall(jumpBall,[high]).move.kind,'jump');
let catches=0, jumps=0, dives=0, plays=0;
for(const [ev,la,dir] of [[95,15,0],[100,20,25],[80,45,-20],[110,3,30],[45,60,0],[100,10,-30]]) {
  const g=E.createGame({away:E.generateTeam('Away','balanced',1),home:E.generateTeam('Home','balanced',2),park:'dodgers',seed:10});
  const event=E.stepPitch(g,{swing:true,ball:{ev,la,dir}},{live:{batHuman:false,fieldHuman:false}});
  if(!event.live) continue;
  const live=event.live;
  let prev=live.snapshot(),ticks=0;
  while(!live.done && ticks++<6000) {
    live.step(1/120);
    const frame=live.snapshot();
    assert(frame.fielders.every(f=>Number.isFinite(f.pose.z)&&Number.isFinite(f.pose.tilt)));
    if(frame.fielders.some(f=>f.pose.z>0.1)) jumps++;
    if(frame.fielders.some(f=>f.pose.tilt>0.1)) dives++;
    if(prev.ball.mode==='flight'&&frame.ball.mode==='held') {
      const f=frame.fielders.find(f=>f.has);
      const original=event.ball.pts[Math.min(event.ball.pts.length-1,Math.round(frame.t*120))];
      assert(f,'Catch has a real fielder');
      assert(Math.hypot(f.x-original.x,f.y-original.y)<=M.reach(f.pose,original.z)+0.8,'Live catch is physically reachable at actual body position');
      catches++;
    }
    if(prev.ball.mode==='loose'&&frame.ball.mode==='held') {
      const f=frame.fielders.find(f=>f.has);
      assert(Math.hypot(f.x-prev.ball.x,f.y-prev.ball.y)<=M.ARM_REACH+0.1,'Ground pickup does not teleport fielder');
    }
    prev=frame;
  }
  assert(live.done,'Live play finishes with physical catches');
  plays++;
}
assert(plays>=4&&catches>0,'Exercise real live fielding');
console.log(`Passed: standing reach, FLD jump/dive range and timing, pose/contact geometry, ${plays} live plays and ${catches} catches (jump frames ${jumps}, dive frames ${dives}).`);
