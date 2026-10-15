(function(root) {
  'use strict';
  const F=root.Franchise,E=root.GameEngine,L=root.LeagueEngine;
  const esc=v=>String(v??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  const money=v=>`$${(v/1e6).toFixed(2)}m`;
  const production=(row,kind)=>kind==='pit'
    ?`${Math.floor((row.outs||0)/3)}.${(row.outs||0)%3} IP · ${row.k||0} K · ${row.bb||0} BB · ${row.w||0} W · ${row.sv||0} SV · ${row.outs?(row.r*27/row.outs).toFixed(2):'—'} RA/9`
    :`${row.pa||0} PA · ${row.h||0} H · ${row.hr||0} HR · ${row.sb||0} SB · ${row.ab?((row.h||0)/row.ab).toFixed(3):'—'} AVG`;
  const option=(v,label,selected)=>`<option value="${esc(v)}"${String(v)===String(selected)?' selected':''}>${esc(label)}</option>`;
  const note='<p class="note">Commissioner controls are available for every club. The selected My team in Settings determines which club uses manual recovery and free-agent decisions.</p>';
  const guide=`<details class="card"><summary>Franchise Guide / model boundaries</summary>
    <p>Only the starting roster season initializes real-world player ratings. MLB birth dates are immutable. Starting service time is estimated from debut year, not exact days. Thereafter, all development, draft classes, transactions, injuries and retirement decisions are simulated within this league. Starting reported guarantees have linked sources; all other deals are explicitly generated. Reported deals use even nominal AAV, not actual bonus/deferral cash flows or opt-outs.</p>
    <p>Shipped financial fact coverage: 1,572 selected-year annual salary records across 2015–16, plus verified long-term guarantees for Judge, Ohtani, Trout and Betts when applicable. Annual salary alone does not establish a remaining guarantee; unknown remaining terms are modeled as one year. Other players' contracts are generated, not claimed to be actual MLB contracts.</p>
    <p>Players usually peak at 27–30, centered around 28–29. Physical tools decline sooner than discipline/control. Prospect development has uncertainty, setbacks and health effects; scouting shows estimated potential ranges, not exact ceilings. There is no rating cap. Careers and injury history are retained. Retirement depends on age, production/ability, health, roster offers and remaining contracts.</p>
    <p>Contracts: pre-arbitration renewals, simulated arbitration below six service years, then free agency. Service accrues in normalized seasons for custom-length schedules. Rookie eligibility uses 130 career AB / 50 career IP plus 45 normalized active-roster days; untouched farm prospects retain eligibility. Future minimum salaries, market asking prices, budgets and tax thresholds use a modeled 2.5% annual economic growth rate, not later real-world CBA data. Budgets are soft commissioner-adjustable constraints on signings, not a hard cap. Luxury tax is a simplified single-rate annual charge; tax tiers, revenue sharing, option years, buyouts, no-trade clauses, waivers, Rule 5 and 40-man options are not modeled. Draft pick trades are an optional fictional rule, not standard MLB practice.</p>
    <p>Injured lists: 10-day hitters, 15-day pitchers/two-way players, 7-day concussion and 60-day long injuries. A player must finish both recovery and the minimum stay. No retroactive placement. The model does not enforce a separate 40-man roster. Long injuries carry over through a 120-day modeled offseason. CPU replacements are automatic; manual teams get temporary replacements and choose eligible activations. Injury frequency 1–10 scales exposure; it does not simply multiply severity.</p>
    <p>CPU trades balance estimated value, production, age, health, salary, years of control and contention. Pending offers reserve their assets. A proposal completes only after a full calendar-day veto window. Simulating several days can pass that window. Deadline timing is relative to the season calendar. Invalidated offers are canceled visibly.</p>
    <p>Awards are deterministic production-based selections, not official voting or WAR. Gold Gloves use a fielding-rating / playing-time proxy because defensive runs are not recorded. Championship awards use champion postseason totals rather than unavailable series-only box scores. Named managers are not modeled.</p>
    <p>Real historical MLB starts also seed farm systems with notable prospects found on that season's actual MLB-affiliated minor-league rosters, when matching season data is bundled. Players must later have reached MLB and met a career playing-time / production threshold; lesser-known or never-promoted players remain generated placeholders. Their reported debut/biography and organization are historical. Their prospect skill baseline and hidden potential are retrospective estimates from the best qualifying MLB season, so this intentionally uses future career outcomes to make famous prospects develop into the players users remember. The real affiliate's exact day-by-day roster moves are not reconstructed.</p>
    <p>Annual draft classes enter the farm; there are no full minor-league schedules. Promote/demote via roster swaps. Offseason stages can be reviewed individually or automated. Save/export before major commissioner changes; all state is local to this browser.</p></details>`;
  function render(kind,l,el,view,save,refresh) {
    el.setAttribute('data-no-memory','');
    const g=id=>el.querySelector(`#${id}`);
    const teamOptions=selected=>l.teams.map((t,i)=>option(i,t.name,selected)).join('');
    const status=message=>{const node=g('fr-status');if(node)node.textContent=message;};
    const action=fn=>async()=>{
      try {await fn();if(save()===false)throw new Error('Browser storage is full. Export the league before continuing.');refresh();}
      catch(error){status(error.message);}
    };
    const ready=()=>{if(!l.franchise){el.innerHTML=`<div class="card"><h2>Franchise management</h2><p>Enable injuries, CPU trades or aging in league setup to use this panel. Aging can only be selected when creating the league.</p></div>${guide}`;return false;}return true;};
    const playerLabel=p=>`${p.name} · ${p.pos||p.role} · age ${p.age??E.playerAge(p)??'?'} · OVR ${Math.round(F.overall(p))}`;
    const playerOptions=list=>list.map(p=>option(F.id(p),playerLabel(p))).join('');
    const table=(headers,rows)=>`<div class="scroll"><table><thead><tr>${headers.map(h=>`<th class="l">${h}</th>`).join('')}</tr></thead><tbody>${rows.join('')||`<tr><td class="l" colspan="${headers.length}">None</td></tr>`}</tbody></table></div>`;
    const td=values=>`<tr>${values.map(v=>`<td class="l">${v}</td>`).join('')}</tr>`;
    if(kind==='awards') {
      const awards=l.awards||[];
      el.innerHTML=`<div class="card"><h2>Season awards</h2><p>${!F.settings(l).awards?'Awards are disabled.':l.phase!=='done'?'Winners will be announced after the season is complete.':'Final season awards'}</p>${table(['Award','League','Winner','Club','Selection method'],awards.map(a=>td([esc(a.award),esc(a.group),esc(a.name),l.teams[a.team]?esc(l.teams[a.team].name):'—',esc(a.reason)])))}</div>
      ${l.history.filter(h=>h.awards?.length).map(h=>`<details class="card"><summary>${esc(h.label)} awards</summary>${table(['Award','Winner'],h.awards.map(a=>td([esc(a.award),esc(a.name)])))}</details>`).join('')}${guide}`;
      return;
    }
    if(!ready())return;
    const f=l.franchise,s=F.settings(l);
    if(kind==='il') {
      const entries=[...new Map([...l.teams.flatMap((t,ti)=>(t.il||[]).map(e=>[F.id(e.player),{...e,ti,injury:f.people[F.id(e.player)].injury}])),...f.freeAgents.filter(p=>f.people[F.id(p)].injury).map(player=>[F.id(player),{player,ti:null,injury:f.people[F.id(player)].injury}])]).values()];
      el.innerHTML=`<div class="card"><h2>League-wide Injured List</h2><p>Updated with each simulated league day. Frequency: ${s.injuryRisk}/10 · ${s.injuries?'new injuries enabled':'new injuries disabled; current recoveries continue'}.</p>
        ${table(['Player','Club','IL','Injury','Injured on','Estimated recovery','Days remaining','Recovery chart','Action'],entries.map(e=>{
          const inj=e.injury,elapsed=inj.days-inj.remaining,progress=100*elapsed/Math.max(1,inj.days);
          return td([esc(e.player.name),e.ti===null?'Free agent':esc(l.teams[e.ti].name),e.ti===null?'FA rehabilitation':`${inj.il}-day`,esc(inj.name),`${inj.year} / season day ${inj.start+1}`,`${inj.estimated[0]}–${inj.estimated[1]} days`,`${inj.remaining} recovery / ${inj.minRemaining} minimum IL`,`<progress max="100" value="${progress}" aria-label="${esc(e.player.name)} recovery">${Math.round(progress)}%</progress>`,e.ti!==null&&inj.remaining===0&&inj.minRemaining===0?`<button data-activate="${esc(F.id(e.player))}" data-team="${e.ti}">Activate</button>`:'Recovering']);
        }))}<div id="fr-status" class="err" role="status"></div></div>
        <details class="card"><summary>Lifetime injury history</summary>${table(['Player','Year','Injury','Initial duration'],Object.values(f.people).filter(p=>p.injuries.length).flatMap(p=>p.injuries.map(i=>td([esc(p.name),i.year,esc(i.name),`${i.days} days`]))))}</details>${guide}`;
      el.querySelectorAll('[data-activate]').forEach(b=>b.addEventListener('click',action(()=>F.activate(l,Number(b.dataset.team),b.dataset.activate))));
      return;
    }
    if(kind==='trades') {
      const a=Math.min(view.tradeA??l.settings.myTeam??0,l.teams.length-1),b=view.tradeB??(a===0?1:0);
      const deadline=Math.floor((l.schedule.length-1)*s.tradeDeadline);
      const assets=ti=>F.allTeam(l.teams[ti]).filter(e=>e.slot!=='il').map(e=>option(F.id(e.player),`${playerLabel(e.player)} · value ${F.tradeValue(l,F.id(e.player),ti).toFixed(1)}`)).join('')
        +(s.tradePicks?f.picks.filter(p=>p.owner===ti&&!p.used).map(p=>option(`pick:${p.id}`,`${p.year} round ${p.round} pick (${l.teams[p.original].abbr})`)).join(''):'');
      el.innerHTML=`<div class="card"><h2>Trade center</h2>${note}<p>${s.trades?'Enabled':'Disabled'} · Deadline: ${esc(L.dateOf(l,deadline))} · Current date: ${esc(L.dateOf(l,l.clock))}. Proposals remain pending for one league day. Veto before the execution date; there is no instant-approval shortcut.</p>
        ${table(['Teams','From first club','From second club','Proposed','Executes','Status / action'],f.trades.map(t=>td([`${esc(l.teams[t.a].abbr)} / ${esc(l.teams[t.b].abbr)}`,t.labelsA.map(esc).join('<br>'),t.labelsB.map(esc).join('<br>'),esc(L.dateOf(l,t.proposed)),esc(L.dateOf(l,t.execute)),`${esc(t.status)}${t.reason?' · '+esc(t.reason):''}${t.status==='pending'?` <button data-veto="${esc(t.id)}">Veto</button>`:''}`])))}</div>
        <div class="card"><h3>Propose a trade</h3><div class="row"><label>First team<select id="trade-a">${teamOptions(a)}</select></label><label>Second team<select id="trade-b">${teamOptions(b)}</select></label></div><div class="grid2"><label>First team sends (Ctrl-click multiple)<select multiple size="9" id="trade-give-a">${assets(a)}</select></label><label>Second team sends<select multiple size="9" id="trade-give-b">${assets(b)}</select></label></div>
        <label><input type="checkbox" id="trade-force"> Commissioner override of CPU value check</label><button id="trade-propose"${s.trades?'':' disabled'}>Queue with one-day veto window</button><div id="fr-status" class="err" role="status"></div></div>${guide}`;
      el.querySelectorAll('[data-veto]').forEach(button=>button.addEventListener('click',action(()=>F.veto(l,button.dataset.veto))));
      for(const [key,node]of [['tradeA','trade-a'],['tradeB','trade-b']])g(node).addEventListener('change',()=>{view[key]=Number(g(node).value);refresh();});
      g('trade-propose').addEventListener('click',action(()=>F.proposeTrade(l,a,b,[...g('trade-give-a').selectedOptions].map(o=>o.value),[...g('trade-give-b').selectedOptions].map(o=>o.value),g('trade-force').checked)));
      return;
    }
    if(kind==='offseason') {
      if(!s.aging||l.phase!=='done') {el.innerHTML=`<div class="card"><h2>Offseason</h2><p>${s.aging?'Finish the season to open awards, development, contracts, free agency and the draft.':'Enable aging at league creation for the staged offseason. Non-aging leagues can start another season in History.'}</p></div>${guide}`;return;}
      const off=F.offseasonStart(l);
      const picks=off.stage===4?F.prepareDraft(l):[];
      if(save()===false){el.innerHTML='<p>Could not save offseason state. Export the league before continuing.</p>';return;}
      el.innerHTML=`<div class="card"><h2>${f.year} offseason · ${esc(F.stages[off.stage])}</h2><ol>${F.stages.map((stage,i)=>`<li>${i<off.stage?'✓ ':i===off.stage?'→ ':''}${esc(stage)}</li>`).join('')}</ol>
        ${off.stage<5?`<button id="off-step">Complete ${esc(F.stages[off.stage])}</button> <button id="off-auto">Automate remaining offseason</button>`:'<button id="off-next" class="primary">Start next season</button>'}
        <p class="note">At Free agency, sign selected players on the Franchise tab before completing the stage. Completing that stage asks the CPU to finish the market for all teams. At Draft, pick manually below or automate the remaining selections. Starting the next season archives awards and the completed offseason.</p><div id="fr-status" class="err" role="status"></div></div>
        ${off.stage===4?`<div class="card"><h3>Amateur draft · ${f.year+1}</h3><p>${picks.length?`On the clock: ${esc(l.teams[picks[0].owner].name)} · round ${picks[0].round} · original ${esc(l.teams[picks[0].original].abbr)} pick`:'All picks have been made. Complete this stage to continue.'}</p><label>Draft board<select id="draft-player">${playerOptions(f.draft.slice().sort((a,b)=>F.scout(l,b).high-F.scout(l,a).high))}</select></label><button id="draft-pick"${picks.length?'':' disabled'}>Draft selected prospect</button> <button id="draft-auto"${picks.length?'':' disabled'}>CPU selects next pick</button>
        ${table(['Prospect','Age','Current OVR','Scouted potential'],f.draft.slice().sort((a,b)=>F.scout(l,b).high-F.scout(l,a).high).slice(0,100).map(p=>{const scout=F.scout(l,p);return td([esc(p.name),p.age,Math.round(F.overall(p)),`${scout.low}–${scout.high}`]);}))}</div>`:''}
        <div class="card"><h3>Offseason activity</h3><p>Retirements: ${off.retirements.map(key=>esc(f.people[key].name)).join(', ')||'None yet'}</p>${table(['Drafted player','Club','Round'],off.draftLog.map(p=>td([esc(p.name),esc(l.teams[p.team].name),p.round])))}</div>
        <div class="card"><h3>Development report</h3>${table(['Player','Age','Before','After','Change'],f.development.slice().sort((a,b)=>b.change-a.change).map(d=>td([esc(d.name),d.age,d.before.toFixed(1),d.after.toFixed(1),`${d.change>=0?'+':''}${d.change.toFixed(1)}`])))}</div>${guide}`;
      if(g('off-step'))g('off-step').addEventListener('click',action(()=>F.advanceOffseason(l)));
      if(g('off-auto'))g('off-auto').addEventListener('click',action(()=>{while(f.offseason.stage<5)F.advanceOffseason(l);}));
      if(g('off-next'))g('off-next').addEventListener('click',action(()=>{L.nextSeason(l);view.tab='standings';}));
      if(g('draft-pick'))g('draft-pick').addEventListener('click',action(()=>F.draftNext(l,g('draft-player').value)));
      if(g('draft-auto'))g('draft-auto').addEventListener('click',action(()=>F.draftNext(l)));
      return;
    }
    const ti=Math.min(view.frTeam??l.settings.myTeam??0,l.teams.length-1),t=l.teams[ti];
    const list=F.allTeam(t),selected=view.frPlayer&&list.find(e=>F.id(e.player)===view.frPlayer)||list[0];
    const p=selected?.player,m=p&&f.people[F.id(p)],scout=p&&F.scout(l,p);
    const free=f.freeAgents.slice().sort((a,b)=>F.overall(b)-F.overall(a));
    const row=entry=>{
      const p=entry.player,m=f.people[F.id(p)],scout=F.scout(l,p);
      return td([`${esc(p.name)}${m?.prospect?` <span class="mute" title="${esc(m.prospectAffiliate||'Historical minor-league affiliate')}, ${m.prospectSourceYear}"> · Historical prospect</span>`:''}`,esc(entry.slot),esc(p.pos||p.role),m?.age??p.age??'?',Math.round(F.overall(p)),`${scout.low}–${scout.high}`,m?.service.toFixed(2)||'—',m?.contract?`${money(m.contract.salary)} / through ${m.contract.end}`:'No contract',m?.injury?esc(m.injury.name):`Health ${Math.round(m?.health??100)}`]);
    };
    el.innerHTML=`<div class="card"><h2>Franchise · ${f.year}</h2>${note}<label>Manage club<select id="fr-team">${teamOptions(ti)}</select></label>
      <p>Payroll ${money(F.payroll(l,ti))} / budget ${money(t.finance.budget)} · projected tax ${money(F.tax(l,ti))} · contender score ${(F.contention(l,ti)*100).toFixed(0)}%</p>
      <label>Commissioner budget ($m)<input id="fr-budget" type="number" min="1" value="${t.finance.budget/1e6}"></label><button id="fr-budget-save">Save budget</button> <button id="fr-optimize">Auto-select best active roster</button>
      ${table(['Player','Roster','Position','Age','OVR','Potential range','Service years','Salary / control','Health'],list.map(row))}</div>
      <div class="card"><h3>Player management / career</h3><label>Player<select id="fr-player">${list.map(e=>option(F.id(e.player),`${playerLabel(e.player)} (${e.slot})`,p&&F.id(p))).join('')}</select></label>
      ${m?`<p>Age ${m.age} · ${esc(p.ageSource||'saved age')} · potential ${scout.low}–${scout.high} · ${esc(m.serviceSource)}.</p>
      ${m.prospect?`<p class="note">Historical ${m.prospectSourceYear} prospect · ${esc(m.prospectAffiliate||'MLB affiliate')} · later MLB debut ${esc(p.prospectDebut||'')}. Estimated potential uses retrospective MLB peak performance; MLB career totals: ${esc(JSON.stringify(m.prospectCareer||{}))}.</p>`:''}
      <p>Contract: ${m.contract?`${money(m.contract.salary)} / ${m.contract.start}–${m.contract.end} · ${esc(m.contract.source)}${m.contract.url?` · <a href="${esc(m.contract.url)}" target="_blank" rel="noopener">Source</a>`:''}${m.contract.note?' · '+esc(m.contract.note):''}`:'None'}</p>
      <div class="row"><label>Destination<select id="fr-destination">${['farm','lineup','bench','rotation','bullpen'].map(k=>option(k,k,'farm')).join('')}</select></label><label>Swap with<select id="fr-replace"><option value="">No swap</option>${list.filter(e=>e.slot!=='il'&&F.id(e.player)!==F.id(p)).map(e=>option(F.id(e.player),`${e.player.name} (${e.slot})`)).join('')}</select></label><button id="fr-move">Move / swap</button></div>
      ${s.aging?`<div class="row"><label>Extension years<input id="fr-years" type="number" min="1" max="15" value="2"></label><label>Annual salary ($m)<input id="fr-salary" type="number" step="0.01" value="${(F.demand(l,p)/1e6).toFixed(2)}"></label><button id="fr-extend">Offer extension</button><button id="fr-release">Release (keep guarantees)</button></div>`:''}
      <p>Current ratings: ${['contact','power','eye','speed','arm','field',...(p.role?['velo','control','movement','stamina']:[])].filter(k=>Number.isFinite(p[k])).map(k=>`${esc(k.toUpperCase())} ${p[k]}`).join(' · ')}</p>
      ${table(['Season','Age','Club','OVR','Season production'],m.history.map(h=>td([h.year,h.age,h.team===null?'FA':esc(l.teams[h.team].abbr),Math.round(h.overall),esc(production(h.stats,m.kind))])))}<p>Career · ${m.career.seasons} seasons: ${esc(production(m.career.bat,'bat'))}<br>${esc(production(m.career.pit,'pit'))}</p>`:''}
      <div id="fr-status" class="err" role="status"></div></div>
      ${s.aging?`<div class="card"><h3>Free agents</h3><label>Player<select id="fa-player">${playerOptions(free)}</select></label><div class="row"><label>Years<input id="fa-years" type="number" min="1" max="15" value="1"></label><label>Annual salary ($m)<input id="fa-salary" type="number" step="0.01" value="${free[0]?(F.demand(l,free[0])/1e6).toFixed(2):1}"></label><label><input type="checkbox" id="fa-force"> Commissioner contract override</label><button id="fa-sign"${free.length?'':' disabled'}>Offer contract to join ${esc(t.abbr)}</button></div>
      ${table(['Player','Age','OVR','Asking salary'],free.slice(0,100).map(p=>td([esc(p.name),p.age,Math.round(F.overall(p)),money(F.demand(l,p))])))}</div>`:''}
      <div class="card"><h3>League news</h3>${f.news.slice(0,70).map(n=>`<p><span class="mute">${n.year} · day ${n.day+1} · ${esc(n.type)}</span> ${esc(n.text)}</p>`).join('')||'<p>No transactions yet.</p>'}</div>${guide}`;
    g('fr-team').addEventListener('change',()=>{view.frTeam=Number(g('fr-team').value);view.frPlayer=null;refresh();});
    g('fr-player').addEventListener('change',()=>{view.frPlayer=g('fr-player').value;refresh();});
    g('fr-budget-save').addEventListener('click',action(()=>{const n=Number(g('fr-budget').value);if(!Number.isFinite(n)||n<=0)throw new Error('Enter a positive budget.');t.finance.budget=n*1e6;}));
    g('fr-optimize').addEventListener('click',action(()=>F.optimize(l,ti)));
    if(g('fr-move'))g('fr-move').addEventListener('click',action(()=>F.move(l,ti,F.id(p),g('fr-destination').value,g('fr-replace').value||null)));
    if(g('fr-extend'))g('fr-extend').addEventListener('click',action(()=>F.extend(l,ti,F.id(p),Number(g('fr-years').value),Number(g('fr-salary').value)*1e6)));
    if(g('fr-release'))g('fr-release').addEventListener('click',action(async()=>{if(await root.BrowserDialog.confirm(`Release ${p.name}? Remaining guarantees stay on this club's payroll.`))F.release(l,ti,F.id(p));}));
    if(g('fa-sign'))g('fa-sign').addEventListener('click',action(()=>F.sign(l,ti,g('fa-player').value,Number(g('fa-years').value),Number(g('fa-salary').value)*1e6,g('fa-force').checked)));
    if(g('fa-player'))g('fa-player').addEventListener('change',()=>{const entry=f.freeAgents.find(p=>F.id(p)===g('fa-player').value);if(entry)g('fa-salary').value=(F.demand(l,entry)/1e6).toFixed(2);});
  }
  root.FranchiseUI={render};
})(typeof window!=='undefined'?window:globalThis);
