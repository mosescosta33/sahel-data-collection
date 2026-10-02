(() => {
'use strict';
const HASH='#event=';
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const app=()=>window.SAHEL_APP||null, st=()=>app()?.state||{};
const esc=v=>app()?.esc?app().esc(v):String(v??'');
const key=e=>String(e?.id||e?._event_id||[e?.event_date,e?.actor,e?.event_type,e?.city,e?.country,e?.title].filter(Boolean).join('|'));
function safeUrl(v){try{const u=new URL(String(v||''),location.href);return ['http:','https:'].includes(u.protocol)?u.href:''}catch(_){return ''}}
function resolve(seed){
  if(!seed)return null;
  const rows=st().events||[],k=key(seed);
  return rows.find(e=>key(e)===k)
    ||(seed.id?rows.find(e=>String(e.id||e._event_id||'')===String(seed.id)):null)
    ||rows.find(e=>String(e.event_date||'')===String(seed.event_date||'')&&String(e.title||'')===String(seed.title||'')&&String(e.actor||'')===String(seed.actor||''))
    ||seed;
}
function rows(){
  const src=(st().thirty?.latest_events?.length?st().thirty.latest_events:(st().events||[])).slice(0,24),seen=new Set(),out=[];
  src.forEach(x=>{const e=resolve(x),k=key(e);if(e&&k&&!seen.has(k)){seen.add(k);out.push(e)}});
  return out;
}
function reportKey(r){return app()?.reportKey?app().reportKey(r):String(r?.id||r?.url||r?.title||'')}
function reportsFor(e){
  e=resolve(e)||e||{};
  const urls=new Set([...(e.report_urls||[]),...(e.source_urls||[])].map(safeUrl).filter(Boolean)),out=[],seen=new Set();
  const push=r=>{if(!r)return;const k=reportKey(r)||safeUrl(r.url);if(k&&!seen.has(k)){seen.add(k);out.push(r)}};
  (st().reports||[]).forEach(r=>{const u=safeUrl(r.url);if(u&&urls.has(u))push(r)});
  (e.report_summaries||[]).forEach(x=>{
    const u=safeUrl(x?.url);if(u&&out.some(r=>safeUrl(r.url)===u))return;
    push({url:u,source:x?.source||'Unknown source',title:x?.title||'Untitled source report',article_summary:x?.summary||x?.article_summary||'',language:x?.language||'',published_at:x?.published_at||''});
  });
  if(!out.length)[...urls].forEach((u,i)=>push({url:u,source:(()=>{try{return new URL(u).hostname}catch(_){return 'Source'}})(),title:'Linked source '+(i+1)}));
  return out;
}
function ensure(){
  let d=$('#eventIntelDrawer');if(d)return d;
  const bg=document.createElement('div');bg.id='eventDrawerBackdrop';bg.className='event-drawer-backdrop';bg.hidden=true;
  d=document.createElement('aside');d.id='eventIntelDrawer';d.className='event-intel-drawer';d.setAttribute('aria-hidden','true');
  d.innerHTML='<div class="event-drawer-shell"><div class="event-drawer-nav"><button id="eventPrev">← PREVIOUS</button><span id="eventPosition">EVENT DOSSIER</span><button id="eventNext">NEXT →</button><button id="eventExpand" class="event-drawer-expand">EXPAND ⛶</button><button id="eventClose" class="event-drawer-close">×</button></div><div id="eventDrawerContent" class="event-drawer-content"></div></div>';
  document.body.append(bg,d);bg.onclick=close;$('#eventClose').onclick=close;
  $('#eventExpand').onclick=()=>{d.classList.toggle('expanded');$('#eventExpand').textContent=d.classList.contains('expanded')?'RESTORE ◱':'EXPAND ⛶'};
  document.addEventListener('keydown',ev=>{if(!document.body.classList.contains('event-drawer-open'))return;if(ev.key==='Escape')close();else if(ev.key==='ArrowLeft')$('#eventPrev')?.click();else if(ev.key==='ArrowRight')$('#eventNext')?.click()});
  return d;
}
function sourceCard(r,i){
  const title=r.translated_title||r.title||('Report '+(i+1)),summary=r.article_summary||r.translated_excerpt||r.excerpt||'No retained article summary is available.',u=safeUrl(r.url);
  const saved=app()?.isReportSaved?.(r),inArchive=(st().reports||[]).some(x=>reportKey(x)===reportKey(r));
  const sourceCode=app()?.sourceCodeForReport?.(r)||app()?.sourceCodeByName?.(r.source)||'SRC-UNASSIGNED';
  return '<article class="event-source-card"><div class="event-source-head"><span>REPORT '+(i+1)+'</span><strong>'+esc(sourceCode)+' • '+esc(r.source||'Unknown source')+'</strong><span>'+esc(String(r.language||'').toUpperCase()||'N/A')+'</span></div><h4>'+esc(title)+'</h4><div class="event-source-summary"><small>ARTICLE SUMMARY</small><p>'+esc(summary)+'</p></div><div class="event-source-meta">Published: '+esc(r.published_at?app()?.fmtTimestampUTC?.(r.published_at)||r.published_at:'UNAVAILABLE')+'</div><div class="event-source-actions">'+(u?'<a href="'+esc(u)+'" target="_blank" rel="noopener noreferrer">OPEN ORIGINAL SOURCE ↗</a>':'')+(inArchive?'<button class="event-save-one '+(saved?'saved':'')+'" data-report-key="'+esc(encodeURIComponent(reportKey(r)))+'">'+(saved?'★ SAVED':'☆ SAVE REPORT')+'</button>':'')+'</div></article>';
}
function render(seed){
  const d=ensure(),e=resolve(seed)||seed;if(!e)return;
  const rs=reportsFor(e),list=rows(),idx=list.findIndex(x=>key(x)===key(e)),loc=[e.city,e.admin1,e.country].filter(Boolean).join(', ')||'Location unresolved';
  $('#eventPosition').textContent=idx>=0?'EVENT '+(idx+1)+' OF '+list.length:'EVENT DOSSIER';
  $('#eventPrev').disabled=idx<=0;$('#eventNext').disabled=idx<0||idx>=list.length-1;
  $('#eventPrev').onclick=()=>{if(idx>0)open(list[idx-1])};$('#eventNext').onclick=()=>{if(idx>=0&&idx<list.length-1)open(list[idx+1])};
  const gaps=[];if(!e.event_date)gaps.push('Incident date unresolved');if(!e.city)gaps.push('Precise locality may be unresolved');if(!e.perpetrator&&!e.actor)gaps.push('Perpetrator attribution unresolved');if(rs.length<2)gaps.push('Limited corroboration: fewer than two linked retained reports');if(e.casualty_disputed)gaps.push('Reported casualty figures conflict');if(!gaps.length)gaps.push('No automatic evidence-gap flags were triggered; source review is still required.');
  $('#eventDrawerContent').innerHTML='<div class="event-dossier-title"><span class="eyebrow">EVENT INTELLIGENCE DOSSIER</span><div class="event-dossier-id">'+esc(key(e))+'</div><h2>'+esc(e.title||((e.actor||'Unattributed')+' '+(e.event_type||'candidate event')))+'</h2><div class="event-dossier-badges"><span>'+esc(e.event_date||'DATE UNRESOLVED')+'</span><span>'+esc(loc)+'</span><span>'+esc(e.actor||'OTHER')+'</span><span>'+esc(e.confidence||e.corroboration||'Candidate')+'</span><span>'+Math.max(Number(e.source_count)||0,rs.length)+' SOURCES</span></div></div><section class="event-dossier-section event-summary-block"><span class="eyebrow">INTELLIGENCE SUMMARY</span><p>'+esc(e.summary||e.title||'No event summary is currently available.')+'</p></section><section class="event-dossier-section"><div class="event-fact-grid"><div><small>EVENT DATE</small><strong>'+esc(e.event_date||'Unresolved')+'</strong><span>'+esc(e.event_date_confidence||'confidence unresolved')+'</span></div><div><small>LOCATION</small><strong>'+esc(loc)+'</strong><span>'+esc(e.lat&&e.lng?(Number(e.lat).toFixed(4)+', '+Number(e.lng).toFixed(4)):'coordinate unresolved')+'</span></div><div><small>ACTOR</small><strong>'+esc(e.actor||'Unattributed')+'</strong><span>'+esc(e.perpetrator?('Perpetrator: '+e.perpetrator):'perpetrator unresolved')+'</span></div><div><small>EVENT TYPE</small><strong>'+esc(e.event_type||'Unclassified')+'</strong><span>'+esc(e.target?('Target: '+e.target):'target unresolved')+'</span></div></div></section><section class="event-dossier-section event-gaps"><span class="eyebrow">WHAT REMAINS UNCLEAR</span><ul>'+gaps.map(g=>'<li>'+esc(g)+'</li>').join('')+'</ul></section><section class="event-dossier-section"><div class="event-section-heading"><div><span class="eyebrow">SOURCE REPORTING</span><h3>'+rs.length+' linked retained report'+(rs.length===1?'':'s')+'</h3></div></div><div class="event-source-list">'+(rs.length?rs.map(sourceCard).join(''):'<div class="runbox">No retained source card is linked to this event yet.</div>')+'</div></section><div class="event-dossier-actions"><button id="eventSaveSources">☆ SAVE LINKED REPORTS</button><button id="eventMapFocus">◎ VIEW ON OPERATING MAP</button><button id="eventCopyLink">⧉ COPY EVENT LINK</button></div>';
  $$('.event-save-one').forEach(b=>b.onclick=()=>{app()?.toggleSavedReport?.(b.dataset.reportKey);render(e)});
  $('#eventSaveSources').onclick=()=>saveAll(e);$('#eventMapFocus').onclick=()=>focusMap(e);$('#eventCopyLink').onclick=()=>copyLink(e,$('#eventCopyLink'));
}
function open(seed,opts={}){
  const e=resolve(seed)||seed;if(!e)return;const d=ensure(),bg=$('#eventDrawerBackdrop');render(e);document.body.classList.add('event-drawer-open');d.setAttribute('aria-hidden','false');bg.hidden=false;requestAnimationFrame(()=>d.classList.add('open'));
  if(opts.updateHash!==false)try{history.replaceState(null,'',location.pathname+location.search+HASH+encodeURIComponent(key(e)))}catch(_){}
}
function close(){
  const d=$('#eventIntelDrawer'),bg=$('#eventDrawerBackdrop');if(!d)return;d.classList.remove('open','expanded');d.setAttribute('aria-hidden','true');document.body.classList.remove('event-drawer-open');if(bg)bg.hidden=true;
  try{if(location.hash.startsWith(HASH))history.replaceState(null,'',location.pathname+location.search)}catch(_){}
}
function saveAll(e){
  const a=app();if(!a)return;let n=0;
  reportsFor(e).forEach(r=>{const real=(st().reports||[]).find(x=>reportKey(x)===reportKey(r));if(real&&!a.isReportSaved?.(real)){st().savedReports.unshift(a.reportSnapshot? a.reportSnapshot(real):{...real,_saved_at:new Date().toISOString()});n++}});
  a.persistSavedReports?.();a.renderFeeds?.();a.renderSavedReports?.();render(e);
}
function focusMap(e){
  const a=app();if(!a)return;st().mapDays='all';st().timelineDate=null;st().actorFilter='all';$$('.map-range').forEach(b=>b.classList.toggle('active',b.dataset.days==='all'));$$('.filter').forEach(b=>b.classList.toggle('active',b.dataset.actor==='all'));a.renderMap?.();close();$('.map-panel')?.scrollIntoView({behavior:'smooth',block:'start'});setTimeout(()=>window.SAHEL_MAP_UI?.focusEvent?.(resolve(e)||e),350);
}
function copyLink(e,b){
  const u=location.origin+location.pathname+location.search+HASH+encodeURIComponent(key(e)),done=()=>{const old=b.textContent;b.textContent='✓ EVENT LINK COPIED';setTimeout(()=>b.textContent=old,1500)};
  if(navigator.clipboard?.writeText)navigator.clipboard.writeText(u).then(done).catch(()=>{});else{const t=document.createElement('textarea');t.value=u;document.body.append(t);t.select();try{document.execCommand('copy');done()}catch(_){}t.remove()}
}
function openHash(){
  if(!location.hash.startsWith(HASH))return;let k='';try{k=decodeURIComponent(location.hash.slice(HASH.length))}catch(_){return}
  const e=(st().events||[]).find(x=>key(x)===k)||(st().thirty?.latest_events||[]).map(resolve).find(x=>x&&key(x)===k);if(e)open(e,{updateHash:false});
}
window.SAHEL_EVENT_DRAWER={open,close,render,openHash,key,resolve,reportsFor};
})();