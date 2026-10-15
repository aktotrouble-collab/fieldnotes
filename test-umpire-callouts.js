// Run: node test-umpire-callouts.js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const html=fs.readFileSync(path.join(__dirname,'index.html'),'utf8');
const drawn=[];
const context={
  save(){},restore(){},beginPath(){},roundRect(){},fill(){},stroke(){},
  fillText(text,x,y){drawn.push({text,x,y,alpha:this.globalAlpha});}
};
const sandbox={context,worldToScreen:p=>({x:p.x,y:p.y})};
vm.runInNewContext(html.slice(html.indexOf('      function drawUmpireCalls('),html.indexOf('      function drawLive('))+';this.draw=drawUmpireCalls;',sandbox);
const calls=[{t:2,out:true,x:100,y:100},{t:2.1,out:false,x:100,y:100}];
sandbox.draw(calls,1.9,600,400);
assert.equal(drawn.length,0,'Never display a call before its event');
sandbox.draw(calls,2.3,600,400);
assert.deepEqual(drawn.map(d=>d.text),['OUT!','SAFE!']);
assert(drawn[0].y!==drawn[1].y,'Overlapping calls stack instead of obscuring each other');
drawn.length=0;
sandbox.draw(calls,3.1,600,400);
assert(drawn.every(d=>d.alpha>0&&d.alpha<1),'Calls fade near the end of their lifetime');
drawn.length=0;
sandbox.draw(calls,3.4,600,400);
assert.equal(drawn.length,0,'Callouts fully disappear');
const lineCalls=[{t:2,label:'FAIR!',x:100,y:100},{t:2,label:'FOUL!',x:200,y:100}];
sandbox.draw(lineCalls,2.3,600,400);
assert.deepEqual(drawn.map(d=>d.text),['FAIR!','FOUL!']);
drawn.length=0;
assert.match(html,/drawUmpireCalls\(frame\.umpireCalls, frame\.t/,'Live and recorded frame playback share call timing');
assert.match(html,/drawUmpireCalls\(play\.umpireCalls, elapsed/,'Static simulated play also displays calls');
const filename=path.join(__dirname,'game-engine.js');
const engineSource=fs.readFileSync(filename,'utf8').replace('const GameEngine = {','const GameEngine = { foulLineCall, foulLimit,');
const engineSandbox={module:{exports:{}},require:require('node:module').createRequire(filename)};
vm.runInNewContext(engineSource,engineSandbox,{filename});
const E=engineSandbox.module.exports;
const park=E.parkById('dodgers');
for(const side of [-1,1]) {
  const angle=side*E.foulLimit(park,side)*Math.PI/180;
  const point=(radius,offset,t)=>({x:radius*Math.sin(angle)+offset*Math.cos(angle),y:radius*Math.cos(angle)-offset*Math.sin(angle),z:0,t});
  for(const offset of [-3,-2.99,0,2.99,3]) {
    const p=point(200,offset,2);
    const ball={pts:[{t:0,x:0,y:0,z:3},p],firstLand:1,wallHit:-1};
    const call=E.foulLineCall(ball,park,true);
    assert(call,'Landing within three perpendicular feet triggers a call on either side');
    assert.equal(call.t,2);
    assert.equal(call.label,'FAIR!');
    assert.equal(E.foulLineCall(ball,park,false).label,'FOUL!','Use the on-field ruling, not geometric truth');
    assert.equal(E.foulLineCall({...ball,hr:true},park,true),null,'No landing call on a home run');
    assert.equal(E.foulLineCall({...ball,wallHit:0},park,true),null,'Do not call landing after a wall collision');
  }
  for(const offset of [-3.01,3.01,20]) {
    assert.equal(E.foulLineCall({pts:[point(200,offset,2)],firstLand:0,wallHit:-1},park,true),null,'Outside three feet stays quiet');
  }
  const ground={pts:[point(0,0,0),point(40,10,1),point(80,0,2),point(100,0,3)],firstLand:1,wallHit:-1};
  const call=E.foulLineCall(ground,park,true);
  assert(call && call.t>2 && call.t<3,'A grounder waits until it crosses the bag line');
  assert(Math.abs(call.y-90*Math.cos(angle))<1e-8);
  const fly={pts:[point(0,0,0),point(80,0,1),point(200,0,3)],firstLand:2,wallHit:-1};
  assert.equal(E.foulLineCall(fly,park,true).t,3,'Airborne balls wait for landing, not crossing the bag in flight');
  for(const fair of [true,false]) {
    const direction=side*(E.foulLimit(park,side)+(fair?-0.2:0.2));
    const flight=E.flightSim(85,30,direction,park);
    assert(flight.lineCall,'Actual close-line flight carries the call into playback');
    assert.equal(flight.lineCall.label,flight.fair?'FAIR!':'FOUL!');
    assert.equal(flight.lineCall.t,flight.pts[flight.firstLand].t);
  }
}
assert.match(fs.readFileSync(path.join(__dirname,'game.html'),'utf8'),/flight\.lineCall/,'Foul playback forwards close-line calls');
console.log('Passed: OUT/SAFE/FAIR/FOUL text, timing, fade, stacking, three-foot threshold, landing/crossing and replay hookups.');
