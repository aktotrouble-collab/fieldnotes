// Run: node test-franchise.js
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const E=require('./game-engine.js'),L=require('./league-engine.js'),F=require('./franchise.js'),A=require('./all-star.js'),M=require('./mlb-schedule.js');
const clone=v=>JSON.parse(JSON.stringify(v));
function fixture(franchise={},extra={}) {
  return L.createLeague({seed:147,teams:L.generatedDescriptors(2),settings:{gamesPerTeam:8,innings:1,bench:3,rotation:3,bullpen:3,playoffs:{enabled:false},franchise:{aging:true,injuries:false,trades:false,draftRounds:2,...franchise},...extra}});
}
function legal(l) {
  for(const t of l.teams) {
    assert.deepEqual(E.validateTeam({name:t.name,...t.roster,pitchers:[...t.roster.rotation,...t.roster.bullpen]}),[]);
    assert.equal(t.roster.rotation.length,l.settings.rotation);
    assert.equal(t.roster.bullpen.length,l.settings.bullpen);
    assert.equal(t.roster.bench.length,l.settings.bench);
    for(const {player,slot}of F.allTeam(t)) {
      const m=l.franchise.people[F.id(player)];
      assert(m);
      assert.equal(m.age,player.age);
      assert(Number.isFinite(F.overall(player)));
      if(slot!=='il')assert(!m.injury,'Injured players cannot remain active or on the farm');
      if(slot!=='il'&&slot!=='farm')assert(m.contract?.salary>=F.minimum(l.franchise.year));
    }
  }
}
function finish(l) {
  for(let n=0;n<100&&l.phase!=='done';n++)L.simDay(l);
  assert.equal(l.phase,'done');
}
function off(l) {while(F.offseasonStart(l).stage<5)F.advanceOffseason(l);}
function snapshot(l) {
  return {
    teams:l.teams.map(t=>F.allTeam(t).map(({player:p,slot})=>({name:p.name,slot,age:p.age,overall:F.overall(p),potential:F.scout(l,p)}))),
    people:Object.values(l.franchise.people).map(m=>({name:m.name,age:m.age,potential:m.potential,peak:m.peak,contract:m.contract})),
    results:l.log.map(({id,...row})=>row)
  };
}
const base=fixture(),same=fixture();
assert.deepEqual(snapshot(base),snapshot(same),'Seed reproducibility must not depend on the randomly generated league ID');
assert.equal(base.teams[0].farm.length,10);
assert.equal(base.franchise.picks.length,8);
assert(base.franchise.picks.every(p=>p.year===2026||p.year===2027),'Only draft years that will actually be held can be traded');
assert(base.franchise.freeAgents.length>0,'Opening-day market is usable');
legal(base);
assert.throws(()=>fixture({injuryRisk:11}),/frequency/);
assert.throws(()=>fixture({draftRounds:1.5}),/rounds/);
assert.throws(()=>fixture({budget:0}),/Budgets/);
assert.throws(()=>fixture({taxRate:-1}),/rates/);
assert.throws(()=>fixture({tradeDeadline:1}),/deadline/);

