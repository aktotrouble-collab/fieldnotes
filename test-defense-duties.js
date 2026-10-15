// Run: node test-defense-duties.js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {createRequire} = require('node:module');
const filename = path.join(__dirname,'game-engine.js');
const source = fs.readFileSync(filename,'utf8').replace(/\r\n/g,'\n')
  .replace('const GameEngine = {','const GameEngine = { fieldBall, defenseList, fieldProfile, supportPlan, createLivePlay, flightSecs, trajectoryPoint,')
  .replace('    return live;\n  }\n\n  const GameEngine',
    '    live.test={fielders,entries,ballState,pickUp,doThrow,covers,replan};\n    return live;\n  }\n\n  const GameEngine');
const sandbox = {module:{exports:{}},require:createRequire(filename)};
vm.runInNewContext(source,sandbox,{filename});
const E=sandbox.module.exports;
function game() {
  return E.createGame({away:E.generateTeam('A','balanced',1),home:E.generateTeam('H','balanced',2),park:'dodgers',seed:10});
}
const g=game(),defenders=E.defenseList(g);
const order=['CF','LF','RF','SS','2B','3B','1B','C','P'];
const fp=E.fieldProfile({field:80,speed:50,arm:50});
const popup={pts:[{t:0,x:0,y:0,z:3},{t:4,x:0,y:200,z:5},{t:5,x:0,y:200,z:0}],firstLand:2,wallHit:-1};
for(let i=0;i<order.length;i++) {
  const fielders=order.slice(i).reverse().map(pos=>({pos,p:{field:80,throws:'R'},fp,x:0,y:200}));
  const catchPlan=E.fieldBall(popup,fielders);
  assert.equal(catchPlan.f.pos,order[i],'Controlled overlaps use the requested positional priority, not array order');
}
for(const [caller,challenger] of [['LF','CF'],['SS','CF'],['2B','SS'],['C','1B'],['P','C']]) {
  const fielders=[
    {pos:challenger,p:{field:80,throws:'R'},fp,x:30,y:200},
    {pos:caller,p:{field:80,throws:'R'},fp,x:0,y:200}
  ];
  assert.equal(E.fieldBall(popup,fielders).f.pos,caller,'A clearly camped caller is not displaced by higher positional priority');
  assert.equal(E.fieldBall(popup,fielders.slice().reverse()).f.pos,caller,'Clear ownership does not depend on iteration order');
}
{
  const ball=E.flightSim(85,45,-20,g.park),landing=ball.pts[ball.firstLand];
  const fielders=['CF','LF'].map(pos=>({
    ...defenders.find(f=>f.pos===pos),x:landing.x+(pos==='CF'?45:0),y:landing.y
  }));
  assert.equal(E.fieldBall(ball,fielders,{park:g.park}).f.pos,'LF',
    'Actual observed-flight routes preserve the camped left fielder instead of summoning CF');
}
{
  const shallow={...popup,pts:[popup.pts[0],{t:2,x:0,y:80,z:5},{t:3,x:0,y:80,z:0}]};
  const fielders=['SS','CF'].map(pos=>({pos,p:{field:80,throws:'R'},fp,x:0,y:80}));
  assert.equal(E.fieldBall(shallow,fielders).f.pos,'SS','Infielder keeps the shallow popup');
  const fieldersFar=defenders.map(f=>f.pos==='CF'||f.pos==='LF'||f.pos==='RF'?{...f,x:400,y:400}:f);
  const ball=E.flightSim(65,60,-20,g.park);
  assert(['SS','2B','3B','1B','C','P'].includes(E.fieldBall(ball,fieldersFar,{park:g.park}).f.pos),
    'Infielders still take balls when outfield cannot make a controlled catch');
}
for(const [ev,la] of [[85,60],[95,60],[95,45]]) {
  const ball=E.flightSim(ev,la,-20,g.park);
  const fr=E.fieldBall(ball,defenders,{park:g.park});
  assert(['CF','LF','RF'].includes(fr.f.pos),'High left-center fly belongs to an outfielder, not a sprinting shortstop');
  assert(fr.air && !fr.move,'Call-off uses a controlled, upright catch');
}
{
  const fielders=defenders.map(f=>({...f,hx:f.x,hy:f.y,speed:f.fp.speed}));
  const free=new Set(fielders.filter(f=>f.pos!=='LF').map(f=>f.pos));
  const assignments=E.supportPlan({park:g.park,fielders,free,ball:{x:-130,y:290},bases:[2],lead:2,thrower:{x:-130,y:290}});
  for(const base of [1,2,3,4]) assert(Object.values(assignments).some(p=>p.job==='cover'&&p.base===base),
    'An outfield play keeps every bag covered before a runner decides to stretch');
  assert(Object.values(assignments).some(p=>p.job==='cutoff'),'Coverage still leaves an infielder for relay duty');
  assert.equal(assignments['3B'].job,'cover');
  assert.equal(assignments['3B'].base,3,'Third baseman stays at third rather than joining a needless cutoff chain');
}
{
  const ball=E.flightSim(95,60,-20,g.park);
  const live=E.createLivePlay(g,ball,{p:g.teams[0].lineup[0]},{batHuman:true,fieldHuman:true});
  live.command({kind:'throw',target:'hold'});
  while(!live.done&&live.t<3) live.step(1/120);
  const frame=live.snapshot();
  const shortstop=frame.fielders.find(f=>f.pos==='SS');
  assert(shortstop.y<190,'Called-off shortstop stays available in the infield');
  const third=frame.fielders.find(f=>f.coverBase===3);
  assert(third && Math.hypot(third.x+90/Math.SQRT2,third.y-90/Math.SQRT2)<3,'Third is already covered during the high fly');
}
for(const dir of [-30,0,30]) {
  const g=game();
  g.bases[1]={p:g.teams[0].lineup[1]};
  const ball=E.flightSim(110,8,dir,g.park);
  const live=E.createLivePlay(g,ball,{p:g.teams[0].lineup[0]},{batHuman:true,fieldHuman:true});
  live.command({kind:'throw',target:'hold'});
  while(!live.done&&live.t<4) live.step(1/120);
  const frame=live.snapshot(),target={x:-90/Math.SQRT2,y:90/Math.SQRT2};
  assert(frame.fielders.some(f=>Math.hypot(f.x-target.x,f.y-target.y)<3),
    'Third is physically covered on routine outfield hits to left, center and right');
  assert(frame.fielders.some(f=>f.job==='cutoff'||f.has),'Other defenders handle relay/ball duties while third stays covered');
}
for(const step of [1/60,1/120,1/240]) {
  const g=game(),ball=E.flightSim(85,0,10,g.park);
  const live=E.createLivePlay(g,ball,{p:g.teams[0].lineup[0]},{batHuman:true,fieldHuman:true});
  const {fielders,entries,ballState,pickUp,covers}=live.test;
  const h=fielders.find(f=>f.pos==='SS'),receiver=fielders.find(f=>f.pos==='3B');
  const target={x:-90/Math.SQRT2,y:90/Math.SQRT2};
  for(const f of fielders) {f.run=null;f.move=null;f.dest=null;f.x=150;f.y=150;}
  h.x=0;h.y=180;
  receiver.x=target.x-45;receiver.y=target.y+60;
  ballState.x=h.x;ballState.y=h.y;
  pickUp(h);h.pickup=null;
  for(const e of entries) {e.prog=e.target=e.reached=2;e.state='hold';}
  covers[3]=receiver;
  live.command({kind:'throw',target:3});
  live.test.doThrow(h,3,false);
  assert.equal(ballState.mode,'held','Uncovered bag does not cause a premature throw');
  assert.equal(h.playBase,3);
  assert(h.dest && receiver.dest,'Holder carries and receiver runs to cover');
  const start={x:h.x,y:h.y};
  let checked=false;
  while(!live.done&&live.t<25) {
    live.step(step);
    if(!checked&&ballState.mode==='thrown') {
      const th=ballState.throwing;
      assert(Math.hypot(th.from.x-start.x,th.from.y-start.y)>5,'Thrower carries toward the play before release');
      const receiverEta=Math.max(0,Math.hypot(th.receiver.x-target.x,th.receiver.y-target.y)-th.receiver.fp.reach)/th.receiver.fp.speed;
      assert(receiverEta<=th.flight.duration+0.02,'Normal-speed throw cannot outrun its planned coverage');
      assert.equal(th.flight.speed,th.thrower.fp.armFps,'Coverage does not artificially slow the release speed');
      checked=true;
    }
    if(ballState.mode==='thrown') {
      const th=ballState.throwing,p=E.trajectoryPoint(th.flight.pts,live.t-th.t0);
      assert(Math.hypot(p.x-ballState.x,p.y-ballState.y,p.z-ballState.z)<1e-8,'Ball follows physics regardless of receiver location');
    }
  }
  assert(live.done,'Carry-and-deliver play settles');
  assert(checked || Math.hypot(h.x-target.x,h.y-target.y)<2,'Holder either releases a viable throw or reaches the bag himself');
}
{
  const g=game(),live=E.createLivePlay(g,E.flightSim(85,0,10,g.park),{p:g.teams[0].lineup[0]},{batHuman:true,fieldHuman:true});
  const h=live.test.fielders.find(f=>f.pos==='3B');
  h.run=null;h.move=null;h.x=-90/Math.SQRT2+5;h.y=90/Math.SQRT2;
  live.test.pickUp(h);h.pickup=null;
  for(const e of live.test.entries) {e.prog=e.target=e.reached=2;e.state='hold';}
  live.command({kind:'throw',target:3});
  while(!live.done&&live.t<10) live.step(1/120);
  assert(live.done);
  assert.equal(live.snapshot().throws.length,0,'Nearby holder takes the bag himself instead of tossing to an absent receiver');
  assert(Math.hypot(h.x+90/Math.SQRT2,h.y-90/Math.SQRT2)<2);
}
console.log('Passed: positional call-offs, shallow/deep ownership, proactive third/base coverage, cutoff duties and carrying before normal-speed throws at three frame rates.');
