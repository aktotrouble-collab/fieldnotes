// Run: node test-fielding-balance.js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { createRequire } = require('node:module');
const filename = path.join(__dirname, 'game-engine.js');
const sandbox = { module: { exports: {} }, require: createRequire(filename) };
vm.runInNewContext(fs.readFileSync(filename, 'utf8').replace('const GameEngine = {',
  'const GameEngine = { createLivePlay, defenseList, fieldBall, fieldProfile, readTarget, readFieldingRoutes, observedBall, throwMotion, throwSpread, transferSecs, flightSecs, seg, toFirst,'
), sandbox, { filename });
const E = sandbox.module.exports;
function game() {
  const g = E.createGame({ away: E.generateTeam('A','balanced',1),home:E.generateTeam('H','balanced',2),park:'dodgers',seed:10 });
  for (const team of g.teams) for (const p of [...team.lineup,...team.pitchers]) {
    p.speed=50; p.field=50; p.arm=50;
  }
  return g;
}
for (const speed of [20,50,80]) {
  const p={speed};
  assert(Math.abs(E.toFirst(p)-(0.12+E.runTime(90,90/E.seg(p),0.15)))<1e-9,'Live and simulated home-to-first agree');
  assert(E.toFirst(p)>3.7 && E.toFirst(p)<4.7,'Credible home-to-first range');
}
assert(E.toFirst({speed:80})<E.toFirst({speed:50}));
for (const start of [0,0.15,0.45,1]) for (const time of [0.1,0.9,1.8,3,5]) {
  assert(Math.abs(E.runTime(E.runDistance(time,27,start),27,start)-time)<1e-9,'Runner ETA inverts actual accelerated motion');
}
const html=fs.readFileSync(path.join(__dirname,'index.html'),'utf8');
const replayPoint=vm.runInNewContext(html.slice(html.indexOf('      function basePathPoint('),html.indexOf('      let labelRects ='))+';basePathPoint;',
  {GAME_BASES:[{x:0,y:0},{x:90/Math.SQRT2,y:90/Math.SQRT2},{x:0,y:90*Math.SQRT2},{x:-90/Math.SQRT2,y:90/Math.SQRT2},{x:0,y:0}]});
for (const time of [0,0.3,0.9,1.8,3,4.065]) {
  const p=replayPoint(0,1,time,3.3,{start:0.15,ramp:E.RUN_RAMP});
  assert(Math.abs(Math.hypot(p.x,p.y)-Math.min(90,E.runDistance(time,90/3.3,0.15)))<1e-8,'Replay uses live runner acceleration');
}
const g=game(),f=E.defenseList(g).find(f=>f.pos==='SS');
const target={x:f.x+90,y:f.y};
const aligned={...f,pickup:{vx:20,vy:0,backhand:0}};
const across={...f,pickup:{vx:-20,vy:0,backhand:1}};
assert(E.throwMotion(across,target).arm<E.throwMotion(aligned,target).arm,'Across-body backhand costs arm strength');
assert(E.throwMotion(across,target).spread>E.throwMotion(aligned,target).spread,'Across-body backhand costs accuracy');
assert(E.transferSecs(across,target)>E.transferSecs(f,target),'Moving backhand needs gather/transfer time');
assert(E.throwSpread(across,90,target)>E.throwSpread(aligned,90,target),'Actual throw scatter reflects throwing technique');
assert(E.flightSecs(across,90,target)>E.flightSecs(aligned,90,target),'Actual flight time reflects lost arm strength');
const ball=E.flightSim(85,0,10,g.park);
const altered={...ball,pts:ball.pts.map(p=>p.t<=0.9?{...p}:{...p,x:p.x+30,y:p.y-20})};
const defenders=E.defenseList(g);
const originalRoutes=E.readFieldingRoutes(ball,defenders,g.park);
const changedRoutes=E.readFieldingRoutes(altered,defenders,g.park);
for(const d of defenders) {
  const before=originalRoutes[d.pos].filter(p=>p[0]<=0.9);
  const after=changedRoutes[d.pos].filter(p=>p[0]<=0.9);
  assert.deepEqual(before,after,'Unseen future trajectory cannot change a fielder route');
  for(let i=1;i<originalRoutes[d.pos].length;i++) {
    const a=originalRoutes[d.pos][i-1],b=originalRoutes[d.pos][i];
    assert(Math.hypot(b[1]-a[1],b[2]-a[2])<=d.fp.vmax*(b[0]-a[0])+1e-8,'Observed routes respect fielder top speed');
    if(b[0]<d.fp.react) assert(Math.hypot(b[1]-a[1],b[2]-a[2])<1e-8,'No movement before reaction');
  }
}
assert(originalRoutes.SS.some((p,i)=>p[0]>1.2&&Math.hypot(p[1]-changedRoutes.SS[i][1],p[2]-changedRoutes.SS[i][2])>1),
  'Fielders correct routes after observing changed ball path');