for(const file of ['players-data.js','seasons\\players-2015.js','seasons\\players-2016.js']) {
  const context={window:{}};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,file),'utf8'),context);
  const data=context.window.MLB_PLAYERS||Object.values(context.window.MLB_SEASONS)[0];
  for(const p of [...data.batters,...data.pitchers]) {
    assert.match(p.birthDate,/^\d{4}-\d{2}-\d{2}$/);
    assert.equal(p.age,E.playerAge(p,`${data.year}-07-01`));
    assert(p.age>=16&&p.age<60);
  }
  const real=L.createLeague({source:'mlb',year:data.year,seed:2,teams:L.mlbDescriptors(['NYY','LAD']),settings:{gamesPerTeam:2,playoffs:{enabled:false},franchise:{aging:true,startYear:data.year,draftRounds:1}}},data);
  legal(real);
  if(data.year===2015||data.year===2016)assert(Object.values(real.franchise.people).some(m=>m.contract?.source.startsWith('Lahman')),'Selected-year annual salaries are used when available');
  assert.throws(()=>L.createLeague({source:'mlb',teams:L.mlbDescriptors(['NYY','LAD']),settings:{franchise:{aging:true,startYear:data.year+1}}},data),/starting year/);
}
assert.equal(E.playerAge({mlb:592450},'2015-07-01'),23);
assert.equal(E.playerAge({mlb:592450,age:40}),40,'Saved league age takes precedence without an explicit historical reference');
assert.equal(E.playerAge({mlb:592450,age:40},'2025-07-01'),33);
const prospectData=require('./minor-league-prospects.js');
for(const year of [2015,2016])for(const [team,players]of Object.entries(prospectData[year])) {
  assert(players.length>0);
  assert.equal(new Set(players.map(p=>p.id)).size,players.length,'A notable prospect belongs to only one affiliate/club');
  for(const p of players) {
    assert.equal(p.team,team);
    assert.equal(p.prospectSourceYear,year);
    assert(p.prospectDebut>=`${year}-04-01`,'All historical farm prospects made their first MLB debut after that season began');
    assert(p.prospectPotential && Object.values(p.prospectPotential).every(Number.isFinite));
    assert(p.prospectCareer.pa>=1000||p.prospectCareer.hits>=600||p.prospectCareer.homeRuns>=100||p.prospectCareer.stolenBases>=100||p.prospectCareer.innings>=300||p.prospectCareer.games>=150||p.prospectCareer.strikeouts>=300||p.prospectCareer.saves>=50,'Only substantial MLB careers graduate from the historical prospect list');
  }
}
assert(prospectData[2015].NYY.some(p=>p.name==='Aaron Judge'));
assert(prospectData[2015].HOU.some(p=>p.name==='Alex Bregman'));
assert(prospectData[2015].LAD.some(p=>p.name==='Cody Bellinger'));
assert(prospectData[2016].HOU.some(p=>p.name==='Yordan Alvarez'));
assert(prospectData[2016].WSH.some(p=>p.name==='Juan Soto'));
const realStart=L.createLeague({source:'mlb',year:2015,seed:994,teams:L.mlbDescriptors(['NYY','LAD']),settings:{gamesPerTeam:4,innings:1,playoffs:{enabled:false},franchise:{aging:true,startYear:2015,draftRounds:1}}},loadSeason('2015'));
function loadSeason(year) {
  const context={window:{}};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,`seasons\\players-${year}.js`),'utf8'),context);
  return context.window.MLB_SEASONS[year];
}
const yankeeFarm=realStart.teams[0].farm.map(p=>p.name),dodgerFarm=realStart.teams[1].farm.map(p=>p.name);
assert(yankeeFarm.includes('Aaron Judge')&&yankeeFarm.includes('Gary Sánchez'));
assert(dodgerFarm.includes('Cody Bellinger'));
const judge=realStart.teams[0].farm.find(p=>p.name==='Aaron Judge'),judgeMeta=realStart.franchise.people[F.id(judge)];
assert(judgeMeta.prospect&&judgeMeta.prospectAffiliate==='Scranton/Wilkes-Barre RailRiders');
assert(judgeMeta.potential.power>=judge.power+5&&judgeMeta.potential.power>=90,'Peak MLB outcomes inform intentionally elevated future prospect upside');
assert.equal(judgeMeta.contract.salary,0,'Historical farm prospects start on a modeled minor-league contract');
assert(!F.roster(realStart.teams[0]).some(e=>F.id(e.player)===F.id(judge)));
const promotionCheck=clone(realStart);
finish(promotionCheck);off(promotionCheck);L.nextSeason(promotionCheck);
assert.notEqual(F.locate(promotionCheck,'m592450')?.slot,'farm','Historical prospects must become eligible for CPU promotion as they develop');
function named(year,mlb) {
  const teams=L.generatedDescriptors(2);
  const template=E.generateTeam('Facts','balanced',17);
  template.lineup[0].mlb=mlb;
  template.lineup[0].age=E.playerAge({mlb},`${year}-07-01`);
  teams[0].roster=template;
  return L.createLeague({teams,seed:3,settings:{gamesPerTeam:2,playoffs:{enabled:false},franchise:{aging:true,startYear:year,draftRounds:1}}});
}
assert(!named(2015,592450).franchise.people.m592450.contract.source.startsWith('Reported'),'Later guarantees cannot leak into an earlier start');
assert.equal(named(2025,592450).franchise.people.m592450.contract.salary,40000000);
assert.equal(named(2025,592450).franchise.people.m592450.contract.end,2031);
assert.equal(named(2025,605141).franchise.people.m605141.contract.end,2032);

