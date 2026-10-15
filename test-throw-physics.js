// Run: node test-throw-physics.js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {createRequire} = require('node:module');
const filename = path.join(__dirname,'game-engine.js');
const source = fs.readFileSync(filename,'utf8').replace(/\r\n/g,'\n')
  .replace('const GameEngine = {','const GameEngine = { fieldProfile, throwFlight, throwPlan, trajectoryPoint, cutoffPlan, createLivePlay, resolveBattedBall,')
  .replace('    return live;\n  }\n\n  const GameEngine',
    '    live.test={fielders,entries,ballState,pickUp,doThrow,cutoffFor};\n    return live;\n  }\n\n  const GameEngine');
const sandbox = {module:{exports:{}},require:createRequire(filename)};
vm.runInNewContext(source,sandbox,{filename});
const E=sandbox.module.exports, park=E.parkById('dodgers');
function fielder(arm=50,x=0,y=0,pos='CF') {
  const p={arm,field:50,speed:50,height:72,throws:'R'};
  return {p,fp:E.fieldProfile(p),x,y,pos};
}
const fixed={chance:()=>false,gauss:()=>1};
function cross(flight,distance) {
  const i=flight.pts.findIndex(p=>p.y>=distance);
  assert(i>0,'Throw reaches the target plane');
  const a=flight.pts[i-1],b=flight.pts[i],u=(distance-a.y)/(b.y-a.y);
  return {x:a.x+(b.x-a.x)*u,z:a.z+(b.z-a.z)*u,t:a.t+(b.t-a.t)*u};
}
const report=[];
for(const arm of [20,50,90]) {
  const h=fielder(arm);
  let previousPeak=0;
  for(const distance of [60,120,220]) {
    const flight=E.throwFlight(h,{x:0,y:distance},park);
    const at=cross(flight,distance);
    assert.equal(flight.speed,h.fp.armFps,'Release velocity is constant across distances');
    assert.equal(flight.directionError,0);
    assert.equal(flight.angleError,0);
    assert(Math.abs(at.x)<1e-8,'Perfect aim stays on the exact line');
    if(!E.throwPlan(flight.speed,distance).bounced) assert(Math.abs(at.z-4)<0.35,'Low-angle solution reaches glove height');
    const before=flight.pts.filter(p=>p.t<=at.t);
    const peak=Math.max(...before.map(p=>p.z));
    assert(peak>previousPeak,'Longer throws have naturally greater arc at the same velocity');
    previousPeak=peak;
    if(distance===60) assert(peak<7,'Short throws stay within two feet above release height');
    report.push({arm,distance,mph:+(flight.speed/1.46667).toFixed(1),peak:+peak.toFixed(1),seconds:+at.t.toFixed(2)});
  }
  const short=E.throwFlight(h,{x:0,y:60},park,fixed);
  const long=E.throwFlight(h,{x:0,y:220},park,fixed);
  assert.equal(short.directionError,long.directionError,'Aim error is an angle chosen at release, not endpoint scatter');
  assert.equal(short.angleError,long.angleError);
  assert(Math.abs(cross(long,220).x)>Math.abs(cross(short,60).x)*3,'Same directional error diverges with distance');
  assert(short.angleError!==0,'Vertical release angle also varies on imperfect throws');
  const perfect=E.throwFlight(h,{x:0,y:120},park,{chance:()=>true,gauss:()=>{throw Error('Perfect throw must not scatter');}});
  assert(perfect.perfect);
  const moving={...h,pickup:{vx:-20,vy:0,backhand:1}};
  assert(E.throwFlight(moving,{x:100,y:0},park).speed<h.fp.armFps,'Off-balance release reduces velocity');
}
assert(E.throwFlight(fielder(90),{x:0,y:220},park,fixed).directionError
  <E.throwFlight(fielder(20),{x:0,y:220},park,fixed).directionError,'ARM improves aim, independently of FLD');
{
  const h=fielder(20);
  const flight=E.throwFlight(h,{x:0,y:400},park);
  assert(E.throwPlan(flight.speed,400).bounced,'Weak arm cannot magically reach deep target on the fly');
  assert(flight.pts[flight.firstLand].y<400);
  const after=flight.pts.slice(flight.firstLand+1);
  assert(after.some(p=>p.z>0),'Throws bounce using hit physics');
  assert(after.some(p=>p.z===0),'Throws eventually roll');
  const wall=E.throwFlight(fielder(50,0,360),{x:0,y:430},park);
  assert(wall.wallHit>=0,'Throws collide with actual park walls');
  const at=wall.pts[wall.wallHit],later=wall.pts[wall.wallHit+10];
  assert(later.y<at.y,'Wall collision reflects throw back into the park');
  const over=E.flightSim(100,40,0,park,{origin:{x:0,y:390,z:5},thrown:true,spin:{b:0,s:0}});
  assert(over.escaped && !over.hr && !over.grd,'Thrown balls over a wall are out of play, never home runs');
}
function setup() {
  const g=E.createGame({away:E.generateTeam('A','balanced',1),home:E.generateTeam('H','balanced',2),park:'dodgers',seed:10});
  const live=E.createLivePlay(g,E.flightSim(85,0,10,g.park),{p:g.teams[0].lineup[0]},{batHuman:true,fieldHuman:true});
  live.command({kind:'throw',target:'hold'});
  for(const f of live.test.fielders) {f.move=null;f.run=null;f.dest=null;}
  return {g,live};
}
{
  const {g,live}=setup();
  const h=live.test.fielders.find(f=>f.pos==='CF');
  h.x=0;h.y=350;h.pickup=null;
  const relay=live.test.fielders.find(f=>f.pos==='SS');
  relay.x=0;relay.y=157.5;
  const cut=live.test.cutoffFor(h,4);
  assert(cut && cut.saves>0,'Positioned cutoff beats a long, slower direct throw');
  const direct=E.throwPlan(h.fp.armFps,350).duration;
  const weak={...h,p:{...h.p,arm:10},fp:E.fieldProfile({...h.p,arm:10})};
  assert(E.throwPlan(weak.fp.armFps,350).duration>direct,'Weak arm gives runners more time on deep direct throws');
}
for(const step of [1/60,1/120,1/240]) {
  const {g,live}=setup();
  const h=live.test.fielders.find(f=>f.pos==='CF');
  h.x=0;h.y=330;
  h.p.arm=20;h.fp=E.fieldProfile(h.p);
  live.test.ballState.x=h.x;live.test.ballState.y=h.y;
  live.test.pickUp(h);h.pickup=null;
  g.rng.chance=()=>false;g.rng.gauss=()=>1.5;
  live.test.doThrow(h,4,false);
  const th=live.test.ballState.throwing;
  assert(th.flight && th.record.points.length>10,'Live throws carry physical trajectories into replay');
  let bounced=false,passed=false;
  for(let i=0;i<24000&&!live.done;i++) {
    live.step(step);
    const b=live.snapshot().ball;
    if(b.mode==='thrown') {
      const expected=E.trajectoryPoint(live.test.ballState.throwing.flight.pts,live.t-live.test.ballState.throwing.t0);
      assert(Math.hypot(b.x-expected.x,b.y-expected.y,b.z-expected.z)<1e-8,'Live ball follows actual flight, not a target lerp');
      if(b.z<0.1) bounced=true;
      if(live.t>th.t1+0.1) passed=true;
    }
  }
  assert(live.done,'Physical throws and recovery eventually settle at different frame rates');
  assert(bounced || passed,'Long imperfect throw is allowed to skip or continue past nominal reception');
}
{
  const {g}=setup();
  const result=E.resolveBattedBall(g,E.flightSim(85,0,10,g.park),{p:g.teams[0].lineup[0]});
  assert(result.throws.length>0);
  for(const th of result.throws) {
    assert(th.points.length>1 && th.speed>0,'CPU/static replay receives same physical throw model');
    assert(th.arrive>th.release);
  }
}
{
  const {g,live}=setup();
  const h=live.test.fielders.find(f=>f.pos==='CF');
  h.x=0;h.y=390;
  live.test.ballState.x=h.x;live.test.ballState.y=h.y;
  live.test.pickUp(h);h.pickup=null;
  live.test.doThrow(h,4,false);
  const th=live.test.ballState.throwing;
  th.flight=E.flightSim(100,40,0,park,{origin:{x:0,y:390,z:5},thrown:true,spin:{b:0,s:0}});
  while(!live.done&&live.t<30) live.step(1/120);
  assert(live.done,'Out-of-play throw awards bases and does not leave an unfinishable play');
  const runner=live.snapshot().runners.find(r=>r.isBatter);
  assert(runner.base>=2 && !runner.out,'Batter gets two bases on throw out of play');
}
{
  let plays=0,throws=0;
  for(const arm of [20,50,90]) for(const [ev,la,dir] of [[90,12,-30],[105,15,25],[95,25,0],[110,10,-25],[100,30,30]]) {
    const {g}=setup();
    for(const p of g.teams[1].lineup) p.arm=arm;
    g.bases[1]={p:g.teams[0].lineup[2]};
    const ball=E.flightSim(ev,la,dir,g.park);
    if(ball.hr || ball.grd) continue;
    const live=E.createLivePlay(g,ball,{p:g.teams[0].lineup[0]},{batHuman:false,fieldHuman:false});
    while(!live.done&&live.t<75) live.step(1/120);
    assert(live.done,`AI field play settles with ARM ${arm}, ${ev}/${la}/${dir}`);
    const frame=live.snapshot();
    assert(frame.ball.mode==='held' && frame.ball.heldFor>=1.5);
    assert(frame.runners.every(r=>r.out||r.scored||r.state==='hold'));
    plays++;throws+=frame.throws.length;
  }
  assert(plays>=12 && throws>=12,'Exercise long live throws and cutoff/runner decisions across arm ratings');
}
const html=fs.readFileSync(path.join(__dirname,'index.html'),'utf8');
const renderSandbox={};
vm.runInNewContext(html.slice(html.indexOf('      function throwPathPoint('),html.indexOf('      function drawChip('))+';this.at=throwPathPoint;',renderSandbox);
const sample=[{t:0,x:0,y:0,z:5},{t:1,x:10,y:20,z:0},{t:2,x:15,y:30,z:2}];
for(const time of [0,0.5,1,1.5,3]) {
  const actual=renderSandbox.at(sample,time),expected=E.trajectoryPoint(sample,time);
  assert.deepEqual(JSON.parse(JSON.stringify(actual)),JSON.parse(JSON.stringify(expected)),'Replay interpolates recorded bounce heights exactly');
}
console.table(report);
console.log('Passed: fixed ARM release speed, angular/vertical accuracy, perfect throws, distance-based arc, skips/rolls/walls, cutoffs, live recovery and replay physics.');