const trackingReports = [];
for (const field of [20,50,90]) {
  const fp = E.fieldProfile({field,speed:50,arm:50});
  let error = 0, previousError = 0, samples = 0;
  for (const ev of [80,95,110]) for (const la of [22,35,50]) for (const dir of [-25,0,25])
    for (const spin of [{b:1,s:0},{b:0.6,s:0.8}]) for (const wind of [{x:0,y:0},{x:12,y:-8}]) {
      const fly = E.flightSim(ev,la,dir,g.park,{spin,wind,noFence:true});
      const landing = fly.pts[fly.firstLand];
      if (!landing) continue;
      for (const time of [0.6,1.2,2]) {
        if (time > landing.t-0.4) continue;
        const index = fly.pts.findIndex(p=>p.t>=time);
        const read = E.observedBall(fly,index,fp);
        const target = E.readTarget(read,{x:0,y:300,fp},time);
        const falling = (read.vz+Math.sqrt(read.vz**2+2*32.174*read.z))/32.174;
        const drift = (1-Math.exp(-0.12*(Math.min(3,falling)+read.age)))/0.12;
        error += Math.hypot(target.x-landing.x,target.y-landing.y);
        previousError += Math.hypot(read.x+read.vx*drift-landing.x,read.y+read.vy*drift-landing.y);
        samples++;
      }
    }
  const mean = error/samples, previousMean = previousError/samples;
  assert(Number.isFinite(mean) && mean<previousMean*0.75,'Observed drag/curve improves flight reads over coarse extrapolation');
  assert(mean>1,'Tracking remains imperfect, not exact future landing knowledge');
  trackingReports.push({field,meanError:+mean.toFixed(2),coarseError:+previousMean.toFixed(2),samples});
}
assert(trackingReports[2].meanError<trackingReports[0].meanError*0.9,'High FLD meaningfully improves flight estimates');
assert(trackingReports[1].meanError<trackingReports[0].meanError && trackingReports[2].meanError<trackingReports[1].meanError);
const low = E.fieldProfile({field:20,speed:50,arm:50}), high = E.fieldProfile({field:90,speed:50,arm:50});
assert(high.react<low.react,'High FLD reads contact sooner');
assert.equal(high.vmax,low.vmax,'Tracking skill does not change running speed');
const fly = E.flightSim(95,35,15,g.park,{noFence:true});
const redirected = {...fly,pts:fly.pts.map(p=>p.t<=1.2?{...p}:{...p,x:p.x+15})};
for (const fp of [low,high]) {
  const observer = {...defenders.find(f=>f.pos==='CF'),fp};
  const route = E.readFieldingRoutes(fly,[observer],g.park).CF;
  const other = E.readFieldingRoutes(redirected,[observer],g.park).CF;
  assert.deepEqual(route.filter(p=>p[0]<=1.2),other.filter(p=>p[0]<=1.2),'Air tracking cannot see future curvature or landing');
  for (let i=1;i<route.length;i++) {
    assert(route[i].slice(1).every(Number.isFinite),'Flight routes stay finite');
    assert(Math.hypot(route[i][1]-route[i-1][1],route[i][2]-route[i-1][2])<=fp.vmax*(route[i][0]-route[i-1][0])+1e-8);
  }
  const index=fly.pts.findIndex(p=>p.t>=1);
  assert(E.observedBall(fly,index,fp).age>0,'Even elite tracking uses delayed observations');
}
console.table(trackingReports);
const reports=[];
let movingReleases=0;
for(const dir of [-30,-20,-10,0,10,20,30]) {
  const g=game(),ball=E.flightSim(85,0,dir,g.park);
  const fr=E.fieldBall(ball,E.defenseList(g),{park:g.park});
  const live=E.createLivePlay(g,ball,{p:g.teams[0].lineup[0]},{batHuman:true,fieldHuman:true});
  live.command({kind:'throw',target:1});
  let pickup=null,pickupPoint=null,release=null,out=null,feet=null,first=null;
  while(!live.done&&live.t<15) {
    live.step(1/120);
    const frame=live.snapshot(),r=frame.runners.find(r=>r.isBatter);
    if(pickup===null&&frame.ball.mode==='held') {
      pickup=frame.t;
      pickupPoint={x:frame.ball.x,y:frame.ball.y};
    }
    if(release===null&&frame.throws.length) {
      const th=frame.throws[0];
      release=th.t0;
      if(pickupPoint&&Math.hypot(th.from.x-pickupPoint.x,th.from.y-pickupPoint.y)>1) movingReleases++;
    }
    if(first===null&&Math.hypot(r.x,r.y)>=89.9)first=frame.t;
    if(r.out) {out=frame.t;feet=Math.hypot(r.x,r.y);break;}
  }
  reports.push({dir,fielder:fr.f.pos,air:fr.air,planned:+fr.t.toFixed(2),pickup:pickup&&+pickup.toFixed(2),release:release&&+release.toFixed(2),out:out&&+out.toFixed(2),feet:feet&&+feet.toFixed(1),first:first&&+first.toFixed(2)});
  if(first) assert(Math.abs(first-E.toFirst(g.teams[0].lineup[0]))<0.025,'Actual home-to-first matches AI estimate');
}
const grounders=reports.filter(r=>!r.air);
assert(grounders.filter(r=>r.out!==null).length>=2,'Routine grounders can still produce outs');
assert(grounders.filter(r=>r.first!==null).length>=2,'Difficult grounders let runners beat throws');
assert(reports.find(r=>r.dir===10).feet>50,'Routine 2B grounder no longer retires batter a third down the line');
const shortstopRace=reports.find(r=>r.dir===-10);
assert(shortstopRace.feet>80 || shortstopRace.first!==null,'Difficult SS play produces a close race or a safe runner');
assert(movingReleases>=2,'Upright fielders can carry pickup momentum through release');
console.table(reports);
console.log('Passed: runner timing, moving-throw penalties, causal routes, improved flight estimates and FLD-based tracking.');
