// Run: node test-shift-editor.js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const E = require('./game-engine.js');
const html = fs.readFileSync(require('node:path').join(__dirname, 'game.html'), 'utf8');
const coaching = html.slice(html.indexOf('<div id="coaching-options"'), html.indexOf('<div class="pitchinfo"'));
assert.match(html, /id="btn-coaching" aria-expanded="false" aria-controls="coaching-options">Coaching Options<\/button>/, 'Coaching uses an accessible button');
assert.match(coaching, /id="coaching-options" class="hidden"/, 'Coaching controls start collapsed');
const actionRow = html.slice(html.indexOf('<button class="primary" id="btn-pitch"'), html.indexOf('<div id="coaching-options"'));
assert(actionRow.includes('id="btn-coaching"'), 'Coaching toggle shares the playback button row');
const camera = html.slice(html.indexOf('<details id="camera-options">'),html.indexOf('</details>',html.indexOf('<details id="camera-options">')));
assert(camera.includes('aria-label="Camera options"') && camera.includes('<svg'), 'Camera menu uses a labeled camera symbol');
for(const id of ['camera-mode','btn-field-mode']) assert(camera.includes(`id="${id}"`),'Camera controls live in the camera menu');
assert(html.indexOf('<details id="camera-options">')<html.indexOf('<div id="chal-menu">'),'Camera menu is inside the field interface');
assert.match(html, /#camera-options \{ position:absolute; top:10px; right:10px;/,'Camera menu sits at top right');
for (const id of ['steal-row','coach-panel','shift-row','shift-custom','relay-row','decision','btn-challenge','chal-left']) {
  assert(coaching.includes(`id="${id}"`), `${id} is grouped under Coaching Options`);
  assert.equal(html.split(`id="${id}"`).length, 2, `${id} retains a single instance`);
}
for (const id of ['evla','timing-help','camera-mode','btn-pitch','btn-replay']) assert(!coaching.includes(`id="${id}"`),'Batting, camera and playback stay outside coaching');
assert.match(html, /else showCoaching\(true\);/, 'Field challenges open coaching controls');
const challengeElements = new Map();
let now=0, timers=[], coachingOpen=false, challenged=0, completed=0;
const challengeContext = vm.createContext({
  $: (id) => {
    if (!challengeElements.has(id)) challengeElements.set(id,{open:false,classList:{add(){}},style:{setProperty(){}}});
    return challengeElements.get(id);
  },
  performance: {now:()=>now}, resetUmpUI(){}, showOverlay(){}, refresh(){},
  showCoaching:(open)=>{coachingOpen=open;},
  E:{challengeCall(){challenged++;return {note:'Reviewed'};}},game:{},
  closeChallenge(){completed++;},
  requestAnimationFrame:()=>0, setTimeout:(fn,ms)=>{timers.push({fn,ms});return timers.length;}
});
vm.runInContext(`let chal;${html.slice(html.indexOf('    function openChallenge('),html.indexOf('    function closeChallenge('))}
  ${html.slice(html.indexOf('    function fireChallenge('),html.indexOf('    $("btn-challenge").addEventListener'))}
  openChallenge({kind:"field",calls:[]},()=>{},null);`,challengeContext);
assert.equal(coachingOpen,true,'Field challenge is reachable even when coaching was closed');
assert.equal(timers.length,0,'Field challenge has no auto-expiration timer');
now=120000;
vm.runInContext('fireChallenge("out")',challengeContext);
assert.equal(challenged,1,'Field challenge remains actionable after two minutes');
assert.equal(completed,1);
coachingOpen=false;
vm.runInContext('openChallenge({kind:"abs",calls:[]},()=>{},null)',challengeContext);
assert.equal(coachingOpen,false,'ABS keeps its existing strike-zone prompt instead of opening coaching');
assert.equal(timers.at(-1).ms,2000,'ABS expires at exactly two seconds');
now+=1999;
vm.runInContext('fireChallenge("abs")',challengeContext);
assert.equal(challenged,2,'ABS accepted just before two seconds');
now++;
vm.runInContext('fireChallenge("abs")',challengeContext);
assert.equal(challenged,2,'ABS rejected at the two-second deadline');
timers.at(-1).fn();
assert.equal(completed,3,'ABS expiration continues the game');
assert.match(html, /if \(current\.abs && !current\.menu\)/,'Replaying field calls does not introduce a countdown');
assert.match(html, /id="btn-abs"[^>]*>ABS challenge \(2s\)/,'ABS location and label retained');
assert(html.indexOf('id="btn-abs"')>html.indexOf('id="zone-overlay"')&&html.indexOf('id="btn-abs"')<html.indexOf('id="aim-ui"'),'ABS stays in the strike-zone overlay');
const source = html.slice(html.indexOf('    let shiftKey ='), html.indexOf('    /* ------------------------------------------------------------ umpire challenges */'));
const storage = new Map(), alerts = [];
let failStorage = false;
const elements = new Map();
function element(id) {
  if (!elements.has(id)) elements.set(id, {
    innerHTML: '', value: '', classList: { toggle() {}, add() {} },
    listeners: {}, addEventListener(type, listener) { this.listeners[type] = listener; },
    querySelectorAll() { return []; }
  });
  return elements.get(id);
}
function context() {
  const game = E.createGame({
    away: E.generateTeam('Away', 'balanced', 1),
    home: E.generateTeam('Home', 'balanced', 2),
    park: 'dodgers', seed: 10, coach: ['manual', 'manual']
  });
  game.teams[0].lineup[0].bats = 'R';
  return vm.createContext({
    E, game, phase: 'ready', holdView: false, liveRun: null,
    $: element, window: { addEventListener() {} }, console: { error() {} },
    alert: (message) => alerts.push(message), sendScene() {}, refresh() {},
    esc: (s) => String(s).replace(/[&<>"]/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])),
    localStorage: {
      getItem: (key) => storage.get(key) || null,
      setItem: (key, value) => { if (failStorage) throw new Error('Storage full'); storage.set(key, value); }
    }
  });
}
let c = context();
const run = (script) => vm.runInContext(script, c);
run(source);
run('renderCoach()');
assert.match(element('coach-panel').innerHTML, /id="btn-substitution"/);
assert.match(element('coach-panel').innerHTML, /id="substitution-options" class="hidden"/);
for (const action of ['ph', 'pc', 'ds']) assert.match(element('coach-panel').innerHTML, new RegExp(`data-act="${action}"`));
run('game.bases[0]={p:game.teams[0].lineup[1]};coachKey="";renderCoach()');
assert.match(element('coach-panel').innerHTML, /data-act="pr"/, 'Pinch running is inside the same substitution menu');
for (const preset of Object.keys(E.SHIFT_PRESETS).filter(id=>id!=='custom')) {
  run(`applyShift({preset:"${preset}",custom:{},mirror:false});shiftKey="";renderShift();`);
  assert.match(element('shift-custom').innerHTML,/Save preset changes/);
  const before=run('shiftPoint("CF",shiftSpec()).x');
  run(`moveShiftMarker("CF",${before+12},290)`);
  assert.equal(run('game.shifts[1-game.half].preset'),preset,'Editing retains preset identity');
  assert.equal(run('E.shiftedSpot(game,"CF",1,{bats:"R"}).x'),before+12);
  run(`persistPresetShifts({...presetShifts,["${preset}"]:{...shiftSpec(),preset:"${preset}",edited:true}})`);
}
run('applyShift({preset:"pull",custom:{},mirror:false});moveShiftMarker("SS",-55,140)');
element('shift-custom').listeners.click({target:{closest:()=>({dataset:{shiftAct:'save-preset'}})}});
assert.equal(run('presetShifts.pull.custom.SS.x'),-25,'Save button persists edited preset offsets');
assert.equal(run('E.shiftedSpot(game,"SS",1,{bats:"L"}).x'),-5,'Edited pull presets still mirror against lefties');
element('shift-row').listeners.change({target:{id:'shift-sel',value:'none'}});
element('shift-row').listeners.change({target:{id:'shift-sel',value:'pull'}});
assert.equal(run('E.shiftedSpot(game,"SS",1,{bats:"R"}).x'),-55,'Selecting preset restores saved positions');
element('shift-custom').listeners.click({target:{closest:()=>({dataset:{shiftAct:'reset-preset'}})}});
assert.equal(run('presetShifts.pull'),undefined,'Reset removes persistent override');
assert.equal(run('E.shiftedSpot(game,"SS",1,{bats:"R"}).x'),-52,'Reset restores original pull preset');
const reloaded=context();
vm.runInContext(source,reloaded);
vm.runInContext('renderShift()',reloaded);
assert.equal(vm.runInContext('game.shifts[1].edited',reloaded),true,'Saved default preset loads automatically in new games');
assert.equal(vm.runInContext('Object.keys(presetShifts).length',reloaded),9,'Preset edits and reset persist across reload');
run(`applyShift({preset:"custom",custom:{},mirror:false});renderShift();moveShiftMarker("CF",65,290);`);
assert.equal(run('shiftSpec().custom.CF.x'), 65);
assert.equal(run('shiftPoint("CF",shiftSpec()).y'), 290);
assert.equal(run('E.shiftedSpot(game,"CF",1,{bats:"R"}).x'), 65, 'Diagram positions drive the engine');
assert.equal((element('shift-custom').innerHTML.match(/data-fielder="/g) || []).length, 7);
assert(!element('shift-custom').innerHTML.includes('data-fielder="P"'));
assert(run(`persistShifts([{...shiftSpec(),id:"test",name:'Deep "pull"'}])`));
run('moveShiftMarker("CF",-40,310)');
assert.equal(run('savedShifts[0].custom.CF.x'), 65, 'Editing does not mutate saved positions');
c = context();
run(source);
assert.equal(run('savedShifts[0].name'), 'Deep "pull"', 'Names survive a reload');
run('applyShift({...savedShifts[0],preset:"custom"});selectedShift="test";renderShift()');
assert.equal(run('E.shiftedSpot(game,"CF",1,{bats:"R"}).x'), 65);
assert.match(element('shift-custom').innerHTML, /Deep &quot;pull&quot;/, 'Names safely render in attributes');
run('applyShift({...shiftSpec(),mirror:true})');
assert.equal(run('E.shiftedSpot(game,"CF",1,{bats:"L"}).x'), -65);
assert.equal(run('E.shiftedSpot(game,"CF",1,{bats:"R"}).x'), 65);
assert(run(`persistShifts(savedShifts.map(s=>({...s,name:"Renamed"})))`));
assert.equal(JSON.parse(storage.get('field-notes-custom-shifts-v1'))[0].name, 'Renamed');
failStorage = true;
assert.equal(run('persistShifts([])'), false);
assert.equal(run('savedShifts.length'), 1, 'Failed write preserves the saved library');
assert(alerts.some((s) => /Could not save/.test(s)), 'Storage errors are surfaced');
failStorage = false;
assert(run('persistShifts([])'));
assert.equal(run('savedShifts.length'), 0);
run('presetShifts.pull={preset:"custom",custom:{CF:{x:30,y:8}},mirror:true,edited:true}');
element('shift-row').listeners.change({target:{id:'shift-sel',value:'pull'}});
assert.equal(run('game.shifts[1-game.half].preset'), 'pull', 'Selected preset cannot be replaced by a saved record with a stale preset identity');
assert.match(element('shift-row').innerHTML, /<option value="pull" selected>/, 'Dropdown retains selected preset');
run('renderShift()');
assert.equal(run('game.shifts[1-game.half].preset'), 'pull', 'Repeated rendering preserves preset choice');
run('delete presetShifts.ofDeep');
element('shift-row').listeners.change({target:{id:'shift-sel',value:'ofDeep'}});
assert.equal(run('game.shifts[1-game.half].edited'), false, 'Switching to an original preset clears edited state');
assert.equal(run('E.shiftedSpot(game,"CF",1,E.currentBatter(game)).y-E.defaultSpot("CF",game.park).y'),25,'Original preset is usable after edited preset');
run('applyShift({preset:"custom",custom:{CF:{x:30,y:8},SS:{x:-20,y:4}},mirror:true});shiftKey="";renderShift()');
for (const hand of ['R','L']) {
  run(`E.currentBatter(game).bats="${hand}";renderShift()`);
  assert.match(element('shift-custom').innerHTML,new RegExp(`current ${hand==='L'?'left':'right'}-handed batter`),'Diagram updates on batter handedness changes');
  for (const pos of ['CF','SS']) {
    assert.equal(run(`shiftPoint("${pos}",shiftSpec()).x`),run(`E.shiftedSpot(game,"${pos}",1,E.currentBatter(game)).x`),'Diagram matches actual handedness-dependent engine position');
  }
}
run('moveShiftMarker("CF",45,290)');
assert.equal(run('game.shifts[1].custom.CF.x'),-45,'Lefty diagram drag converts back to canonical saved offsets');
assert.equal(run('shiftPoint("CF",shiftSpec()).x'),45,'Dragging a mirrored marker follows the pointer');
assert.equal(run('E.shiftedSpot(game,"CF",1,E.currentBatter(game)).x'),45,'Mirrored drag moves on-field defender to displayed point');
element('shift-custom').listeners.change({target:{id:'shift-mirror',checked:false}});
assert.equal(run('shiftPoint("CF",shiftSpec()).x'),-45,'Disabling mirroring visibly returns to unmirrored alignment');
element('shift-custom').listeners.change({target:{id:'shift-mirror',checked:true}});
assert.equal(run('shiftPoint("CF",shiftSpec()).x'),45,'Enabling mirroring reverses the offset exactly once');
run('E.currentBatter(game).bats="S";E.currentPitcher(game).throws="R";renderShift()');
assert.equal(run('shiftHand()'),'L','Switch hitter resolves left-handed against right-handed pitcher');
assert.equal(run('shiftPoint("CF",shiftSpec()).x'),45);
run('E.currentPitcher(game).throws="L";renderShift()');
assert.equal(run('shiftHand()'),'R','Pitching change updates switch-hitter alignment');
assert.equal(run('shiftPoint("CF",shiftSpec()).x'),-45);
for (const preset of Object.keys(E.SHIFT_PRESETS).filter(id=>id!=='custom')) {
  run(`E.currentBatter(game).bats="R";presetShifts={};`);
  element('shift-row').listeners.change({target:{id:'shift-sel',value:preset}});
  assert.equal(run('game.shifts[1].preset'),preset,'Every original preset stays selected');
  for(const hand of ['R','L']) {
    run(`E.currentBatter(game).bats="${hand}";renderShift()`);
    for(const pos of ['CF','SS','1B']) {
      assert.equal(run(`shiftPoint("${pos}",shiftSpec()).x`),run(`E.shiftedSpot(game,"${pos}",1,E.currentBatter(game)).x`),`${preset}: diagram and engine match against ${hand}HH`);
    }
  }
}
storage.set('field-notes-preset-shifts-v1',JSON.stringify({pull:{preset:'custom',custom:Object.fromEntries(['1B','2B','SS','3B','LF','CF','RF'].map(pos=>[pos,{x:10,y:0}])),mirror:true}}));
c=context();run(source);
assert.equal(run('presetShifts.pull.preset'),'pull','Loaded preset identity comes from its library key');
assert.equal(run('presetShifts.pull.edited'),true,'Saved offsets stay authoritative when loading older records');
console.log('Passed: coaching grouping, preset selection stability, mirrored diagram/dragging, both batting sides and switch hitters, saved presets, substitutions and storage errors.');