let injured=fixture({injuries:true,autoManage:false},{myTeam:0});
const bat=injured.teams[0].roster.lineup[0],pitch=injured.teams[1].roster.rotation[0];
const bi=F.injure(injured,0,F.id(bat),{name:'Back tightness',type:'muscle'},3);
const pi=F.injure(injured,1,F.id(pitch),{name:'Forearm strain',type:'arm'},4);
assert.equal(bi.il,10);assert.equal(pi.il,15);
assert(!injured.teams[0].roster.lineup.some(p=>F.id(p)===F.id(bat)));
assert.throws(()=>F.activate(injured,0,F.id(bat)),/minimum IL/);
injured=clone(injured);
for(let i=0;i<15;i++){injured.clock=i;F.dayEnd(injured);F.dayEnd(injured);}
assert.equal(injured.teams[1].il.length,0,'CPU activates after recovery and minimum IL time');
assert.equal(injured.teams[0].il.length,1,'Manual club retains eligible players for user activation');
assert.equal(injured.franchise.people[F.id(bat)].injury.remaining,0);
F.activate(injured,0,F.id(bat));legal(injured);
const concussion=fixture(),ck=F.id(concussion.teams[0].roster.bench[0]);
assert.equal(F.injure(concussion,0,ck,{name:'Concussion',type:'concussion'},7).il,7);
const long=fixture(),lk=F.id(long.teams[0].roster.rotation[0]);
assert.equal(F.injure(long,0,lk,{name:'Elbow surgery',type:'surgery'},400).il,60);
finish(long);off(long);
const remaining=long.franchise.people[lk].injury.remaining;
L.nextSeason(long);
assert.equal(long.franchise.people[lk].injury.remaining,Math.max(0,remaining-120));

function injuryCounts(risk) {
  const template=fixture({injuries:true,injuryRisk:risk});
  let total=0;
  for(let trial=0;trial<1000;trial++) {
    const l=clone(template),ref={id:`exposure-${trial}`,away:0,home:1};
    const sides=l.teams.map(t=>({bat:t.roster.lineup.map(p=>({...p,stat:{pa:4}})),pit:t.roster.rotation.slice(0,2).map(p=>({...p,stat:{pc:90}}))}));
    F.afterGame(l,ref,{sides});
    total+=Object.values(l.franchise.people).filter(p=>p.injury).length;
  }
  return total;
}
const low=injuryCounts(1),high=injuryCounts(10);
assert(low>0&&high>100&&high>low*4,`Measured injury exposure must scale materially: low ${low}, high ${high}`);
console.log(`Injury exposure sample: risk 1 = ${low}, risk 10 = ${high} injuries / 22,000 player-game exposures.`);

