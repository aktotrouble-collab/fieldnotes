// Run: node test-click-contact.js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const filename = path.join(__dirname, 'game-engine.js');
const sandbox = { module: { exports: {} }, require: createRequire(filename) };
vm.runInNewContext(fs.readFileSync(filename, 'utf8').replace(
  'const GameEngine = {', 'const GameEngine = { battedBallFrom, swingQuality,'
), sandbox, { filename });
const E = sandbox.module.exports;
const batter = { bats: 'R', power: 50, loft: 12 };
const pitcher = { throws: 'R' }, pitch = { mph: 92, x: 0 };
function hit(x, z, timing = 0, seed = 1, bats = 'R', loft = 12, pitchX = 0, throws = 'R') {
  const swing = { timing, loc: Math.hypot(x,z)*0.6, offset: { x,z } };
  const b = { ...batter,bats,loft }, p = { ...pitcher, throws }, ball = { ...pitch,x:pitchX };
  return E.battedBallFrom({ rng: E.makeRng(seed) }, b, p, ball, swing, E.swingQuality(swing,b,p,ball));
}
const correlation = (xs,ys) => {
  const mean = a => a.reduce((s,n)=>s+n,0)/a.length;
  const mx=mean(xs),my=mean(ys);
  return xs.reduce((s,x,i)=>s+(x-mx)*(ys[i]-my),0) /
    Math.sqrt(xs.reduce((s,x)=>s+(x-mx)**2,0)*ys.reduce((s,y)=>s+(y-my)**2,0));
};
const offsets=[],angles=[];
for(let seed=1;seed<=200;seed++) {
  const z=-3+6*(seed-1)/199;
  offsets.push(-z); angles.push(hit(0,z,0,seed).la);
  const center=hit(0,0,0,seed);
  assert(center.ev>hit(1,0,0,seed).ev);
  assert(hit(1,0,0,seed).ev>hit(2,0,0,seed).ev);
  assert.equal(hit(1,0,0,seed).ev,hit(0,1,0,seed).ev,'EV depends on radial centering, not offset axis');
  assert(center.ev>hit(0,0,25,seed).ev+10,'Mistiming reduces EV even on centered contact');
  assert.equal(hit(0,0,-25,seed).ev,hit(0,0,25,seed).ev,'EV penalty is symmetric around prime contact');
  assert.equal(center.la,hit(0,0,25,seed).la,'Timing does not disturb click-driven LA');
  assert.equal(hit(0,1,0,seed).la,hit(2,1,0,seed).la,'Horizontal misses do not alter launch angle');
  assert.equal(center.la,hit(0,0,0,seed,'R',60).la,'Manual click overrides batter loft tendency');
  assert(Math.abs(center.la-12)<=1,'LA randomness is at most one degree');
  assert(Math.abs(center.ev-(0.2*92+1.2*69))<=2,'EV wiggle is at most two mph');
  assert(hit(-1,0,0,seed).dir>center.dir && hit(1,0,0,seed).dir<center.dir,'Horizontal offset steers spray');
  for(const bats of ['R','L']) {
    const early=hit(0,0,-20,seed,bats),late=hit(0,0,20,seed,bats);
    assert(bats==='R'?early.dir<late.dir:early.dir>late.dir,'Early pulls; late goes opposite for each batting side');
    assert(Math.abs(early.dir-late.dir)>60,'Timing has a strong directional effect');
  }
}
assert(correlation(offsets,angles)>0.999,'Vertical click offset almost entirely determines launch angle');
assert(E.swingQuality({timing:100,loc:0})<=0,'Impossible timing still misses');
assert(E.swingQuality({timing:0,loc:5})<=0,'Far-off clicks still miss');
for (const bats of ['R','L','S']) {
  for (const throws of ['R','L']) {
    const b={...batter,bats},p={throws};
    const side=E.batSide(b,p);
    const insideX=side==='R'?-0.8:0.8;
    const inside={mph:92,x:insideX},outside={mph:92,x:-insideX};
    const early=E.primeContactTiming(b,p,inside),late=E.primeContactTiming(b,p,outside);
    assert(early<0 && late>0,'Inside prime is earlier; outside prime is deeper for each matchup');
    assert.equal(early,-late,'Handedness mirrors the timing target');
    for(const ball of [inside,outside]) {
      const prime=E.primeContactTiming(b,p,ball);
      const contact=t=>hit(0,0,t,1,bats,12,ball.x,throws);
      assert(contact(prime).ev>contact(prime-20).ev+8);
      assert(contact(prime).ev>contact(prime+20).ev+8);
      const swing={timing:prime,loc:0,offset:{x:0,z:0}};
      assert.equal(E.swingQuality(swing,b,p,ball),1,'Contact gate agrees with EV sweet spot');
      assert(E.swingQuality({...swing,timing:prime+63},b,p,ball)<=0,'Miss window tracks pitch-dependent prime');
      const scan=Array.from({length:121},(_,i)=>i-60);
      const peak=scan.reduce((best,t)=>contact(t).ev>contact(best).ev?t:best,scan[0]);
      assert(Math.abs(peak-prime)<0.51,'Measured EV peak matches prime contact within half a millisecond');
    }
    assert.equal(Math.abs(E.primeContactTiming(b,p,{mph:92,x:0})),0);
    assert(Math.abs(E.primeContactTiming(b,p,{mph:100,x:insideX}))<Math.abs(early),'Faster pitch covers contact depth in less time');
  }
}
const html=fs.readFileSync(path.join(__dirname,'game.html'),'utf8');
const game=E.createGame({away:E.generateTeam('Away','balanced',1),home:E.generateTeam('Home','balanced',2),park:'dodgers',seed:10});
const ctx=vm.createContext({ E, game, performance:{now:()=>1100}, phase:'await',mode:()=> 'timing',resolveManual:s=>{ctx.result=s;} });
vm.runInContext(`
const BREAK={FB:{x:-0.12,z:0.3},SL:{x:0.65,z:-0.35},CH:{x:-0.4,z:-0.5},CB:{x:0.25,z:-1.1}};
const EYE_Z=2.6,PERSPECTIVE=6.1,TIMING_REF=31;
let feedback=null;
let timing={pitch:{x:0.6,z:2.1,type:"SL",hand:"R",mph:92},start:0,duration:1000,slow:2,swung:null};
${html.slice(html.indexOf('    function pitchPos('),html.indexOf('    function timingLoop('))}
${html.slice(html.indexOf('    const timingProgress ='),html.indexOf('    const TIMING_REF ='))}
`,ctx);
for(const time of [960,1000,1040]) {
  vm.runInContext(`timing.swung=null;swingAt(${time},timingBallPosition(timing.pitch,${time}/1000));`,ctx);
  assert.equal(ctx.result.offset.x,0,'Click uses visible ball, not future plate crossing');
  assert.equal(ctx.result.offset.z,0);
  assert.equal(ctx.result.timing,(time-1000)/2,'Real timing respects slow-motion difficulty');
}
vm.runInContext('timing.swung=null;swingAt(1000,{x:0.6,z:2.1-1/12});',ctx);
assert(Math.abs(ctx.result.offset.z+1)<1e-9,'Below-ball click produces negative vertical offset');
assert(hit(0,-1).la>hit(0,0).la,'Below-ball click lifts contact');
assert(hit(0,1).la<hit(0,0).la,'Above-ball click drives groundward');
vm.runInContext(`
timing.swung=null;
const prime=E.primeContactTiming(E.currentBatter(game),E.currentPitcher(game),timing.pitch);
const ideal=1000+prime*timing.slow;
swingAt(ideal,timingBallPosition(timing.pitch,ideal/1000));
`,ctx);
assert.equal(vm.runInContext('timing.swung.grade',ctx),'Perfect','Feedback grades relative to location-dependent prime');
assert.match(vm.runInContext('timing.swung.text',ctx),/on time/);
console.log('Passed: click-driven LA, centering plus timing EV, inside/outside EV peaks, mirrored and switch-hitter matchups, shifted miss windows, timing feedback and visible-ball targeting.');
