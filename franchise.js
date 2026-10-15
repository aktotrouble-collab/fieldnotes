(function(root,factory) {
  if(typeof module==='object'&&module.exports) module.exports=factory(require('./game-engine.js'),require('./starting-contracts.js'),require('./starting-salaries.js'),require('./minor-league-prospects.js'));
  else root.Franchise=factory(root.GameEngine,root.StartingContracts,root.StartingSalaries,root.MinorLeagueProspects);
})(typeof window!=='undefined'?window:globalThis,function(E,startingContracts,startingSalaries,minorLeagueProspects) {
  'use strict';
  const clone=v=>JSON.parse(JSON.stringify(v));
  const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
  const id=p=>p.mlb?`m${p.mlb}`:p.customPlayerId||p.name;
  const groups=['lineup','bench','rotation','bullpen'];
  const batKeys=['contact','power','eye','speed','arm','field'];
  const pitKeys=['velo','control','movement','stamina'];
  const defaults=()=>({
    aging:false,injuries:false,injuryRisk:5,trades:false,awards:true,funAwards:true,
    startYear:2025,fictionalMLB:false,autoManage:true,budget:180000000,
    luxuryTax:true,taxThreshold:241000000,taxRate:0.2,draftRounds:5,
    tradeDeadline:0.67,tradePicks:true
  });
  const settings=l=>({...defaults(),...l.settings.franchise});
  const roster=t=>groups.flatMap(g=>(t.roster[g]||[]).map(p=>({player:p,slot:g})));
  const allTeam=t=>[...roster(t),...(t.farm||[]).map(p=>({player:p,slot:'farm'})),...(t.il||[]).map(e=>({player:e.player,slot:'il'}))];
  const copies=(l,key)=>l.teams.flatMap((t,team)=>allTeam(t).filter(e=>id(e.player)===key).map(e=>({...e,team})));
  const overall=p=>p.role?E.pitcherOverall(p):E.batterOverall(p);
  const enabled=l=>{const s=settings(l);return s.aging||s.injuries||s.trades;};
  function rng(l,salt) {
    let h=(l.seed+l.seasonNo*7919)>>>0;
    for(const ch of String(salt).split(l.id).join('league'))h=Math.imul(h^ch.charCodeAt(0),16777619)>>>0;
    const r=E.makeRng(h);
    r.int=(a,b)=>Math.floor(r.between(a,b+1));
    return r;
  }
  function log(l,type,text,details) {
    l.franchise.news.unshift({year:l.franchise.year,day:l.clock,type,text,...details});
  }
  const minimum=year=>year>=2026?780000:year>=2025?760000:year>=2024?740000:year>=2023?720000:year>=2022?700000:year>=2021?570500:year>=2020?563500:year>=2019?555000:year>=2018?545000:year>=2017?535000:507500;
  function minimumFor(l,year=l.franchise.year) {
    const start=settings(l).startYear,base=minimum(start);
    return year<=start?base:Math.round(base*1.025**(year-start)/10000)*10000;
  }
  function generated(l,tag,kind,age) {
    const r=rng(l,`generated:${tag}`);
    const team=E.generateTeam('Draft','balanced',Math.floor(r.next()*1e9));
    const p=clone(kind==='pit'?r.pick(team.pitchers):r.pick([...team.lineup,...team.bench]));
    p.customPlayerId=`fr-${l.id}-${l.franchise.serial++}`;
    delete p.mlb;
    p.age=age??r.int(18,22);
    p.ageSource='Generated';
    const elite=r.next()<0.08,solid=r.next()<0.32;
    const potential=elite?r.between(75,105):solid?r.between(56,78):r.between(32,59);
    for(const key of kind==='pit'?[...batKeys,...pitKeys]:batKeys) {
      if(!Number.isFinite(p[key]))continue;
      p[key]=Math.max(15,Math.round(p[key]*0.5+r.gauss()*4));
    }
    initPlayer(l,p,kind,`generated:${tag}`,potential);
    if(settings(l).aging&&p.age<=22)l.franchise.people[id(p)].contract={start:l.franchise.year,end:l.franchise.year,salary:0,source:'Minor-league developmental contract'};
    return p;
  }
  function initPlayer(l,p,kind,salt,potential) {
    const f=l.franchise;
    const previousKey=id(p);
    if(!p.mlb&&!p.customPlayerId)p.customPlayerId=`fr-${l.id}-${f.serial++}`;
    const key=id(p);
    if(previousKey!==key&&Number.isInteger(salt)) {
      for(const phase of ['reg','post']) {
        const row=l.stats[phase][kind][previousKey];
        if(row?.team===salt){l.stats[phase][kind][key]=row;delete l.stats[phase][kind][previousKey];}
      }
      if(l.teams[salt].pst[previousKey]){l.teams[salt].pst[key]=l.teams[salt].pst[previousKey];delete l.teams[salt].pst[previousKey];}
    }
    if(f.people[key]) {
      const person=f.people[key];
      if(!person.kinds.includes(kind))person.kinds.push(kind);
      for(const attribute of kind==='pit'?[...batKeys,...pitKeys]:batKeys)if(Number.isFinite(p[attribute])&&person.potential[attribute]===undefined)person.potential[attribute]=p[attribute];
      for(const entry of copies(l,key)) {
        entry.player.age=person.age;
        for(const [attribute,value]of Object.entries(p))if([...batKeys,...pitKeys].includes(attribute)&&entry.player[attribute]===undefined)entry.player[attribute]=value;
      }
      return person;
    }
    const r=rng(l,`${key}:${salt}`);
    const bio=E.playerBio(p);
    const age=Number.isFinite(p.age)?p.age:E.playerAge(p,`${f.year}-07-01`);
    p.age=age??r.int(23,34);
    p.ageSource||=age!==null&&age!==undefined?(p.mlb?'MLB birth date / saved age':'Saved age'):'Generated (unknown birth date)';
    const service=bio?.debut?clamp(f.year-Number(bio.debut.slice(0,4)),0,20):Math.max(0,p.age-24);
    const keys=kind==='pit'?[...batKeys,...pitKeys]:batKeys;
    const targets=Object.fromEntries(keys.filter(k=>Number.isFinite(p[k])).map(k=>[k,Math.max(p[k],potential&&typeof potential==='object'?potential[k]??p[k]:potential===undefined?p[k]+(p.age<27?r.between(0,18):0):potential+r.gauss()*8)]));
    const value=overall(p);
    const person=f.people[key]={
      key,name:p.name,kind,kinds:[kind],age:p.age,service,serviceSource:'Estimated full seasons since MLB debut; not exact service days',
      peak:r.int(27,30),potential:targets,scoutError:r.between(4,10),health:100,
      injuries:[],career:{bat:{},pit:{},seasons:0},history:[],rookie:service<1,
      contract:null,retired:false,lastOverall:value
    };
    if(settings(l).aging&&!p.prospect) {
      const actual=(startingContracts||[]).find(c=>c.id===p.mlb&&c.known<=f.year&&c.start<=f.year&&c.end>=f.year);
      const annual=startingSalaries?.[f.year]?.[p.mlb];
      const salary=actual?actual.total/(actual.end-actual.start+1):annual|| (service<3?minimumFor(l):Math.max(minimumFor(l),Math.round((value/50)**3*6000000/100000)*100000));
      person.contract={salary,start:f.year,end:actual?actual.end:annual?f.year:f.year+(service>=6?r.int(0,3):0),
        source:actual?'Reported guarantee; modeled even AAV':annual?'Lahman annual salary; remaining term unknown':'Generated starting contract',
        url:actual?.source||(annual?'https://raw.githubusercontent.com/vincentarelbundock/Rdatasets/master/csv/Lahman/Salaries.csv':null),
        note:actual?.note||(annual?'Selected-year annual salary only; modeled one-year remaining term. Largest listed team salary used if multiple entries.':null)};
    }
    return person;
  }
  function initialize(l) {
    if(!enabled(l)||l.franchise)return;
    const s=settings(l);
    if(!Number.isInteger(s.startYear)||s.startYear<1901||s.startYear>9990)throw new Error('Choose a valid franchise starting year.');
    if(!Number.isFinite(s.injuryRisk)||s.injuryRisk<1||s.injuryRisk>10)throw new Error('Injury frequency must be 1 through 10.');
    if(!Number.isInteger(s.draftRounds)||s.draftRounds<1||s.draftRounds>20)throw new Error('Choose 1 through 20 draft rounds.');
    if(!Number.isFinite(s.budget)||s.budget<=0||!Number.isFinite(s.taxThreshold)||s.taxThreshold<=0||!Number.isFinite(s.taxRate)||s.taxRate<0)throw new Error('Budgets and tax thresholds must be positive; tax rates cannot be negative.');
    if(!Number.isFinite(s.tradeDeadline)||s.tradeDeadline<=0||s.tradeDeadline>=1)throw new Error('The trade deadline must fall within the season.');
    l.franchise={version:1,year:s.startYear,serial:1,people:{},freeAgents:[],retired:[],trades:[],picks:[],news:[],offseason:null,development:[],draft:[],lastDay:-1};
    const franchise=l.franchise;
    l.teams.forEach((t,ti)=>{
      t.farm=[];t.il=[];
      t.finance={budget:Math.round(s.budget*(0.7+rng(l,`budget:${ti}`).next()*0.6)),spentTax:0,deadMoney:[]};
      for(const {player,slot}of roster(t))initPlayer(l,player,['rotation','bullpen'].includes(slot)?'pit':'bat',ti);
      if(s.aging)for(let j=0;j<10;j++)t.farm.push(generated(l,`initial-farm:${ti}:${j}`,j<4?'pit':'bat'));
    });
    if(s.aging) {
      const source=minorLeagueProspects?.[l.franchise.year];
      if(l.source==='mlb'&&!s.fictionalMLB&&source)for(const [ti,team]of l.teams.entries()) {
        const code=team.code||team.src?.club;
        const historical=source[code]||source[({OAK:'ATH',ARI:'AZ',WAS:'WSH'})[code]];
        if(!historical)continue;
        const alreadyOwned=new Set(allTeam(team).map(entry=>id(entry.player)));
        for(const prospect of historical) {
          if(alreadyOwned.has(`m${prospect.id}`))continue;
          const player=clone(prospect),kind=player.role?'pit':'bat';
          player.customPlayerId=null;
          initPlayer(l,player,kind,`historical-prospect:${franchise.year}:${ti}`,player.prospectPotential);
          const person=franchise.people[id(player)];
          person.prospect=true;person.prospectSourceYear=franchise.year;person.prospectAffiliate=player.prospectAffiliate;
          person.prospectLevel=player.prospectLevel;person.prospectCareer=clone(player.prospectCareer);
          person.service=0;person.serviceSource='No MLB service at franchise start; historical minor-league prospect';
          person.rookie=true;
          person.contract={start:franchise.year,end:franchise.year,salary:0,source:'Historical minor-league prospect (modeled minor-league deal)'};
          team.farm.push(player);alreadyOwned.add(id(player));
        }
      }
      ensurePicks(l,l.franchise.year+1);
      ensurePicks(l,l.franchise.year+2);
      for(let i=0;i<l.teams.length*2;i++) {
        const p=generated(l,`opening-fa:${i}`,i%3===0?'pit':'bat',rng(l,`opening-fa-age:${i}`).int(24,34));
        l.franchise.people[id(p)].contract=null;l.franchise.freeAgents.push(p);
      }
    }
  }
  function ensurePicks(l,year) {
    const f=l.franchise;
    for(let round=1;round<=settings(l).draftRounds;round++)l.teams.forEach((t,ti)=>{
      const key=`${year}:${round}:${ti}`;
      if(!f.picks.some(p=>p.id===key))f.picks.push({id:key,year,round,original:ti,owner:ti,used:false});
    });
  }
  function locate(l,key) {
    for(let ti=0;ti<l.teams.length;ti++) {
      const entry=allTeam(l.teams[ti]).find(e=>id(e.player)===key);
      if(entry)return {...entry,team:ti};
    }
    const player=l.franchise?.freeAgents.find(p=>id(p)===key);
    return player?{player,team:null,slot:'freeAgents'}:null;
  }
  function remove(l,key,all=false,player=null) {
    const entry=player?copies(l,key).find(e=>e.player===player):locate(l,key);
    if(!entry)throw new Error('Player no longer available.');
    const array=entry.team===null?l.franchise.freeAgents:entry.slot==='il'?l.teams[entry.team].il:entry.slot==='farm'?l.teams[entry.team].farm:l.teams[entry.team].roster[entry.slot];
    const index=array.findIndex(p=>player?(entry.slot==='il'?p.player:p)===player:id(entry.slot==='il'?p.player:p)===key);
    array.splice(index,1);
    if(all) {
      entry.companions=[];
      while(locate(l,key))entry.companions.push(remove(l,key));
    }
    return entry;
  }
  function canPlay(l,p) {
    const person=l.franchise?.people[id(p)];
    return !person?.retired&&!person?.injury;
  }
  function rebalance(l,ti) {
    const t=l.teams[ti],s=l.settings;
    for(const pos of [...E.POSITIONS,'DH']) {
      if(t.roster.lineup.some(p=>p.pos===pos))continue;
      const pool=[...t.roster.bench,...(t.farm||[])].filter(p=>!p.role&&canPlay(l,p)).sort((a,b)=>(E.eligibleAt(b,pos)?100:0)+overall(b)-(E.eligibleAt(a,pos)?100:0)-overall(a));
      let player=pool[0];
      if(player)remove(l,id(player),false,player);
      else {player=generated(l,`replacement-bat:${ti}:${pos}:${l.franchise.serial}`,'bat',25);player.pos=pos;player.natural=pos;log(l,'replacement',`${t.name} signed emergency replacement ${player.name}.`);}
      player.pos=pos;t.roster.lineup.push(player);
    }
    for(const [slot,count]of [['rotation',s.rotation],['bullpen',s.bullpen],['bench',s.bench]]) {
      while(t.roster[slot].length<count) {
        const kind=slot==='bench'?'bat':'pit';
        const player=t.farm.filter(p=>(kind==='pit'?!!p.role:!p.role)&&canPlay(l,p)).sort((a,b)=>overall(b)-overall(a))[0];
        const p=player?remove(l,id(player),false,player).player:generated(l,`replacement:${ti}:${slot}:${l.franchise.serial}`,kind,25);
        if(kind==='pit')p.role=slot==='rotation'?'SP':'RP';
        if(!l.franchise.people[id(p)].contract&&settings(l).aging)l.franchise.people[id(p)].contract={salary:minimumFor(l),start:l.franchise.year,end:l.franchise.year,source:'League minimum replacement'};
        t.roster[slot].push(p);
      }
    }
    if(settings(l).aging)for(const {player}of roster(t)) {
      const m=l.franchise.people[id(player)],year=l.phase==='done'?l.franchise.year+1:l.franchise.year;
      if(!m.contract||m.contract.salary<minimumFor(l,year))m.contract={salary:minimumFor(l,year),start:year,end:year,source:'League minimum promotion / replacement'};
    }
  }
  function payroll(l,ti) {
    if(!l.franchise)return 0;
    const t=l.teams[ti],seen=new Set();
    return allTeam(t).reduce((sum,{player})=>{
      const key=id(player);
      if(seen.has(key))return sum;
      seen.add(key);
      return sum+(l.franchise.people[key]?.contract?.salary||0);
    },(t.finance?.deadMoney||[]).filter(c=>c.end>=l.franchise.year).reduce((n,c)=>n+c.salary,0));
  }
  function optimize(l,ti) {
    const t=l.teams[ti],pool=allTeam(t).filter(e=>e.slot!=='il').map(e=>e.player),s=l.settings;
    const bats=pool.filter(p=>!p.role),pits=pool.filter(p=>p.role);
    const used=new Set(),lineup=[];
    for(const pos of ['C','SS','CF','2B','3B','RF','LF','1B','DH']) {
      const p=bats.filter(p=>!used.has(p)).sort((a,b)=>(overall(b)-E.positionPenalty(b,pos))-(overall(a)-E.positionPenalty(a,pos)))[0];
      if(p){p.pos=pos;used.add(p);lineup.push(p);}
    }
    lineup.sort((a,b)=>(b.contact+b.eye+b.speed*0.15)-(a.contact+a.eye+a.speed*0.15));
    const bench=bats.filter(p=>!used.has(p)).sort((a,b)=>overall(b)-overall(a)).slice(0,s.bench);
    bench.forEach(p=>used.add(p));
    const rotation=pits.slice().sort((a,b)=>(overall({...b,role:'SP'})+(b.stamina||0)*0.15)-(overall({...a,role:'SP'})+(a.stamina||0)*0.15)).slice(0,s.rotation);
    rotation.forEach(p=>{p.role='SP';used.add(p);});
    const bullpen=pits.filter(p=>!used.has(p)).sort((a,b)=>overall({...b,role:'RP'})-overall({...a,role:'RP'})).slice(0,s.bullpen);
    bullpen.forEach(p=>{p.role='RP';used.add(p);});
    t.roster={lineup,bench,rotation,bullpen};t.farm=pool.filter(p=>!used.has(p));
    rebalance(l,ti);
    if(settings(l).aging)for(const {player}of roster(t)) {
      const m=l.franchise.people[id(player)];
      if(!m.contract||m.contract.salary<minimumFor(l))m.contract={start:l.franchise.year,end:l.franchise.year,salary:minimumFor(l),source:'MLB minimum promotion'};
    }
  }
  function tax(l,ti) {
    const s=settings(l);
    return s.luxuryTax?Math.max(0,payroll(l,ti)-s.taxThreshold)*s.taxRate:0;
  }
  const injuries=[
    {name:'Hamstring strain',days:[12,32],type:'muscle',weight:25},
    {name:'Ankle sprain',days:[8,25],type:'joint',weight:20},
    {name:'Back tightness',days:[3,13],type:'muscle',weight:18},
    {name:'Concussion',days:[7,24],type:'concussion',weight:6},
    {name:'Shoulder inflammation',days:[18,60],type:'arm',weight:14},
    {name:'Fractured hand',days:[35,65],type:'fracture',weight:7},
    {name:'Torn elbow ligament / surgery',days:[300,460],type:'surgery',weight:3},
    {name:'Knee ligament tear',days:[160,280],type:'surgery',weight:3},
    {name:'Forearm strain',days:[18,75],type:'arm',weight:12}
  ];
  function injure(l,ti,key,definition,duration) {
    const entry=locate(l,key),person=l.franchise.people[key];
    if(!entry||entry.team!==ti||person.injury)throw new Error('This player is not available for an injury assignment.');
    const p=entry.player,kind=definition.type;
    const minDays=kind==='concussion'?7:duration>=60?60:person.kinds.includes('pit')||p.twoWay?15:10;
    const injury={id:`inj-${key}-${l.franchise.year}-${l.clock}`,name:definition.name,type:kind,
      year:l.franchise.year,start:l.clock,days:duration,remaining:duration,
      il:minDays,minRemaining:minDays,estimated:[Math.max(1,Math.round(duration*0.8)),Math.ceil(duration*1.2)],recovered:false};
    person.injury=injury;
    person.injuries.push(clone(injury));
    person.health=Math.max(20,person.health-(kind==='surgery'?20:duration>30?7:2));
    const removed=remove(l,key,true);
    for(const copy of [removed,...removed.companions])l.teams[ti].il.push({player:copy.player,slot:copy.slot,injury});
    log(l,'injury',`${p.name} placed on the ${minDays}-day IL (${definition.name}); estimated ${injury.estimated.join('-')} days.`,{team:ti,key});
    rebalance(l,ti);
    return injury;
  }
  function afterGame(l,ref,result) {
    if(!l.franchise)return;
    result.sides.forEach((side,k)=>{
      const ti=k===0?ref.away:ref.home;
      if(!ref.post)for(const key of new Set(allTeam(l.teams[ti]).filter(e=>e.slot!=='farm').map(e=>id(e.player)))) {
        const person=l.franchise.people[key];
        if(person)person.activeDays=(person.activeDays||0)+1;
      }
      for(const [kind,list]of [['bat',side.bat],['pit',side.pit]])for(const row of list) {
        const person=l.franchise.people[id(row)];
        if(!person)continue;
        if(!settings(l).injuries||person.injury)continue;
        const workload=kind==='pit'?1+(row.stat.pc||0)/90:1;
        const r=rng(l,`inj:${ref.id}:${kind}:${id(row)}`);
        const chance=0.00065*settings(l).injuryRisk*workload*(1+Math.max(0,person.age-30)*0.035)*(1+(100-person.health)/100);
        if(r.next()>=chance)continue;
        const entry=locate(l,id(row));
        if(!entry||entry.team!==ti)continue;
        const options=injuries.filter(d=>kind==='pit'||d.type!=='arm');
        const sum=options.reduce((n,d)=>n+d.weight,0);
        let roll=r.next()*sum;
        const chosen=options.find(d=>(roll-=d.weight)<=0)||options[0];
        injure(l,ti,id(row),chosen,r.int(...chosen.days));
      }
    });
  }
  function activate(l,ti,key) {
    const t=l.teams[ti],entries=t.il.filter(e=>id(e.player)===key);
    if(!entries.length)throw new Error('Player is not on this team injured list.');
    const person=l.franchise.people[key],injury=person.injury;
    if(injury.remaining>0||injury.minRemaining>0)throw new Error('Player has not completed recovery and the minimum IL stay.');
    delete person.injury;
    for(const entry of entries) {
      const at=t.il.indexOf(entry);t.il.splice(at,1);
      if(entry.slot==='farm')t.farm.push(entry.player);
      else {
        const slot=entry.slot,pos=entry.player.pos;
        const replace=t.roster[slot].find(p=>slot!=='lineup'||p.pos===pos);
        if(replace){remove(l,id(replace),false,replace);t.farm.push(replace);}
        t.roster[slot].push(entry.player);
      }
    }
    log(l,'activated',`${entries[0].player.name} returned from the IL.`,{team:ti,key});
  }
  function move(l,ti,key,target,replaceKey) {
    const entry=locate(l,key);
    if(!entry||entry.team!==ti||!['farm','lineup','bench','rotation','bullpen'].includes(target))throw new Error('Choose a valid player and roster destination.');
    if(!canPlay(l,entry.player))throw new Error('Injured or retired players cannot be promoted.');
    if((target==='rotation'||target==='bullpen')!==!!entry.player.role&&target!=='farm')throw new Error('Pitchers and hitters must use the matching roster slots.');
    const t=l.teams[ti];
    if(copies(l,key).length>1)throw new Error('Use auto-select roster to manage two-way players; individual-slot swaps cannot split their shared identity.');
    const replacement=replaceKey?locate(l,replaceKey):null;
    if(replaceKey===key)throw new Error('Choose a different replacement player.');
    if(replacement&&(replacement.team!==ti||replacement.slot!==target))throw new Error('Choose a replacement from the destination roster.');
    if(replacement&&entry.slot!=='farm'&&!!replacement.player.role!==!!entry.player.role)throw new Error('The returning replacement must also fit the original roster slot.');
    if(replacement&&copies(l,replaceKey).length>1)throw new Error('A two-way player cannot be split by an individual-slot swap.');
    const capacity=target==='lineup'?9:l.settings[target==='rotation'?'rotation':target==='bullpen'?'bullpen':'bench'];
    if(target!=='farm'&&!replacement&&t.roster[target].length>=capacity)throw new Error('The destination roster is full. Choose a player to swap.');
    if(entry.slot!=='farm'&&!replacement)throw new Error('Choose a swap partner to keep the active roster complete.');
    if(target==='lineup'&&!replacement)throw new Error('Choose which starter to replace.');
    if(entry.slot==='lineup'&&!replacement)throw new Error('Swap a starter with another hitter instead of leaving a vacant position.');
    remove(l,key);
    if(replacement) {
      remove(l,replaceKey);
      const pos=entry.player.pos;
      if(target==='lineup')entry.player.pos=replacement.player.pos;
      if(entry.slot==='lineup')replacement.player.pos=pos;
      if(entry.slot==='rotation'||entry.slot==='bullpen')replacement.player.role=entry.slot==='rotation'?'SP':'RP';
      (entry.slot==='farm'?t.farm:t.roster[entry.slot]).push(replacement.player);
    }
    if(target==='rotation'||target==='bullpen')entry.player.role=target==='rotation'?'SP':'RP';
    (target==='farm'?t.farm:t.roster[target]).push(entry.player);
    if(target!=='farm'&&settings(l).aging) {
      const contract=l.franchise.people[key].contract;
      if(!contract||contract.salary<minimumFor(l))l.franchise.people[key].contract={start:l.franchise.year,end:l.franchise.year,salary:minimumFor(l),source:'MLB minimum promotion'};
    }
    log(l,'roster',`${t.name} moved ${entry.player.name} to ${target}.`,{team:ti,key});
  }
  function contention(l,ti) {
    const rec=l.rec[ti],games=rec.w+rec.l;
    const own=games?rec.w/games:0.5;
    const group=l.teams.map((t,i)=>({t,i})).filter(o=>o.t.league===l.teams[ti].league).map(o=>l.rec[o.i]).map(r=>r.w+r.l?r.w/(r.w+r.l):0.5);
    const best=Math.max(...group);
    return clamp(0.5+(own-0.5)*1.8-(best-own)*0.6,0,1);
  }
  function tradeValue(l,key,ti) {
    const entry=locate(l,key),m=l.franchise.people[key];
    if(!entry||!m||m.retired)return 0;
    const p=entry.player,ov=overall(p);
    const row=l.stats.reg[m.kind][key]||{};
    const performance=m.kind==='pit'?(row.outs?clamp(1+(4.3-row.r*27/row.outs)*0.06,0.7,1.3):1):(row.pa?clamp(1+((row.h||0)+(row.hr||0)*2+(row.bb||0)*0.5)/row.pa-0.28,0.7,1.3):1);
    const pot=Object.values(m.potential).reduce((a,b)=>a+b,0)/Math.max(1,Object.keys(m.potential).length);
    const control=m.contract?Math.max(m.contract.end-l.franchise.year+1,6-m.service):6;
    const youth=Math.max(0,28-m.age)*0.9;
    const salary=(m.contract?.salary||minimumFor(l))/1e6;
    const health=m.injury?0.6:m.health/100;
    const need=ti===undefined?0.5:contention(l,ti);
    return Math.max(1,((ov*performance-25)*1.3+Math.max(0,pot-ov)*(m.age<27?0.8:0.1)+youth+Math.min(6,control)*2-salary*0.35)*health*(m.age>29?0.85+need*0.3:1.15-need*0.2));
  }
  function pickValue(l,pick) {
    return Math.max(2,34/pick.round)*(1-Math.min(0.4,Math.max(0,pick.year-l.franchise.year)*0.12));
  }
  function asset(l,ti,value) {
    if(value.startsWith('pick:')) {
      if(!settings(l).tradePicks)throw new Error('Draft-pick trading is disabled.');
      const p=l.franchise.picks.find(p=>p.id===value.slice(5)&&p.owner===ti&&!p.used);
      if(!p)throw new Error('Draft pick is no longer owned by that team.');
      return {pick:p,value:pickValue(l,p)};
    }
    const p=locate(l,value);
    if(!p||p.team!==ti)throw new Error('Trade player is no longer on that team.');
    if(p.slot==='il')throw new Error('Injured-list players cannot be traded in this model.');
    return {...p,value:tradeValue(l,value,ti)};
  }
  function proposeTrade(l,a,b,giveA,giveB,commissioner=false) {
    if(!settings(l).trades||!l.franchise)throw new Error('Trading is disabled.');
    const deadline=Math.floor((l.schedule.length-1)*settings(l).tradeDeadline);
    if(l.phase!=='regular'||l.day>deadline)throw new Error('The trade deadline has passed.');
    if(a===b||!l.teams[a]||!l.teams[b]||!giveA.length||!giveB.length||new Set([...giveA,...giveB]).size!==giveA.length+giveB.length)throw new Error('Choose two different teams and nonduplicated assets on both sides.');
    if(l.franchise.trades.some(t=>t.status==='pending'&&[...t.giveA,...t.giveB].some(x=>[...giveA,...giveB].includes(x))))throw new Error('An asset is already in a pending trade.');
    const aa=giveA.map(x=>asset(l,a,x)),bb=giveB.map(x=>asset(l,b,x));
    const va=aa.reduce((n,x)=>n+x.value,0),vb=bb.reduce((n,x)=>n+x.value,0);
    if(!commissioner&&Math.min(va,vb)/Math.max(va,vb)<0.65)throw new Error('The CPU declined an unbalanced offer.');
    const trade={id:`trade-${l.franchise.year}-${l.franchise.serial++}`,a,b,giveA:clone(giveA),giveB:clone(giveB),
      labelsA:aa.map(x=>x.pick?`${x.pick.year} round ${x.pick.round} pick`:x.player.name),
      labelsB:bb.map(x=>x.pick?`${x.pick.year} round ${x.pick.round} pick`:x.player.name),
      proposed:l.clock,execute:l.clock+1,status:'pending',valueA:va,valueB:vb,commissioner};
    l.franchise.trades.unshift(trade);
    log(l,'trade',`Pending: ${l.teams[a].abbr} / ${l.teams[b].abbr}; one-day commissioner veto window.`);
    return trade;
  }
  function veto(l,tradeId) {
    const t=l.franchise.trades.find(t=>t.id===tradeId);
    if(!t||t.status!=='pending')throw new Error('Only pending trades can be vetoed.');
    t.status='vetoed';log(l,'trade','Commissioner vetoed the trade.',{tradeId});
  }
  function executeTrades(l) {
    for(const t of l.franchise.trades.filter(t=>t.status==='pending'&&t.execute<=l.clock)) {
      try {
        const a=t.giveA.map(x=>asset(l,t.a,x)),b=t.giveB.map(x=>asset(l,t.b,x));
        for(const [entries,destination]of [[a,t.b],[b,t.a]])for(const entry of entries) {
          if(entry.pick)entry.pick.owner=destination;
          else {
            const key=id(entry.player),moved=remove(l,key,true);
            l.teams[destination].farm.push(moved.player,...moved.companions.map(e=>e.player));
            for(const phase of ['reg','post'])for(const kind of ['bat','pit']) {
              const row=l.stats[phase][kind][key];
              if(!row)continue;
              row.stints||={[row.team]:Object.fromEntries(Object.entries(row).filter(([field,value])=>field!=='team'&&typeof value==='number'))};
              row.stints[destination]||={};
              row.team=destination;
            }
          }
        }
        rebalance(l,t.a);rebalance(l,t.b);
        for(const ti of [t.a,t.b])if(ti!==l.settings.myTeam||settings(l).autoManage)optimize(l,ti);
        t.status='completed';
        log(l,'trade',`${l.teams[t.a].abbr} and ${l.teams[t.b].abbr} completed their trade.`,{tradeId:t.id});
      } catch(error) { t.status='cancelled';t.reason=error.message;log(l,'trade',`Trade cancelled: ${error.message}`,{tradeId:t.id}); }
    }
  }
  function cpuTrade(l) {
    if(!settings(l).trades||l.phase!=='regular'||l.day>Math.floor((l.schedule.length-1)*settings(l).tradeDeadline)||l.day<Math.floor(l.schedule.length*0.25))return;
    const r=rng(l,`trade-day:${l.clock}`);
    if(r.next()>0.16)return;
    const buyers=l.teams.map((t,i)=>i).sort((a,b)=>contention(l,b)-contention(l,a));
    const buyer=buyers[r.int(0,Math.max(0,Math.floor(buyers.length/2)-1))];
    const seller=buyers[buyers.length-1-r.int(0,Math.max(0,Math.floor(buyers.length/2)-1))];
    if(buyer===seller)return;
    const reserved=new Set(l.franchise.trades.filter(t=>t.status==='pending').flatMap(t=>[...t.giveA,...t.giveB]));
    const veterans=roster(l.teams[seller]).filter(e=>!reserved.has(id(e.player))&&canPlay(l,e.player)).sort((a,b)=>overall(b.player)-overall(a.player));
    const vet=veterans.find(e=>l.franchise.people[id(e.player)].age>=28)||veterans[0];
    if(!vet)return;
    const value=tradeValue(l,id(vet.player),buyer);
    const candidates=allTeam(l.teams[buyer]).filter(e=>e.slot!=='il'&&!reserved.has(id(e.player))&&id(e.player)!==id(vet.player)).map(e=>({key:id(e.player),value:tradeValue(l,id(e.player),seller)}));
    if(settings(l).tradePicks)for(const p of l.franchise.picks.filter(p=>p.owner===buyer&&!p.used&&!reserved.has(`pick:${p.id}`)))candidates.push({key:`pick:${p.id}`,value:pickValue(l,p)});
    candidates.sort((a,b)=>Math.abs(a.value-value)-Math.abs(b.value-value));
    const pick=candidates.find(c=>Math.min(c.value,value)/Math.max(c.value,value)>=0.7);
    if(pick) {
      try { proposeTrade(l,buyer,seller,[pick.key],[id(vet.player)]); }
      catch(error) { log(l,'trade',`CPU proposal cancelled before posting: ${error.message}`); }
    }
  }
  function dayEnd(l) {
    if(!l.franchise||l.franchise.lastDay===l.clock)return;
    l.franchise.lastDay=l.clock;
    for(const [ti,t]of l.teams.entries())for(const key of new Set(t.il.map(e=>id(e.player)))) {
      const entry=t.il.find(e=>id(e.player)===key);
      const person=l.franchise.people[id(entry.player)],inj=person.injury;
      inj.remaining=Math.max(0,inj.remaining-1);inj.minRemaining=Math.max(0,inj.minRemaining-1);
      if(inj.remaining===0&&inj.minRemaining===0) {
        if(!inj.recovered){inj.recovered=true;log(l,'recovery',`${entry.player.name} is eligible to return from the IL.`,{team:ti,key:id(entry.player)});}
        if(ti!==l.settings.myTeam||settings(l).autoManage)activate(l,ti,id(entry.player));
      }
    }
    for(const key of new Set(l.franchise.freeAgents.map(id))) {
      const person=l.franchise.people[key],inj=person.injury;
      if(!inj)continue;
      inj.remaining=Math.max(0,inj.remaining-1);inj.minRemaining=Math.max(0,inj.minRemaining-1);
      if(inj.remaining===0&&inj.minRemaining===0){delete person.injury;log(l,'recovery',`Free agent ${person.name} completed rehabilitation.`,{key});}
    }
  }
  function dayStart(l) {
    if(!l.franchise)return;
    for(const [ti,t]of l.teams.entries())if(ti!==l.settings.myTeam||settings(l).autoManage)for(const key of new Set(t.il.map(e=>id(e.player)))) {
      const inj=l.franchise.people[key].injury;
      if(inj.remaining===0&&inj.minRemaining===0)activate(l,ti,key);
    }
    executeTrades(l);
    if(l.franchise.tradeDay!==l.clock) {
      l.franchise.tradeDay=l.clock;
      cpuTrade(l);
    }
  }
  function finalizeAwards(l) {
    if(l.awards||settings(l).awards===false)return l.awards||[];
    const awards=[],add=(award,group,row,reason)=>{if(row)awards.push({award,group,name:row.name,team:row.team,key:row.key||null,reason});};
    const rows=kind=>Object.entries(l.stats.reg[kind]).map(([key,row])=>({...row,key}));
    const bat=rows('bat'),pit=rows('pit');
    const batScore=r=>(r.h||0)+(r.d||0)+(r.t||0)*2+(r.hr||0)*3+(r.bb||0)*0.7+(r.sb||0)*0.3;
    const pitScore=r=>(r.outs||0)*0.5+(r.k||0)*0.65-(r.r||0)*1.7-(r.bb||0)*0.3;
    const best=(list,score)=>list.slice().sort((a,b)=>score(b)-score(a)||a.name.localeCompare(b.name))[0];
    const entries=l.teams.flatMap((t,ti)=>allTeam(t).map(e=>({key:id(e.player),player:e.player,team:ti})));
    const get=(key,kind)=>entries.find(e=>e.key===key&&(!kind||!!e.player.role===(kind==='pit')));
    const inGroup=(list,group)=>list.flatMap(row=>{
      if(!row.stints)return l.teams[row.team]?.league===group?[row]:[];
      const stints=Object.entries(row.stints).filter(([team])=>l.teams[team]?.league===group);
      if(!stints.length)return [];
      const totals=Object.fromEntries(Object.entries(row).filter(([field,value])=>field!=='team'&&typeof value==='number').map(([field])=>[field,0]));
      for(const [,stats]of stints)for(const [field,value]of Object.entries(stats))totals[field]=(totals[field]||0)+value;
      return [{...row,...totals,team:l.teams[row.team]?.league===group?row.team:Number(stints[0][0])}];
    });
    for(const group of [...new Set(l.teams.map(t=>t.league))]) {
      const b=inGroup(bat,group).filter(r=>r.pa>0),p=inGroup(pit,group).filter(r=>r.outs>0);
      const mvp=new Map(b.map(r=>[r.key,{...r,awardScore:batScore(r)}]));
      for(const row of p) {
        const existing=mvp.get(row.key);
        if(existing)existing.awardScore+=pitScore(row)*0.6;
        else mvp.set(row.key,{...row,awardScore:pitScore(row)});
      }
      add('MVP',group,best([...mvp.values()],r=>r.awardScore),'Weighted offensive / pitching production, with two-way contributions; not WAR.');
      add('Cy Young',group,best(p,pitScore),'Innings, strikeouts and run prevention.');
      add('Gold Glove (P)',group,best(p,r=>(get(r.key,'pit')?.player.field??40)*Math.sqrt(r.outs||0)),'Pitcher fielding-rating / innings proxy; defensive runs are not tracked.');
      add('Reliever of the Year',group,best(p.filter(r=>get(r.key,'pit')?.player.role!=='SP'||r.gs<r.g/2),r=>pitScore(r)+(r.sv||0)*4),'Relief production and saves.');
      const rookies=[...b.map(r=>({...r,awardScore:batScore(r)})),...p.map(r=>({...r,awardScore:pitScore(r)}))].filter(r=>l.franchise?.people[r.key]?.rookie);
      add('Rookie of the Year',group,best(rookies,r=>r.awardScore),'League rookie eligibility and season production.');
      for(const pos of [...E.POSITIONS,'DH']) {
        const eligible=b.filter(r=>(get(r.key)?.player.pos||get(r.key)?.player.natural)===pos);
        add(`Silver Slugger (${pos})`,group,best(eligible,batScore),'Production by roster position.');
        if(pos!=='DH')add(`Gold Glove (${pos})`,group,best(eligible,r=>(get(r.key)?.player.field||0)*Math.sqrt(r.g||0)),'Fielding-rating / playing-time proxy; defensive runs are not tracked.');
      }
      const team=l.teams.map((t,team)=>({team,name:t.name,...l.rec[team]})).filter(t=>l.teams[t.team].league===group);
      const winner=best(team,r=>r.w/Math.max(1,r.w+r.l));
      add('Team of the Year',group,winner,'Best regular-season winning percentage.');
      if(winner)add('Manager of the Year',group,{...winner,name:`${winner.name} coaching staff`},'Team success proxy; individual managers are not modeled.');
      const comeback=[...b,...p].filter(r=>l.franchise?.people[r.key]?.injuries.some(i=>i.year===l.franchise.year-1));
      add('Comeback Player',group,best(comeback,r=>r.pa?batScore(r):pitScore(r)),'Production after a prior-season injury.');
      if(settings(l).funAwards) {
        add('Fleet Feet',group,best(b,r=>(r.sb||0)-(r.cs||0)*0.5),'Net stolen-base production.');
        add('Moonshot Crown',group,best(b,r=>r.hr||0),'Home-run leader.');
        add('Iron Player',group,best(b,r=>r.g||0),'Most games played.');
      }
    }
    for(const [kind,name,score]of [['bat','Postseason MVP',r=>(r.h||0)+(r.hr||0)*3+(r.bb||0)*0.7],['pit','Postseason Pitcher',r=>(r.outs||0)*0.5+(r.k||0)*0.65-(r.r||0)*1.7]]) {
      const list=Object.entries(l.stats.post[kind]).map(([key,r])=>({...r,key}));
      add(name,'Postseason',best(list,score),'Whole-postseason production.');
      if(l.champion!==null)add(kind==='bat'?'Championship MVP':'Championship Pitcher','Champions',best(list.filter(r=>r.team===l.champion),score),'Champion postseason-production proxy; series-specific box scores are not retained.');
    }
    l.awards=awards;
    return awards;
  }
  function development(l,p,person,r) {
    const before=overall(p),injuredDays=person.injuries.filter(i=>i.year===l.franchise.year).reduce((n,i)=>n+i.days,0);
    const age=person.age;
    for(const key of Object.keys(person.potential)) {
      if(!Number.isFinite(p[key]))continue;
      const physical=['speed','arm','velo','stamina','field'].includes(key);
      const peak=person.peak+(key==='eye'||key==='control'?2:0)-(key==='speed'?2:0);
      const growth=age<peak?Math.max(0,person.potential[key]-p[key])*(person.prospect?(age<24?0.22:0.14):(age<24?0.15:0.09)):0;
      const decline=age>peak?(age-peak)*(physical?0.34:0.2):0;
      const injuryPenalty=physical?Math.min(4,injuredDays/150):0;
      const noise=r.gauss()*(age<25?2.2:1.2);
      p[key]=Math.max(0,Math.round((p[key]+growth-decline-injuryPenalty+noise)*10)/10);
    }
    person.age++;p.age=person.age;p.ageSource='League aging (frozen starting-year biography)';
    person.health=clamp(person.health+(injuredDays?0:3),10,100);
    const change=overall(p)-before;
    l.franchise.development.push({key:id(p),name:p.name,before,after:overall(p),age:person.age,change});
    person.lastOverall=overall(p);
    return change;
  }
  function offseasonStart(l) {
    initialize(l);
    if(!l.franchise||!settings(l).aging)throw new Error('Aging is not enabled for this league.');
    if(l.phase!=='done')throw new Error('Finish the season before starting the offseason.');
    finalizeAwards(l);
    if(!l.franchise.offseason)l.franchise.offseason={stage:0,completed:[],signings:[],retirements:[],draftLog:[]};
    return l.franchise.offseason;
  }
  const stages=['Awards review','Development & retirements','Contracts & arbitration','Free agency','Amateur draft','Ready for next season'];
  function advanceOffseason(l) {
    const off=offseasonStart(l),f=l.franchise;
    if(off.stage>=5)return off;
    if(off.stage===1) {
      f.development=[];
      const seen=new Set();
      const entries=[...l.teams.flatMap((t,ti)=>allTeam(t).map(e=>({...e,team:ti}))),...f.freeAgents.map(player=>({player,team:null,slot:'freeAgents'}))];
      for(const {player:p,team}of entries) {
        const key=id(p);if(seen.has(key))continue;seen.add(key);
        const m=f.people[key],r=rng(l,`development:${key}`);
        const stats=l.stats.reg[m.kind][key]||{};
        m.history.push({year:f.year,team,overall:overall(p),age:m.age,stats:clone(stats)});
        for(const kind of m.kinds)for(const [k,v]of Object.entries(l.stats.reg[kind][key]||{}))if(typeof v==='number'&&!['team'].includes(k))m.career[kind][k]=(m.career[kind][k]||0)+v;
        m.career.seasons++;
        const service=Math.min(1,(m.activeDays||0)/Math.max(1,l.settings.gamesPerTeam));
        m.rookie=m.rookie&&(m.career.bat.ab||0)<130&&(m.career.pit.outs||0)<150&&service*162<45;
        m.service+=service;m.activeDays=0;
        development(l,p,m,r);
        for(const entry of copies(l,key)) {
          entry.player.age=p.age;entry.player.ageSource=p.ageSource;
          for(const attribute of Object.keys(m.potential))if(p[attribute]!==undefined)entry.player[attribute]=p[attribute];
        }
        const ov=overall(p);
        const production=m.kind==='bat'&&stats.pa?((stats.h||0)+(stats.bb||0))/stats.pa+((stats.h||0)+(stats.d||0)+(stats.t||0)*2+(stats.hr||0)*3)/Math.max(1,stats.ab||0):m.kind==='pit'&&stats.outs?(stats.r||0)*27/stats.outs:null;
        const performance=production===null?0:m.kind==='bat'?(production<0.55?0.08:production>0.85?-0.08:0):(production>6?0.08:production<3?-0.08:0);
        const retiredChance=m.age<32?0:clamp((m.age-33)*0.055+(ov<45?0.12:ov>70?-0.12:0)+performance+(100-m.health)*0.004+(team===null?0.12:0)-(m.contract&&m.contract.end>f.year?0.12:0),0,0.95);
        if(r.next()<retiredChance) {
          remove(l,key,true);m.retired=true;
          f.retired.push({player:clone(p),year:f.year,age:m.age,reason:m.health<65?'Health / injury history':team===null?'No roster offer / performance':'Age / performance'});
          off.retirements.push(key);log(l,'retired',`${p.name} retired at ${m.age}.`);
        }
      }
    } else if(off.stage===2) {
      const processed=new Set();
      for(const [ti,t]of l.teams.entries()) {
        for(const {player:p}of [...allTeam(t)]) {
          if(processed.has(id(p)))continue;processed.add(id(p));
          const m=f.people[id(p)];
          if(m.contract&&m.contract.end>f.year)continue;
          if(t.farm.includes(p)&&m.service===0&&m.contract?.salary===0){m.contract={start:f.year+1,end:f.year+1,salary:0,source:'Minor-league developmental renewal'};continue;}
          if(m.service<6) {
            const salary=m.service<3?minimumFor(l,f.year+1):Math.round(Math.max(minimumFor(l,f.year+1),demand(l,p)*Math.min(0.8,0.35+(m.service-3)*0.15))/1000)*1000;
            m.contract={start:f.year+1,end:f.year+1,salary,source:m.service<3?'Pre-arbitration renewal':'Simulated arbitration'};
          } else {
            const moved=remove(l,id(p),true);m.contract=null;f.freeAgents.push(moved.player,...moved.companions.map(e=>e.player));
            log(l,'free-agent',`${p.name} entered free agency.`,{key:id(p),team:ti});
          }
        }
      }
      for(let i=0;i<l.teams.length*3;i++) {
        const p=generated(l,`fa-depth:${i}`,i%3===0?'pit':'bat',rng(l,`fa-age:${i}`).int(24,33));
        f.people[id(p)].contract=null;f.freeAgents.push(p);
      }
    } else if(off.stage===3) {
      cpuSign(l,true);
    } else if(off.stage===4) {
      runDraft(l);
    }
    off.completed.push(stages[off.stage]);off.stage++;
    if(off.stage===5) {
      for(let ti=0;ti<l.teams.length;ti++) {
        rebalance(l,ti);
        if(ti!==l.settings.myTeam||settings(l).autoManage)optimize(l,ti);
      }
      for(const [ti,t]of l.teams.entries()){t.finance.spentTax=tax(l,ti);log(l,'finance',`${t.name} projected luxury tax: $${Math.round(t.finance.spentTax).toLocaleString()}.`,{team:ti});}
    }
    return off;
  }
  function demand(l,p) {
    const m=l.franchise.people[id(p)],ov=overall(p);
    const year=l.franchise.year+(l.phase==='done'?1:0),inflation=1.025**(year-settings(l).startYear);
    return Math.max(minimumFor(l,year),Math.round(((Math.max(10,ov)/50)**3*6500000)*inflation*(m.age>34?0.75:1)*(m.health/100)/100000)*100000);
  }
  function sign(l,ti,key,years,salary,force=false) {
    if(!l.franchise||!settings(l).aging)throw new Error('Contracts require an aging league.');
    const off=l.franchise.offseason;
    if(l.phase==='done'&&off?.stage!==3)throw new Error('Sign free agents during the free-agency stage.');
    const entry=locate(l,key);
    if(!entry||entry.team!==null)throw new Error('Choose an available free agent.');
    if(!Number.isInteger(years)||years<1||years>15||!Number.isFinite(salary)||salary<minimumFor(l,l.franchise.year+(l.phase==='done'?1:0)))throw new Error('Enter 1-15 years and at least the league-minimum salary.');
    const p=entry.player,m=l.franchise.people[key],ask=demand(l,p);
    if(!force&&salary<ask*0.85)throw new Error(`${p.name} declined: seeking roughly $${Math.round(ask).toLocaleString()} per year.`);
    if(!force&&payroll(l,ti)+salary>l.teams[ti].finance.budget)throw new Error('This offer exceeds the team payroll budget. Commissioner can adjust its budget first.');
    const moved=remove(l,key,true);
    const year=l.phase==='done'?l.franchise.year+1:l.franchise.year;
    m.contract={start:year,end:year+years-1,salary,source:force?'Commissioner contract':'Negotiated free-agent contract'};
    if(m.injury)for(const player of [p,...moved.companions.map(e=>e.player)])l.teams[ti].il.push({player,slot:player.role?(player.role==='SP'?'rotation':'bullpen'):'bench',injury:m.injury});
    else l.teams[ti].farm.push(p,...moved.companions.map(e=>e.player));
    rebalance(l,ti);
    if(ti!==l.settings.myTeam||settings(l).autoManage)optimize(l,ti);
    l.franchise.offseason?.signings.push({key,team:ti,years,salary});
    log(l,'signing',`${l.teams[ti].name} signed ${p.name}: ${years} year(s), $${Math.round(salary).toLocaleString()}/year.`,{key,team:ti});
  }
  function extend(l,ti,key,years,salary) {
    const entry=locate(l,key),m=l.franchise.people[key];
    if(!entry||entry.team!==ti||!settings(l).aging)throw new Error('Choose a rostered player in an aging league.');
    if(!Number.isInteger(years)||years<1||years>15||!Number.isFinite(salary)||salary<minimumFor(l,l.franchise.year+(l.phase==='done'?1:0)))throw new Error('Enter 1-15 years and at least minimum salary.');
    if(salary<demand(l,entry.player)*0.85)throw new Error('Player declined the extension: salary is below his market expectation.');
    if(payroll(l,ti)-(m.contract?.salary||0)+salary>l.teams[ti].finance.budget)throw new Error('Extension exceeds payroll budget.');
    const start=l.phase==='done'?l.franchise.year+1:l.franchise.year;
    m.contract={start,end:start+years-1,salary,source:'Negotiated extension'};
    log(l,'contract',`${entry.player.name} agreed to ${years} year(s) at $${Math.round(salary).toLocaleString()}/year.`,{team:ti,key});
  }
  function release(l,ti,key) {
    const entry=locate(l,key),m=l.franchise.people[key];
    if(!entry||entry.team!==ti)throw new Error('Choose a player on this team.');
    if(entry.slot==='il')throw new Error('An injured player must recover before release in this model.');
    if(m.contract&&m.contract.salary>0)l.teams[ti].finance.deadMoney.push(clone(m.contract));
    const moved=remove(l,key,true);m.contract=null;l.franchise.freeAgents.push(moved.player,...moved.companions.map(e=>e.player));
    rebalance(l,ti);
    log(l,'release',`${l.teams[ti].name} released ${entry.player.name}; remaining guarantees stay on its payroll.`,{team:ti,key});
  }
  function cpuSign(l,includeMy=false) {
    const f=l.franchise;
    const free=[...new Map(f.freeAgents.map(p=>[id(p),p])).values()].sort((a,b)=>overall(b)-overall(a));
    for(const p of free) {
      const ask=demand(l,p),m=f.people[id(p)];
      const candidates=l.teams.map((t,i)=>({i,room:t.finance.budget-payroll(l,i),need:roster(t).filter(e=>!!e.player.role===!!p.role).length})).filter(t=>(includeMy||t.i!==l.settings.myTeam||settings(l).autoManage)&&t.room>=ask).sort((a,b)=>a.need-b.need||b.room-a.room);
      if(!candidates.length)continue;
      const ti=candidates[0].i;
      const years=clamp(Math.round((36-m.age)/3),1,5);
      sign(l,ti,id(p),years,ask);
    }
  }
  function prepareDraft(l) {
    const f=l.franchise,off=f.offseason;
    if(!off||off.stage!==4)throw new Error('The draft opens during the amateur draft stage.');
    const year=f.year+1;
    ensurePicks(l,year);
    if(!f.draft.length)for(let i=0;i<l.teams.length*settings(l).draftRounds+Math.max(10,l.teams.length);i++)f.draft.push(generated(l,`draft:${year}:${i}`,i%3===0?'pit':'bat'));
    const order=l.teams.map((t,i)=>i).sort((a,b)=>l.rec[a].w/Math.max(1,l.rec[a].w+l.rec[a].l)-l.rec[b].w/Math.max(1,l.rec[b].w+l.rec[b].l)||a-b);
    return f.picks.filter(p=>p.year===year&&!p.used).sort((a,b)=>a.round-b.round||order.indexOf(a.original)-order.indexOf(b.original));
  }
  function draftNext(l,key) {
    const f=l.franchise,off=f.offseason,pick=prepareDraft(l)[0];
    if(!pick)throw new Error('Every draft pick has been used.');
    const player=key?f.draft.find(p=>id(p)===key):f.draft.slice().sort((a,b)=>scout(l,b).high-scout(l,a).high||overall(b)-overall(a))[0];
    if(!player)throw new Error('Choose an available prospect.');
    f.draft.splice(f.draft.indexOf(player),1);
    const m=f.people[id(player)];
    m.contract={start:f.year+1,end:f.year+1,salary:0,source:'Minor-league developmental contract'};
    m.service=0;m.rookie=true;
    l.teams[pick.owner].farm.push(player);pick.used=true;
    off.draftLog.push({pick:pick.id,round:pick.round,team:pick.owner,key:id(player),name:player.name,age:m.age,scout:scout(l,player)});
    return player;
  }
  function runDraft(l) {
    const f=l.franchise;
    while(prepareDraft(l).length)draftNext(l);
    for(const p of f.draft){f.people[id(p)].contract=null;f.freeAgents.push(p);}
    f.draft=[];
    log(l,'draft',`${f.year+1} amateur draft completed: ${f.offseason.draftLog.length} selections.`);
  }
  function scout(l,p) {
    const m=l.franchise?.people[id(p)];
    if(!m)return {low:Math.round(overall(p)),high:Math.round(overall(p))};
    const projected={...p,...m.potential},trueOverall=overall(projected);
    const r=rng(l,`scout:${id(p)}`);
    const estimate=trueOverall+(r.next()-0.5)*m.scoutError;
    return {low:Math.max(0,Math.floor(estimate-m.scoutError)),high:Math.ceil(estimate+m.scoutError)};
  }
  function prepareNext(l) {
    if(!l.franchise)return;
    const offseasonRecovery=()=>{
      for(const person of Object.values(l.franchise.people))if(person.injury&&!person.retired) {
        person.injury.remaining=Math.max(0,person.injury.remaining-120);person.injury.minRemaining=Math.max(0,person.injury.minRemaining-120);
        if(locate(l,person.key)?.team===null&&person.injury.remaining===0&&person.injury.minRemaining===0)delete person.injury;
      }
    };
    if(!settings(l).aging) {
      l.franchise.lastDay=-1;l.franchise.tradeDay=-1;
      offseasonRecovery();
      return;
    }
    const off=offseasonStart(l);
    if(off.stage!==5)throw new Error('Complete the offseason stages before starting the next season.');
    l.franchise.year++;
    l.settings.franchise.taxThreshold=Math.round(settings(l).taxThreshold*1.025);
    l.franchise.offseason=null;l.franchise.lastDay=-1;l.franchise.tradeDay=-1;
    l.franchise.picks=l.franchise.picks.filter(p=>p.year>=l.franchise.year&&!p.used);
    ensurePicks(l,l.franchise.year+1);
    ensurePicks(l,l.franchise.year+2);
    l.settings.startDate=`${l.franchise.year}-03-26`;
    delete l.scheduleImport;
    delete l.festivitiesCalendar;
    for(const t of l.teams) {
      t.finance.budget=Math.round(t.finance.budget*1.025);
      t.finance.deadMoney=t.finance.deadMoney.filter(c=>c.end>=l.franchise.year);
    }
    offseasonRecovery();
  }
  return {defaults,settings,id,roster,allTeam,overall,enabled,initialize,minimum,minimumFor,locate,rebalance,optimize,payroll,tax,injure,afterGame,activate,move,dayEnd,dayStart,
    contention,tradeValue,proposeTrade,veto,finalizeAwards,offseasonStart,advanceOffseason,stages,demand,sign,extend,release,cpuSign,scout,prepareNext,ensurePicks,prepareDraft,draftNext};
});