const trade=fixture({trades:true}),pa=trade.teams[0].roster.bench[0],pb=trade.teams[1].roster.bench[0];
const pending=F.proposeTrade(trade,0,1,[F.id(pa)],[F.id(pb)],true);
F.dayStart(trade);
assert.equal(pending.status,'pending');
assert.equal(F.locate(trade,F.id(pa)).team,0);
assert.throws(()=>F.proposeTrade(trade,0,1,[F.id(pa)],[F.id(pb)],true),/pending trade/);
F.veto(trade,pending.id);trade.clock++;trade.day++;F.dayStart(trade);
assert.equal(F.locate(trade,F.id(pa)).team,0);
const pickA=trade.franchise.picks.find(p=>p.owner===0),pickB=trade.franchise.picks.find(p=>p.owner===1);
const accepted=F.proposeTrade(trade,0,1,[F.id(pa),`pick:${pickA.id}`],[F.id(pb),`pick:${pickB.id}`],true);
trade.clock++;trade.day++;F.dayStart(trade);
assert.equal(accepted.status,'completed');
assert.equal(F.locate(trade,F.id(pa)).team,1);assert.equal(pickA.owner,1);
assert.equal(F.locate(trade,F.id(pb)).team,0);assert.equal(pickB.owner,0);
legal(trade);
trade.day=trade.schedule.length;
assert.throws(()=>F.proposeTrade(trade,0,1,[F.id(pb)],[F.id(pa)],true),/deadline/);
const cpu=fixture({trades:true},{gamesPerTeam:80});
let windowSeen=false;
for(let n=0;n<65&&!windowSeen;n++) {
  L.simDay(cpu);
  const offer=cpu.franchise.trades.find(t=>t.status==='pending');
  if(offer) {
    assert.equal(offer.proposed,cpu.clock,'New CPU proposals must be visible before their playing day, not instantly executed');
    assert.equal(offer.execute,cpu.clock+1);
    F.veto(cpu,offer.id);L.simDay(cpu);assert.equal(offer.status,'vetoed');windowSeen=true;
  }
}
assert(windowSeen,'Seeded CPU simulation must expose at least one inspectable proposal');
const splits=fixture({trades:true});
L.simDay(splits);
const outgoing=splits.teams[0].roster.lineup[0],incoming=splits.teams[1].roster.lineup[0],outKey=F.id(outgoing);
const beforeTotals=JSON.stringify(L.teamTotals(splits,'reg'));
const beforePA=splits.stats.reg.bat[outKey].pa;
const splitTrade=F.proposeTrade(splits,0,1,[outKey],[F.id(incoming)],true);
splits.clock++;splits.day++;F.dayStart(splits);
assert.equal(splitTrade.status,'completed');
assert.equal(JSON.stringify(L.teamTotals(splits,'reg')),beforeTotals,'A trade cannot move accumulated team totals to the receiving club');
assert.equal(L.statRows(splits,'reg','bat',1).find(r=>r.key===outKey).pa,0,'New-team stat stint starts empty');
const splitRef=L.pendingGames(splits)[0];
const synthetic={score:[1,0],hits:[1,0],errors:[0,0],inn:1,sides:[splitRef.away,splitRef.home].map(team=>({bat:team===1?[{...outgoing,stat:{pa:1,ab:1,h:1}}]:[],pit:[]}))};
L.recordRef(splits,splitRef,synthetic);
assert.equal(splits.stats.reg.bat[outKey].pa,beforePA+1);
assert.equal(L.statRows(splits,'reg','bat',0).find(r=>r.key===outKey).pa,beforePA);
assert.equal(L.statRows(splits,'reg','bat',1).find(r=>r.key===outKey).pa,1);
assert.throws(()=>L.recordRef(splits,splitRef,synthetic),/already/);

const moves=fixture(),farm=moves.teams[0].farm.find(p=>!p.role),starter=moves.teams[0].roster.lineup[0];
F.move(moves,0,F.id(farm),'lineup',F.id(starter));
assert.equal(F.locate(moves,F.id(farm)).slot,'lineup');
assert(moves.franchise.people[F.id(farm)].contract.salary>=F.minimum(moves.franchise.year));legal(moves);
assert.throws(()=>F.move(moves,0,F.id(farm),'farm'),/swap partner/);
assert.throws(()=>F.move(moves,0,F.id(starter),'rotation',F.id(moves.teams[0].roster.rotation[0])),/matching/);
const market=fixture(),fa=market.franchise.freeAgents[0],salary=F.demand(market,fa);
assert.throws(()=>F.sign(market,0,F.id(fa),1,0),/minimum/);
market.teams[0].finance.budget=1;
assert.throws(()=>F.sign(market,0,F.id(fa),1,salary),/budget/);
F.sign(market,0,F.id(fa),2,salary,true);
assert.equal(F.locate(market,F.id(fa)).team,0);
const payroll=F.payroll(market,0);
market.settings.franchise.taxThreshold=payroll-1000000;
assert.equal(F.tax(market,0),200000);
F.release(market,0,F.id(fa));
assert.equal(F.locate(market,F.id(fa)).team,null);
assert.equal(F.payroll(market,0),payroll,'Release retains guarantee as dead money');

const lifecycle=fixture(),young=lifecycle.teams[0].farm[0],yk=F.id(young),age=young.age;
const benchKey=F.id(lifecycle.teams[0].roster.bench[0]);
finish(lifecycle);
assert(lifecycle.awards.some(a=>a.award==='MVP'));
assert(lifecycle.awards.some(a=>a.award==='Gold Glove (P)'));
const awards=JSON.stringify(lifecycle.awards);F.finalizeAwards(lifecycle);assert.equal(JSON.stringify(lifecycle.awards),awards);
assert.throws(()=>L.nextSeason(lifecycle),/offseason stages/);
F.advanceOffseason(lifecycle);F.advanceOffseason(lifecycle);
assert.equal(lifecycle.franchise.people[yk].age,age+1);
assert.equal(lifecycle.franchise.people[yk].rookie,true,'Untouched farm players retain rookie eligibility');
assert(lifecycle.franchise.people[benchKey].service>=1,'Bench players accrue full active-roster service');
F.advanceOffseason(lifecycle);
assert.equal(lifecycle.franchise.offseason.stage,3);
F.advanceOffseason(lifecycle);
const picks=F.prepareDraft(lifecycle),manual=picks[0],prospect=lifecycle.franchise.draft[0],drafted=F.id(prospect);
F.draftNext(lifecycle,drafted);
assert.equal(F.locate(lifecycle,drafted).team,manual.owner);
assert.equal(lifecycle.franchise.people[drafted].contract.salary,0);
F.advanceOffseason(lifecycle);
assert.equal(lifecycle.franchise.offseason.draftLog.length,4);
const ageAfter=lifecycle.franchise.people[yk].age,year=lifecycle.franchise.year;
F.advanceOffseason(lifecycle);assert.equal(lifecycle.franchise.people[yk].age,ageAfter,'Completed stages cannot be applied twice');
L.nextSeason(lifecycle);
assert.equal(lifecycle.franchise.year,year+1);
assert.equal(lifecycle.history[0].year,year);
assert.equal(lifecycle.history[0].franchise.offseason.stage,5);
assert.equal(lifecycle.scheduleImport,undefined);
assert.equal(lifecycle.settings.startDate,`${year+1}-03-26`);
legal(lifecycle);
const injuredFA=fixture({injuries:true});
const pendingInjury=injuredFA.teams[0].roster.rotation[0],freeKey=F.id(pendingInjury),metadata=injuredFA.franchise.people[freeKey];
metadata.service=8;metadata.contract.end=injuredFA.franchise.year;
F.injure(injuredFA,0,freeKey,{name:'Long recovery',type:'surgery'},400);
finish(injuredFA);
F.advanceOffseason(injuredFA);F.advanceOffseason(injuredFA);F.advanceOffseason(injuredFA);
assert.equal(F.locate(injuredFA,freeKey).team,null);
const freeRemaining=metadata.injury.remaining;
injuredFA.clock++;F.dayEnd(injuredFA);
assert.equal(metadata.injury.remaining,freeRemaining-1,'Unsigned injured free agents continue recovery');
F.sign(injuredFA,1,freeKey,2,F.demand(injuredFA,pendingInjury),true);
assert.equal(F.locate(injuredFA,freeKey).slot,'il','Signing an injured free agent cannot make him immediately available');
F.rebalance(injuredFA,0);F.rebalance(injuredFA,1);
legal(injuredFA);

for(const [n,groups]of [[2,1],[3,3],[5,1],[6,3]])for(const mode of ['both','game','derby','none']) {
  const teams=L.generatedDescriptors(n);
  teams.forEach((t,i)=>t.league=`Group ${i%groups}`);
  const f=L.createLeague({teams,seed:6,settings:{gamesPerTeam:2,innings:1,playoffs:{enabled:false},festivities:{mode:'midpoint',game:mode==='both'||mode==='game',derby:mode==='both'||mode==='derby',midpoint:0.5}}});
  const counts=L.validateSchedule(f).counts;
  assert(counts.every(c=>c===2));
  const calendar=A.calendar(f);
  assert.equal(calendar.length,mode==='none'?0:1);
  if(mode!=='none') {
    f.day=calendar[0].derbyDay;f.clock=f.day;
    const event=A.ensure(f,0);
    assert(event.teams.every(t=>E.validateTeam(t).length===0));
    assert.equal(A.pending(f)[0].event,mode==='game'?'allstar':'derby');
    event.derby.champion=0;
    assert.equal(A.pending(f).length,mode==='derby'?0:mode==='both'?0:1);
    f.day=calendar[0].day;
    assert.equal(A.pending(f)[0]?.event,mode==='derby'?undefined:'allstar');
  }
}
const noAge=fixture({aging:false,injuries:false,trades:false});
assert.equal(noAge.franchise,undefined);
finish(noAge);L.nextSeason(noAge);assert.equal(noAge.phase,'regular');
const noAwards=fixture({awards:false});finish(noAwards);assert.equal(noAwards.awards,undefined);
let soak=fixture({injuries:true,injuryRisk:10,trades:true},{gamesPerTeam:6});
for(let year=0;year<5;year++) {
  finish(soak);legal(soak);off(soak);legal(soak);L.nextSeason(soak);soak=clone(soak);legal(soak);
}
assert.equal(soak.history.length,5);
const twoWayTeams=L.generatedDescriptors(2),twoWayRoster=E.generateTeam('Two Way','balanced',3);
twoWayRoster.lineup[0].mlb=660271;twoWayRoster.pitchers[0].mlb=660271;
twoWayTeams[0].roster=twoWayRoster;
let twoWay=L.createLeague({teams:twoWayTeams,seed:10,settings:{gamesPerTeam:2,playoffs:{enabled:false},myTeam:0,franchise:{aging:true,autoManage:false,trades:true,draftRounds:1}}});
assert.deepEqual(twoWay.franchise.people.m660271.kinds,['bat','pit']);
F.injure(twoWay,0,'m660271',{name:'Two-way shoulder strain',type:'arm'},12);
assert.equal(twoWay.teams[0].il.filter(e=>F.id(e.player)==='m660271').length,2);
assert(!F.roster(twoWay.teams[0]).some(e=>F.id(e.player)==='m660271'),'Two-way injury removes both roles');
assert.equal(twoWay.franchise.people.m660271.injury.il,15);
twoWay=clone(twoWay);
for(let day=0;day<15;day++){twoWay.clock=day;F.dayEnd(twoWay);}
F.activate(twoWay,0,'m660271');
assert.equal(F.roster(twoWay.teams[0]).filter(e=>F.id(e.player)==='m660271').length,2);
F.optimize(twoWay,0);legal(twoWay);
const partner=twoWay.teams[1].roster.bench[0];
const twoTrade=F.proposeTrade(twoWay,0,1,['m660271'],[F.id(partner)],true);
twoWay.clock++;F.dayStart(twoWay);
assert.equal(twoTrade.status,'completed');
assert.equal(F.allTeam(twoWay.teams[1]).filter(e=>F.id(e.player)==='m660271').length,2,'Both two-way roles travel in one trade');
legal(twoWay);
const repeatFest=fixture({aging:false},{festivities:{mode:'midpoint',game:true,derby:false,midpoint:0.5}});
finish(repeatFest);
const beforeCount=L.validateSchedule(repeatFest).days;
L.nextSeason(repeatFest);
assert.equal(L.validateSchedule(repeatFest).days,beforeCount,'Generated non-aging seasons must reinsert their break');
assert.equal(repeatFest.schedule[A.calendar(repeatFest)[0].day].length,0);
const injuredStatic=fixture({aging:false,injuries:true});
const staticKey=F.id(injuredStatic.teams[0].roster.rotation[0]);
F.injure(injuredStatic,0,staticKey,{name:'Surgery',type:'surgery'},400);
finish(injuredStatic);
const staticRemaining=injuredStatic.franchise.people[staticKey].injury.remaining;
L.nextSeason(injuredStatic);
assert.equal(injuredStatic.franchise.people[staticKey].injury.remaining,staticRemaining-120);
assert.equal(injuredStatic.franchise.lastDay,-1);
for(const file of ['league.html','game.html','customization.html']) {
  const html=fs.readFileSync(path.join(__dirname,file),'utf8');
  for(const match of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g))if(match[1].trim())new vm.Script(match[1],{filename:file});
  assert(html.indexOf('player-bios.js')<html.indexOf('game-engine.js'));
  assert(html.indexOf('starting-salaries.js')<html.indexOf('franchise.js'));
}
console.log('Passed: player ages, selected-year facts, deterministic franchise creation, injuries/IL frequency and persistence, veto timing, trades/picks, roster swaps, contracts/payroll/tax, awards, staged offseason, manual draft, generated calendars, custom festivities and five-season save/reload soak.');
