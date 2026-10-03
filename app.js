const SITE_UI_VERSION='4.3.0';
const state={overview:null,reports:[],events:[],metrics:null,thirty:null,sources:[],runs:[],briefing:null,sultanaArchive:{briefings:[]},russianLogistics:null,actorFilter:'all',mapDays:7,langFilter:'all',countryFilter:'all',range:30,voices:[],speaking:false,readerRunning:false,readerPaused:false,readerIndex:0,readerCycle:0,readerRange:30,readerQueue:[],readerSession:0,timelineDate:null,savedReports:[],savedViewMode:'all'};
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const esc=s=>String(s??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const fmtTime=v=>{if(!v)return '—'; const d=new Date(v); return isNaN(d)?'—':d.toLocaleString()};
const fmtTimestampUTC=v=>{if(!v)return 'UNAVAILABLE';const d=new Date(v);if(isNaN(d))return 'UNAVAILABLE';return new Intl.DateTimeFormat('en-US',{timeZone:'UTC',year:'numeric',month:'short',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false,timeZoneName:'short'}).format(d)};
const relTime=v=>{if(!v)return 'never';const d=new Date(v),s=Math.max(0,(Date.now()-d)/1000);if(s<60)return `${Math.round(s)}s ago`;if(s<3600)return `${Math.round(s/60)}m ago`;if(s<86400)return `${Math.round(s/3600)}h ago`;return `${Math.round(s/86400)}d ago`};
async function data(name){const r=await fetch(`./data/${name}.json?ts=${Date.now()}`,{cache:'no-store'}); if(!r.ok)throw new Error(`${r.status} ${name}`); return r.json();}
function setText(id,v){const e=document.getElementById(id);if(e)e.textContent=v;}
function sourceCodeById(id){
  const sid=String(id||'');
  if(!sid)return null;
  const rows=state.sources||[];
  const row=rows.find(s=>String(s.id||'')===sid);
  if(row?.source_code)return row.source_code;
  const idx=rows.findIndex(s=>String(s.id||'')===sid);
  return idx>=0?'SRC-'+String(idx+1).padStart(4,'0'):null;
}
function sourceCodeByName(name){
  const target=String(name||'').trim().toLowerCase();
  if(!target)return null;
  const rows=state.sources||[];
  const row=rows.find(s=>String(s.name||'').trim().toLowerCase()===target);
  if(!row)return null;
  return row.source_code||sourceCodeById(row.id);
}
function sourceCodeForReport(r){
  return r?.source_code||sourceCodeById(r?.source_id)||sourceCodeByName(r?.source)||'SRC-UNASSIGNED';
}
function sourceCodeForSummary(x){return sourceCodeByName(x?.source)||'SRC-UNASSIGNED';}
function simpleKeyHash(value){
  let h=2166136261;
  for(const ch of String(value||'')){h^=ch.charCodeAt(0);h=Math.imul(h,16777619);}
  return (h>>>0).toString(36);
}
function reportDomToken(r){return 'r-'+simpleKeyHash(reportKey(r));}
function reportDateKey(r){
  const v=r?.published_at||r?.discovered_at||r?.collected_at;
  if(!v)return '';
  const d=new Date(v);return isNaN(d)?'':d.toISOString().slice(0,10);
}
function statusClass(s){s=(s||'OFFLINE').toLowerCase();return s==='live'?'live':s==='degraded'?'degraded':'offline'}
function applyStatus(status,detail){['systemBadge','opsBadge'].forEach(id=>{const e=document.getElementById(id);if(!e)return;e.textContent=status;e.className=`status ${statusClass(status)}`});setText('heartbeat',detail||'');}
function pct(t){if(!t)return '—';if(t.change_pct===null||t.change_pct===undefined)return t.current>0?'▲ NEW':'—';const n=Number(t.change_pct)||0;return `${n>0?'▲':n<0?'▼':'•'} ${Math.abs(n).toFixed(1)}%`}
function trendClass(t){if(!t||t.change_pct===null||t.change_pct===undefined)return t&&t.current>0?'up':'flat';return t.change_pct>1?'up':t.change_pct<-1?'down':'flat'}
function actorColor(a){return a==='JNIM'?'#ef6262':a==='IS Sahel'?'#b47cff':a==='State'?'#e7ad53':a==='Africa Corps/Wagner'?'#48d5a2':'#63a8ff'}
function clock(){const now=new Date();setText('clock',`YOUR TIME ${now.toLocaleTimeString([], {hour12:false})}`);}
setInterval(clock,1000);clock();
function applyTheme(theme){
  const mode=theme==='light'?'light':'dark';
  document.documentElement.dataset.theme=mode;
  try{localStorage.setItem('sicTheme',mode)}catch(e){}
  const b=$('#themeToggle');if(b){b.textContent=mode==='dark'?'☀ LIGHT':'☾ DARK';b.setAttribute('aria-label',mode==='dark'?'Switch to light mode':'Switch to dark mode')}
  const meta=document.querySelector('meta[name="theme-color"]');if(meta)meta.content=mode==='dark'?'#061019':'#e5ebee';
}
applyTheme(document.documentElement.dataset.theme||'light');
const themeButton=$('#themeToggle');if(themeButton)themeButton.onclick=()=>applyTheme(document.documentElement.dataset.theme==='light'?'dark':'light');

const SAVED_REPORTS_KEY='sicSavedReportsV1';

function reportKey(r){
  return String(r?.id||r?.url||[r?.source,r?.title,r?.published_at,r?.discovered_at].filter(Boolean).join('|'));
}
function loadSavedReports(){
  try{
    const raw=JSON.parse(localStorage.getItem(SAVED_REPORTS_KEY)||'[]');
    if(!Array.isArray(raw))return [];
    const seen=new Set(),rows=[];
    for(const r of raw){if(!r||typeof r!=='object')continue;const key=reportKey(r);if(!key||seen.has(key))continue;seen.add(key);rows.push(r);}
    return rows;
  }catch(e){console.warn('Could not load saved reports',e);return [];}
}
function persistSavedReports(){
  try{localStorage.setItem(SAVED_REPORTS_KEY,JSON.stringify(state.savedReports));return true;}
  catch(e){console.error('Could not save reports locally',e);const status=$('#savedReportsStatus');if(status)status.textContent='Browser storage could not be updated. The saved set may not persist after refresh.';return false;}
}
function isReportSaved(r){const key=reportKey(r);return Boolean(key)&&state.savedReports.some(x=>reportKey(x)===key);}
function reportSnapshot(r){const copy={...r,_saved_at:new Date().toISOString()};try{return JSON.parse(JSON.stringify(copy))}catch(_){return copy}}
function toggleSavedReport(encodedKey){
  let key='';try{key=decodeURIComponent(encodedKey||'')}catch(_){key=String(encodedKey||'')}
  if(!key)return;
  const existing=state.savedReports.findIndex(r=>reportKey(r)===key);
  if(existing>=0){state.savedReports.splice(existing,1);}else{const report=(state.reports||[]).find(r=>reportKey(r)===key);if(!report)return;state.savedReports.unshift(reportSnapshot(report));}
  persistSavedReports();renderFeeds();renderSavedReports();
}
function bindSaveButtons(root){if(!root)return;root.querySelectorAll('[data-save-report]').forEach(b=>{b.onclick=()=>toggleSavedReport(b.dataset.saveReport);});}
function reportLibraryRows(){
  const seen=new Set(),rows=[];
  for(const r of (state.reports||[])){const key=reportKey(r);if(!key||seen.has(key))continue;seen.add(key);rows.push(r);}
  for(const r of (state.savedReports||[])){const key=reportKey(r);if(!key||seen.has(key))continue;seen.add(key);rows.push(r);}
  return rows;
}
function updateSavedCount(){
  const total=reportLibraryRows().length;
  const starred=state.savedReports.length;
  setText('savedTabCount',total);
  const status=$('#savedReportsStatus');
  if(status)status.textContent=`${total} retained report${total===1?'':'s'} available with summaries • ${starred} starred favorite${starred===1?'':'s'}.`;
  for(const id of ['downloadSavedJson','downloadSavedCsv']){const b=document.getElementById(id);if(b)b.disabled=total===0;}
  const clear=$('#clearSavedReports');if(clear)clear.disabled=starred===0;
}
function renderSavedReports(){
  updateSavedCount();
  const host=$('#savedReportsFeed');if(!host)return;
  const allRows=reportLibraryRows().sort((a,b)=>String(b.published_at||b.discovered_at||b._saved_at||'').localeCompare(String(a.published_at||a.discovered_at||a._saved_at||'')));
  const rows=state.savedViewMode==='starred'?allRows.filter(isReportSaved):allRows;
  host.innerHTML=rows.map(r=>reportCard(r,'saved')).join('')||'<div class="runbox">No reports are available in this view.</div>';
  bindSaveButtons(host);
  $$('.saved-view-filter').forEach(b=>b.classList.toggle('active',b.dataset.savedView===state.savedViewMode));
}

function downloadBlob(contents,filename,type){const blob=new Blob([contents],{type});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=filename;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function csvCell(v){const value=String(v??'');return '"'+value.replace(/"/g,'""')+'"';}
function downloadSavedReports(format){
  const rows=reportLibraryRows();if(!rows.length)return;const stamp=new Date().toISOString().slice(0,10);
  if(format==='csv'){
    const fields=['starred','saved_at','title','original_title','source_code','source','country','language','published_at','published_date_source','published_time_precision','collected_at','collection_timestamp_source','event_date','actor','event_type','perpetrator','target','summary','url'];
    const header=fields.map(csvCell).join(',');
    const body=rows.map(r=>{const values={starred:isReportSaved(r)?'yes':'no',saved_at:(state.savedReports.find(x=>reportKey(x)===reportKey(r))?._saved_at)||'',title:r.translated_title||r.title||'',original_title:r.title||'',source_code:sourceCodeForReport(r),source:r.source||'',country:r.country||'',language:r.language||r.source_language||'',published_at:r.published_at||'',published_date_source:r.published_date_source||'',published_time_precision:r.published_time_precision||'',collected_at:r.collected_at||r.discovered_at||'',collection_timestamp_source:r.collection_timestamp_source||'',event_date:r.event_date||'',actor:r.actor||r.actor_bucket||'',event_type:r.event_type||'',perpetrator:r.perpetrator||'',target:r.target||'',summary:r.article_summary||r.translated_excerpt||r.excerpt||'',url:r.url||''};return fields.map(k=>csvCell(values[k])).join(',');}).join('\n');
    downloadBlob(header+'\n'+body,'sahel-intel-all-reports-'+stamp+'.csv','text/csv;charset=utf-8');return;
  }
  const payload={exported_at:new Date().toISOString(),report_count:rows.length,starred_count:state.savedReports.length,reports:rows.map(r=>({...r,_starred:isReportSaved(r)}))};
  downloadBlob(JSON.stringify(payload,null,2),'sahel-intel-all-reports-'+stamp+'.json','application/json;charset=utf-8');
}
function bindSavedControls(){
  const json=$('#downloadSavedJson');if(json)json.onclick=()=>downloadSavedReports('json');
  const csv=$('#downloadSavedCsv');if(csv)csv.onclick=()=>downloadSavedReports('csv');
  const clear=$('#clearSavedReports');if(clear)clear.onclick=()=>{if(!state.savedReports.length)return;if(!confirm(`Clear all ${state.savedReports.length} starred favorite${state.savedReports.length===1?'':'s'} from this browser?`))return;state.savedReports=[];persistSavedReports();renderFeeds();renderSavedReports();};
  $$('.saved-view-filter').forEach(b=>b.onclick=()=>{state.savedViewMode=b.dataset.savedView==='starred'?'starred':'all';renderSavedReports();});
}

state.savedReports=loadSavedReports();
bindSavedControls();
renderSavedReports();
function enforceInitialMapRange(){
  state.mapDays=7;
  state.timelineDate=null;
  $$('.map-range').forEach(b=>b.classList.toggle('active',b.dataset.days==='7'));
}
enforceInitialMapRange();

$$('.tab').forEach(b=>b.onclick=()=>{$$('.tab').forEach(x=>x.classList.remove('active'));b.classList.add('active');$$('.view').forEach(v=>v.classList.remove('active'));$(`#view-${b.dataset.view}`).classList.add('active');if(b.dataset.view==='quant')renderQuant();if(b.dataset.view==='sources')renderOps();if(b.dataset.view==='saved')renderSavedReports();});
$$('.filter').forEach(b=>b.onclick=()=>{$$('.filter').forEach(x=>x.classList.remove('active'));b.classList.add('active');state.actorFilter=b.dataset.actor;renderMap();});
$$('.lang').forEach(b=>b.onclick=()=>{$$('.lang').forEach(x=>x.classList.remove('active'));b.classList.add('active');state.langFilter=b.dataset.lang;renderFeeds();});
$$('.country-feed').forEach(b=>b.onclick=()=>{$$('.country-feed').forEach(x=>x.classList.remove('active'));b.classList.add('active');state.countryFilter=b.dataset.country;renderFeeds();});
$$('.range').forEach(b=>b.onclick=()=>{$$('.range').forEach(x=>x.classList.remove('active'));b.classList.add('active');state.range=Number(b.dataset.days);renderQuant();});
$$('.map-range').forEach(b=>b.onclick=()=>{$$('.map-range').forEach(x=>x.classList.remove('active'));b.classList.add('active');state.mapDays=b.dataset.days==='all'?'all':Number(b.dataset.days);renderMap();});

window.SAHEL_APP={state,esc,fmtTimestampUTC,reportKey,isReportSaved,reportSnapshot,persistSavedReports,toggleSavedReport,renderFeeds,renderSavedReports,renderMap,eventInWindow,hasCoord,sourceCodeForReport,sourceCodeByName,reportDateKey,jumpToReports};

async function refresh(){
  try{
    const [overview,reports,events,metrics,sources,runs,briefing,thirty,sultanaArchive,russianLogistics]=await Promise.all([
      data('overview'),data('reports'),data('events'),data('metrics'),data('sources'),data('runs'),data('briefing'),
      data('thirty_day').catch(()=>null),
      data('sultana_briefing_archive').catch(()=>({briefings:[]})),
      data('russian_logistics').catch(()=>null)
    ]);
    Object.assign(state,{overview,reports,events,metrics,sources,runs,briefing,thirty,sultanaArchive,russianLogistics});
    renderOverview();renderThreat();renderMap();renderActors();renderFeeds();renderSavedReports();renderBriefing();renderThirty();updateReaderStatus();window.SAHEL_EVENT_DRAWER?.openHash?.();
    const active=$('.view.active')?.id;
    if(active==='view-quant')renderQuant();
    if(active==='view-sources')renderOps();
  }catch(e){
    applyStatus('OFFLINE',`Dashboard data error: ${e.message}`);
    console.error(e);
  }
}
function renderOverview(){const o=state.overview||{};setText('deskUpdated',o.last_collection?'Last completed collection · '+fmtTime(o.last_collection):'Awaiting first completed collection');let status=o.status||'OFFLINE',detail=o.status_detail||'';const patch=SITE_UI_VERSION;setText('patchBadge',`PATCH v${patch}`);const pb=$('#patchBadge');if(pb)pb.title=`Sahel Intel public dashboard patch v${patch}`;if(o.last_collection){const age=(Date.now()-new Date(o.last_collection))/60000;if(age>90){status='OFFLINE';detail=`Last automated collection was ${relTime(o.last_collection)}. Scheduled collection may be disabled or failing.`}else if(age>40&&status==='LIVE'){status='DEGRADED';detail=`Last automated collection was ${relTime(o.last_collection)}.`}}applyStatus(status,detail);setText('reports24',o.reports_24h??0);setText('sources24',o.distinct_sources_24h??0);setText('mapped24',o.mapped_events_24h??0);setText('configuredSources',o.sources_configured??74);setText('liveSources',o.sources_live??0);setText('degradedSources',o.sources_degraded??0);setText('failedSources',o.sources_failed??0);const r=o.last_run;if(r){const target=r.report_target??100;$('#runBox').innerHTML=`Last cycle ${esc(relTime(o.last_collection))}<br>${r.sources_success}/${o.sources_configured} active sources reached • ${r.documents_discovered} links discovered • ${r.documents_retained}/${target} qualifying-report target • ${r.collection_waves??1} collection wave${(r.collection_waves??1)===1?'':'s'} • ${r.event_changes} event changes`;}else{$('#runBox').textContent='Awaiting first collection run. The interface will not claim LIVE until the worker finishes a real cycle.'}}

function reportCard(r,scope='report'){
  const english=r.translated_title||r.title;
  const hasTranslation=r.translated_title&&r.translated_title!==r.title;
  const summary=r.article_summary||r.translated_excerpt||r.excerpt||'';
  const published=r.published_at?fmtTimestampUTC(r.published_at):'UNAVAILABLE';
  const collected=fmtTimestampUTC(r.collected_at||r.discovered_at);
  const pubPrecision=r.published_time_precision==='date-only'?'date only; publisher time unavailable':r.published_time_precision==='datetime'?'publisher timestamp':'timestamp unresolved';
  const pubSource=r.published_date_source||'unresolved';
  const trans=r.language==='en'?'EN original':(r.translation_status==='success'?'EN translated':r.translation_status==='failed'?'translation failed / retry queued':'translation pending');
  const type=r.research_lead||r.retention_class==='research_lead'?'RESEARCH LEAD':(r.analytical_container?'ANALYTICAL CONTEXT':(r.candidate_event?'CANDIDATE EVENT':'CONTEXT REPORT'));
  const key=encodeURIComponent(reportKey(r));
  const saved=isReportSaved(r);
  const sourceCode=sourceCodeForReport(r);
  const domId=scope+'-'+reportDomToken(r);
  return `<article id="${esc(domId)}" class="report" data-report-key="${esc(key)}" data-source-code="${esc(sourceCode)}"><div class="report-top"><span class="badge">${esc((r.language||'').toUpperCase())}</span><span class="badge">${esc(r.country||'REGIONAL')}</span><span class="badge">${esc(r.actor_bucket||'GENERAL')}</span><span class="badge">${esc(type)}</span><span class="report-meta"><b class="source-code">${esc(sourceCode)}</b> • ${esc(r.source)}</span></div><h3>${esc(english)}</h3>${summary?`<div class="article-summary"><small>ARTICLE SUMMARY</small><p>${esc(summary)}</p></div>`:''}<div class="report-meta"><strong>PUBLISHED:</strong> ${esc(published)} (${esc(pubSource)}; ${esc(pubPrecision)}) • <strong>COLLECTED BY SAHEL INTEL:</strong> ${esc(collected)} • Event date: ${esc(r.event_date||'unresolved')} (${esc(r.event_date_confidence||'unresolved')}) • ${esc(trans)}</div><div class="report-meta">${esc([r.city,r.country,r.event_type].filter(Boolean).join(' • ')||'No structured event')}${r.perpetrator?` • Perpetrator: ${esc(r.perpetrator)}`:''}${r.target?` • Target: ${esc(r.target)}`:''}</div>${hasTranslation?`<details class="original"><summary>Original ${esc((r.language||'').toUpperCase())}</summary><p>${esc(r.title)}</p></details>`:''}<div class="report-actions"><a href="${esc(r.url)}" target="_blank" rel="noopener">OPEN SOURCE ↗</a><button type="button" class="save-report-btn ${saved?'saved':''}" data-save-report="${esc(key)}">${saved?'★ SAVED':'☆ SAVE REPORT'}</button></div></article>`;
}
function renderThreat(){
  const t=state.overview?.threat;if(!t)return;
  const r=t.regional||{};
  const trendIcon=x=>x==='DETERIORATING'?'↑':x==='IMPROVING'?'↓':'→';
  $('#threatRegional').innerHTML=`<span>REGIONAL</span><strong class="threat-level level-${esc((r.level||'LOW').toLowerCase())}">${esc(r.level||'—')}</strong><em>Confidence ${esc(r.confidence||'—')}</em>`;
  const countryMeta={Mali:{flag:'🇲🇱',tz:'Africa/Bamako',zone:'GMT'},'Burkina Faso':{flag:'🇧🇫',tz:'Africa/Ouagadougou',zone:'GMT'},Niger:{flag:'🇳🇪',tz:'Africa/Niamey',zone:'WAT'}};
  $('#threatCountries').innerHTML=['Mali','Burkina Faso','Niger'].map(name=>{const x=t.countries?.[name]||{},m=countryMeta[name];const drivers=(x.drivers||[]).slice(0,3).map(d=>`<li>${esc(d)}</li>`).join('');const insufficient=x.assessment_status==='INSUFFICIENT_DATA'||x.level==='INSUFFICIENT DATA';return `<article class="threat-country"><div><b>${m.flag} ${esc(name.toUpperCase())} <small class="country-clock" data-tz="${m.tz}" data-zone="${m.zone}">--:-- ${m.zone}</small></b><strong class="${insufficient?'level-insufficient':`level-${esc((x.level||'low').toLowerCase())}`}">${esc(x.level||'—')} ${insufficient?'—':trendIcon(x.trend)}</strong></div><span>${insufficient?'Threat level withheld':`Index ${esc(x.score??'—')}/100`} • ${esc(x.confidence||'—')} confidence</span><ul>${drivers}</ul></article>`}).join(''); updateCountryClocks();
  setText('threatNote',t.method_note||'');
}

function updateCountryClocks(){document.querySelectorAll('.country-clock').forEach(el=>{try{const v=new Intl.DateTimeFormat('en-GB',{timeZone:el.dataset.tz,hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date());el.textContent=`${v} ${el.dataset.zone}`;}catch(_){el.textContent=`--:-- ${el.dataset.zone}`;}})}
setInterval(updateCountryClocks,30000);

function renderFeeds(){
  const filter=r=>(state.langFilter==='all'||r.language===state.langFilter)&&(state.countryFilter==='all'||r.country===state.countryFilter);
  const rows=state.reports.filter(filter);
  const counts=['Mali','Burkina Faso','Niger'].map(c=>`${c} ${state.reports.filter(r=>r.country===c).length}`).join(' • ');
  const countBox=$('#feedCountryCounts');if(countBox)countBox.textContent=`Retained archive • ${counts}`;
  // The overview preview deliberately interleaves countries so a Mali-heavy archive cannot
  // visually hide Burkina Faso or Niger reporting.
  const perCountry=['Mali','Burkina Faso','Niger'].map(c=>state.reports.filter(r=>r.country===c&&filter(r)).slice(0,3));
  const preview=[];for(let i=0;i<3;i++)for(const group of perCountry)if(group[i])preview.push(group[i]);
  const previewRows=state.countryFilter==='all'?preview:rows.slice(0,9);
  $('#feedPreview').innerHTML=previewRows.map(r=>reportCard(r,'preview')).join('')||'<div class="runbox">No relevant reports have been retained yet.</div>';
  $('#fullFeed').innerHTML=rows.map(r=>reportCard(r,'feed')).join('')||'<div class="runbox">No reports match the selected country/language filters.</div>';
  bindSaveButtons($('#feedPreview'));
  bindSaveButtons($('#fullFeed'));
  updateSavedCount();
}

function svgEl(tag,attrs={}){const e=document.createElementNS('http://www.w3.org/2000/svg',tag);Object.entries(attrs).forEach(([k,v])=>e.setAttribute(k,v));return e}
const MAP_FOCUS={minLon:-13.0,maxLon:16.6,minLat:9.0,maxLat:25.5};
const COUNTRY_LABELS=[
  {name:'MALI',lat:22.4866,lng:-6.1772,anchor:'start'},
  {name:'BURKINA FASO',lat:11.0102,lng:-1.6595,anchor:'middle'},
  {name:'NIGER',lat:21.1015,lng:12.7713,anchor:'end'}
];
const COUNTRY_EVENT_ANCHORS={
  'Mali':{lat:19.4,lng:-5.4},
  'Burkina Faso':{lat:12.0,lng:-3.5},
  'Niger':{lat:18.8,lng:9.8}
};
// City coordinates are pinned to known populated-place coordinates rather than inferred from article text.
const CITY_LABELS=[
  {name:'Bamako',country:'Mali',lat:12.60915,lng:-7.97522,dx:7,dy:-7,anchor:'start'},
  {name:'Timbuktu',country:'Mali',lat:16.77348,lng:-3.00742,dx:-7,dy:-7,anchor:'end'},
  {name:'Gao',country:'Mali',lat:16.27167,lng:-0.04472,dx:7,dy:-7,anchor:'start'},
  {name:'Mopti',country:'Mali',lat:14.48430,lng:-4.18296,dx:-7,dy:-7,anchor:'end'},
  {name:'Ménaka',country:'Mali',lat:15.91531,lng:2.40203,dx:7,dy:-6,anchor:'start'},
  {name:'Kidal',country:'Mali',lat:18.44345,lng:1.40921,dx:7,dy:-7,anchor:'start'},
  {name:'Ségou',country:'Mali',lat:13.44032,lng:-6.25947,dx:7,dy:12,anchor:'start'},
  {name:'Sikasso',country:'Mali',lat:11.31755,lng:-5.66654,dx:7,dy:12,anchor:'start'},

  {name:'Ouagadougou',country:'Burkina Faso',lat:12.36566,lng:-1.53388,dx:7,dy:-8,anchor:'start'},
  {name:'Dori',country:'Burkina Faso',lat:14.03326,lng:-0.03333,dx:7,dy:-7,anchor:'start'},
  {name:'Djibo',country:'Burkina Faso',lat:14.09864,lng:-1.62665,dx:-7,dy:-7,anchor:'end'},
  {name:'Kaya',country:'Burkina Faso',lat:13.08830,lng:-1.08368,dx:7,dy:12,anchor:'start'},
  {name:"Fada N'Gourma",country:'Burkina Faso',lat:12.06157,lng:0.35843,dx:7,dy:12,anchor:'start'},
  {name:'Ouahigouya',country:'Burkina Faso',lat:13.57690,lng:-2.41786,dx:-7,dy:-7,anchor:'end'},
  {name:'Bobo-Dioulasso',country:'Burkina Faso',lat:11.18064,lng:-4.29489,dx:-7,dy:-7,anchor:'end'},

  {name:'Niamey',country:'Niger',lat:13.51366,lng:2.10980,dx:7,dy:12,anchor:'start'},
  {name:'Tillabéri',country:'Niger',lat:14.20711,lng:1.45418,dx:-7,dy:-7,anchor:'end'},
  {name:'Tahoua',country:'Niger',lat:14.88880,lng:5.26920,dx:7,dy:-7,anchor:'start'},
  {name:'Agadez',country:'Niger',lat:16.97333,lng:7.99111,dx:7,dy:-7,anchor:'start'},
  {name:'Maradi',country:'Niger',lat:13.50000,lng:7.10174,dx:7,dy:12,anchor:'start'},
  {name:'Zinder',country:'Niger',lat:13.80716,lng:8.98810,dx:7,dy:-7,anchor:'start'},
  {name:'Dosso',country:'Niger',lat:13.04900,lng:3.19370,dx:7,dy:12,anchor:'start'},
  {name:'Arlit',country:'Niger',lat:18.73694,lng:7.38528,dx:7,dy:-7,anchor:'start'}
];
function project(lng,lat,w=1000,h=560){const b=MAP_FOCUS;return [(lng-b.minLon)/(b.maxLon-b.minLon)*w,h-(lat-b.minLat)/(b.maxLat-b.minLat)*h]}
function hasCoord(lat,lng){return lat!==null&&lat!==undefined&&lat!==''&&lng!==null&&lng!==undefined&&lng!==''&&Number.isFinite(Number(lat))&&Number.isFinite(Number(lng))&&Number(lat)>=-90&&Number(lat)<=90&&Number(lng)>=-180&&Number(lng)<=180}
function geometryPath(g){const polys=g.type==='Polygon'?[g.coordinates]:g.coordinates;return polys.map(poly=>poly.map(ring=>ring.map((p,i)=>{const [x,y]=project(p[0],p[1]);return `${i?'L':'M'}${x.toFixed(1)},${y.toFixed(1)}`}).join(' ')+' Z').join(' ')).join(' ')}
function eventInWindow(e,days){
  if(days==='all')return true;
  if(!e?.event_date)return false;
  const d=new Date(`${e.event_date}T23:59:59Z`);
  return !isNaN(d) && (Date.now()-d.getTime()) <= Number(days)*86400000;
}
function renderMap(){
  if(window.SAHEL_MAP_UI){window.SAHEL_MAP_UI.render(state,{eventInWindow,actorColor,showEventDetail,showEventCluster,esc});return}
  renderLegacyMap();
}
function renderLegacyMap(){
  const host=$('#map');if(!host||!window.SAHEL_MAP_DATA)return;
  host.innerHTML='<div class="maptip" id="maptip"></div>';
  const svg=svgEl('svg',{viewBox:'0 0 1000 560',preserveAspectRatio:'xMidYMid meet'});
  svg.appendChild(svgEl('rect',{x:0,y:0,width:1000,height:560,class:'map-bg'}));

  window.SAHEL_MAP_DATA.countries.forEach(f=>svg.appendChild(svgEl('path',{d:geometryPath(f.geometry),class:`country ${f.properties.aes?'aes':'context'}`})));

  let events=state.events.filter(e=>eventInWindow(e,state.mapDays)&&(!state.timelineDate||e.event_date===state.timelineDate));
  if(state.actorFilter!=='all')events=events.filter(e=>e.actor===state.actorFilter);

  // One fused event can legitimately contain several explicitly named places. Render each
  // place as a linked map point while keeping the event count itself unique.
  const mapRows=[];
  events.slice(0,400).forEach(e=>{
    const locs=Array.isArray(e.incident_locations)?e.incident_locations.filter(l=>hasCoord(l?.lat,l?.lng)):[];
    if(locs.length){
      locs.forEach(l=>mapRows.push({...e,city:l.name||e.city,country:l.country||e.country,lat:Number(l.lat),lng:Number(l.lng),_mapped_location:true,_event_id:e.id}));
      return;
    }
    if(hasCoord(e.lat,e.lng)){const lat=Number(e.lat),lng=Number(e.lng);mapRows.push({...e,lat,lng,_event_id:e.id});return}
    const a=COUNTRY_EVENT_ANCHORS[e.country];
    if(a)mapRows.push({...e,lat:a.lat,lng:a.lng,_country_level:true,_event_id:e.id});
  });

  const clusters=new Map();
  mapRows.forEach(e=>{
    const countryLevel=Boolean(e._country_level),lat=Number(e.lat),lng=Number(e.lng);
    const key=countryLevel?`country:${e.country}`:`geo:${lat.toFixed(4)},${lng.toFixed(4)}`;
    if(!clusters.has(key))clusters.set(key,{lat,lng,countryLevel,events:[]});
    clusters.get(key).events.push(e);
  });
  clusters.forEach(cluster=>{
    const [x,y]=project(cluster.lng,cluster.lat);if(x<0||x>1000||y<0||y>560)return;
    const rows=cluster.events;const lead=rows[0];const c=actorColor(lead.actor);const g=svgEl('g');
    g.appendChild(svgEl('circle',{cx:x,cy:y,r:rows.length>1?16:13,fill:c,class:'eventhalo'}));
    const dot=cluster.countryLevel
      ? svgEl('rect',{x:x-6,y:y-6,width:12,height:12,transform:`rotate(45 ${x} ${y})`,fill:'none',stroke:c,'stroke-width':2.4,class:'eventdot country-event-dot'})
      : svgEl('circle',{cx:x,cy:y,r:rows.length>1?8:6.2,fill:c,class:'eventdot'});
    g.appendChild(dot);
    if(rows.length>1){const uniqueEvents=new Set(rows.map(r=>r._event_id||r.id)).size;const n=svgEl('text',{x,y:y+3.2,class:'event-cluster-count','text-anchor':'middle'});n.textContent=String(uniqueEvents||rows.length);g.appendChild(n)}
    g.classList.add('event-marker');
    g.addEventListener('mouseenter',ev=>showClusterTip(ev,rows));g.addEventListener('mouseleave',()=>hideTip());g.addEventListener('click',()=>showEventCluster(rows));svg.appendChild(g);
  });

  const cityLayer=svgEl('g',{'aria-label':'city-labels'});
  const occupied=[];
  const capitalNames=new Set(['Bamako','Ouagadougou','Niamey']);
  const operationalNames=new Set(['Timbuktu','Gao','Kidal','Ménaka','Mopti','Djibo','Dori','Tillabéri','Agadez']);
  const priority=c=>capitalNames.has(c.name)?3:operationalNames.has(c.name)?2:1;
  const candidates=[[8,-8],[-8,-8],[8,13],[-8,13],[12,2],[-12,2],[18,-14],[-18,-14],[18,18],[-18,18]];
  const overlaps=b=>occupied.some(o=>!(b.x2<o.x1||b.x1>o.x2||b.y2<o.y1||b.y1>o.y2));
  [...CITY_LABELS].sort((a,b)=>priority(b)-priority(a)).forEach(c=>{
    const [x,y]=project(c.lng,c.lat);if(x<0||x>1000||y<0||y>560)return;
    cityLayer.appendChild(svgEl('circle',{cx:x,cy:y,r:2.5,class:'city-dot'}));
    const width=Math.max(28,c.name.length*7.2),height=14;let chosen=null;
    for(const [dx,dy] of candidates){const anchor=dx<0?'end':'start';const lx=x+dx,ly=y+dy;const box={x1:anchor==='end'?lx-width:lx,x2:anchor==='end'?lx:lx+width,y1:ly-height+3,y2:ly+4};if(!overlaps(box)){chosen={dx,dy,anchor,box};break}}
    if(!chosen&&priority(c)<2)return;chosen=chosen||{dx:8,dy:-8,anchor:'start',box:{x1:x+8,x2:x+8+width,y1:y-19,y2:y-4}};occupied.push(chosen.box);
    if(Math.abs(chosen.dx)>10||Math.abs(chosen.dy)>14)cityLayer.appendChild(svgEl('line',{x1:x,y1:y,x2:x+chosen.dx*.72,y2:y+chosen.dy*.72,class:'city-leader'}));
    const label=svgEl('text',{x:x+chosen.dx,y:y+chosen.dy,class:`city-label ${capitalNames.has(c.name)?'capital-label':''}`,'text-anchor':chosen.anchor});label.textContent=c.name;cityLayer.appendChild(label);
  });
  svg.appendChild(cityLayer);

  const countryLayer=svgEl('g',{'aria-label':'country-labels'});
  COUNTRY_LABELS.forEach(l=>{const [x,y]=project(l.lng,l.lat);const t=svgEl('text',{x,y,class:'map-label aes','text-anchor':l.anchor||'middle'});t.textContent=l.name;countryLayer.appendChild(t)});
  svg.appendChild(countryLayer);host.appendChild(svg);

  const visibleEvents=events;
  const hasPrecise=e=>(Array.isArray(e.incident_locations)&&e.incident_locations.some(l=>hasCoord(l?.lat,l?.lng)))||hasCoord(e.lat,e.lng);
  const precise=visibleEvents.filter(hasPrecise);
  const mapPointCount=precise.reduce((n,e)=>{const locs=Array.isArray(e.incident_locations)?e.incident_locations.filter(l=>hasCoord(l?.lat,l?.lng)):[];return n+(locs.length||1)},0);
  const countCountry=name=>visibleEvents.filter(e=>e.country===name).length;
  const countryLevelCount=visibleEvents.filter(e=>!hasPrecise(e)&&Boolean(COUNTRY_EVENT_ANCHORS[e.country])).length;
  const unresolvedRows=visibleEvents.filter(e=>!hasPrecise(e)&&!COUNTRY_EVENT_ANCHORS[e.country]);
  const unresolved=unresolvedRows.length;
  setText('mapCountryCounts',`Candidate events ${visibleEvents.length} • Mali ${countCountry('Mali')} • Burkina Faso ${countCountry('Burkina Faso')} • Niger ${countCountry('Niger')} • Precisely mapped ${precise.length} • Map locations ${mapPointCount} • Country-level ${countryLevelCount} • Unresolved ${unresolved}`);
  const unresolvedBox=$('#unresolvedEvents');
  if(unresolvedBox){
    const countryOnly=visibleEvents.filter(e=>!hasPrecise(e)&&Boolean(COUNTRY_EVENT_ANCHORS[e.country]));
    const rows=[...countryOnly,...unresolvedRows];
    unresolvedBox.hidden=!rows.length;
    unresolvedBox.innerHTML=rows.length?`<strong>${rows.length} EVENT${rows.length===1?'':'S'} WITHOUT PRECISE COORDINATES</strong>${rows.slice(0,8).map(e=>`<button class="unresolved-row" data-event-id="${esc(e.id||'')}"><span>${esc(e.event_date||'date unresolved')} • ${esc(e.actor||'Other')}</span><b>${esc(e.event_type||'Unclassified')}</b><em>${esc(e.country||'country unresolved')}</em></button>`).join('')}`:'';
    unresolvedBox.querySelectorAll('.unresolved-row').forEach(b=>b.onclick=()=>{const e=visibleEvents.find(x=>String(x.id||'')===b.dataset.eventId);if(e)showEventDetail(e)});
  }
}
function showTip(ev,e){const tip=$('#maptip');tip.style.display='block';const rect=$('#map').getBoundingClientRect();tip.style.left=Math.min(rect.width-290,Math.max(8,ev.clientX-rect.left+10))+'px';tip.style.top=Math.min(rect.height-120,Math.max(8,ev.clientY-rect.top+10))+'px';tip.innerHTML=`<strong>${esc(e.actor)} • ${esc(e.event_type)}</strong><br>${esc([e.city,e.country].filter(Boolean).join(', '))}<br>${esc(e.title)}<br><span class="report-meta">${esc(e.source_count)} monitored source${e.source_count===1?'':'s'} • ${esc(e.corroboration)}</span>`}

function showClusterTip(ev,rows){
  if(rows.length===1)return showTip(ev,rows[0]);
  const tip=$('#maptip');tip.style.display='block';const rect=$('#map').getBoundingClientRect();tip.style.left=Math.min(rect.width-290,Math.max(8,ev.clientX-rect.left+10))+'px';tip.style.top=Math.min(rect.height-120,Math.max(8,ev.clientY-rect.top+10))+'px';
  const loc=[rows[0].city,rows[0].country].filter(Boolean).join(', ')||'country-level location';const uniqueCount=new Set(rows.map(r=>r._event_id||r.id)).size;
  tip.innerHTML=`<strong>${uniqueCount} EVENT${uniqueCount===1?'':'S'} • ${esc(loc)}</strong><br>${rows.map(e=>esc(`${e.event_date||'—'} • ${e.actor||'Other'} • ${e.event_type||'Unclassified'}`)).join('<br>')}<br><span class="report-meta">Click to inspect the event stack.</span>`;
}
function showEventCluster(rows){
  if(rows.length===1)return showEventDetail(rows[0]);
  const box=$('#mapEventDetail');if(!box)return;box.hidden=false;const uniqueCount=new Set(rows.map(r=>r._event_id||r.id)).size;
  box.innerHTML=`<button class="detail-close" aria-label="Close">×</button><span class="eyebrow">EVENT STACK</span><h3>${uniqueCount} candidate event${uniqueCount===1?'':'s'} at this mapped location</h3><div class="cluster-event-list">${rows.map(e=>`<button class="cluster-event-row"><strong>${esc(e.event_date||'—')} • ${esc(e.actor||'Other')} • ${esc(e.event_type||'Unclassified')}</strong><span>${esc(e.title||'No title')}</span></button>`).join('')}</div>`;
  box.querySelector('.detail-close').onclick=()=>{box.hidden=true};
  [...box.querySelectorAll('.cluster-event-row')].forEach((b,i)=>b.onclick=()=>showEventDetail(rows[i]));
}
function showEventDetail(e){
  if(window.SAHEL_EVENT_DRAWER?.open)return window.SAHEL_EVENT_DRAWER.open(e);
  const box=$('#mapEventDetail');if(!box)return;box.hidden=false;
  const src=(e.sources||e.source_names||[]);const sourceText=Array.isArray(src)?src.join(' • '):(e.source||`${e.source_count||1} monitored source(s)`);
  const linkedSummaries=Array.isArray(e.report_summaries)?e.report_summaries.filter(x=>x&&x.summary):[];
  const linkedHtml=linkedSummaries.length?`<div class="map-article-summaries"><h4>LINKED ARTICLE SUMMARIES</h4>${linkedSummaries.map((x,i)=>`<article><small>SOURCE ${i+1} • ${esc(sourceCodeForSummary(x))} • ${esc(x.source||'Unknown source')}</small><strong>${esc(x.title||'Untitled')}</strong><p>${esc(x.summary)}</p>${x.url?`<a href="${esc(x.url)}" target="_blank" rel="noopener">OPEN ARTICLE ↗</a>`:''}</article>`).join('')}</div>`:`<div class="map-article-summaries"><h4>ARTICLE / EVENT SUMMARY</h4><p>${esc(e.summary||e.title||'No summary available.')}</p></div>`;
  box.innerHTML=`<button class="detail-close" aria-label="Close">×</button><span class="eyebrow">EVENT EVIDENCE CARD</span><h3>${esc(e.actor||'Unattributed')} • ${esc(e.event_type||'Unclassified')}</h3><div class="event-detail-grid"><div><small>EVENT DATE</small><strong>${esc(e.event_date||'Unresolved')} • ${esc(e.event_date_confidence||'unresolved')}</strong></div><div><small>LOCATION</small><strong>${esc([e.city,e.country].filter(Boolean).join(', ')||'Unresolved')}</strong></div><div><small>CONFIDENCE</small><strong>${esc(e.confidence||e.corroboration||'Candidate')}</strong></div><div><small>SOURCES</small><strong>${esc(e.source_count??1)}</strong></div></div><div class="event-summary"><small>EVENT SUMMARY</small><p>${esc(e.summary||e.title||'No event summary available.')}</p></div>${linkedHtml}${(e.perpetrator||e.target||e.claimant||e.supporting_force)?`<div class="actor-role-line">${e.perpetrator?`<span>Perpetrator: <b>${esc(e.perpetrator)}</b></span>`:''}${e.target?`<span>Target: <b>${esc(e.target)}</b></span>`:''}${e.claimant?`<span>Claimant: <b>${esc(e.claimant)}</b></span>`:''}${e.supporting_force?`<span>Supporting force: <b>${esc(e.supporting_force)}</b></span>`:''}</div>`:''}<div class="report-meta">Published: ${esc(fmtTime(e.published_at))} • Collected: ${esc(fmtTime(e.collected_at))}<br>${esc(sourceText)}</div>`;
  box.querySelector('.detail-close').onclick=()=>{box.hidden=true};
}
function hideTip(){const t=$('#maptip');if(t)t.style.display='none'}

function chartDateLabel(v){
  if(!v)return '—';
  const d=new Date(String(v).slice(0,10)+'T00:00:00Z');
  if(isNaN(d))return String(v);
  return d.toLocaleDateString(undefined,{month:'short',day:'numeric',timeZone:'UTC'});
}
function uniqueReports(rows){
  const out=[],seen=new Set();
  for(const r of rows||[]){const k=reportKey(r);if(!k||seen.has(k))continue;seen.add(k);out.push(r);}
  return out;
}
function linkedReportsForEvents(events){
  const urls=new Set(),ids=new Set();
  for(const e of events||[]){
    for(const u of [...(e.report_urls||[]),...(e.source_urls||[])])if(u)urls.add(String(u));
    for(const x of e.report_summaries||[])if(x?.url)urls.add(String(x.url));
    if(e.parent_report_id)ids.add(String(e.parent_report_id));
  }
  let rows=(state.reports||[]).filter(r=>urls.has(String(r.url||''))||ids.has(String(r.id||'')));
  if(!rows.length&&(events||[]).length){
    rows=(state.reports||[]).filter(r=>(events||[]).some(e=>
      String(r.event_date||'').slice(0,10)===String(e.event_date||'').slice(0,10)
      && String(r.actor_bucket||'')===String(e.actor||'')
      && (!e.country||r.country===e.country)
      && r.candidate_event
    ));
  }
  return uniqueReports(rows);
}
function chartPointContext(series,date,value){
  const day=String(date||'').slice(0,10);
  let events=[],reports=[],note='';
  if(series==='Relevant reports'){
    reports=(state.reports||[]).filter(r=>reportDateKey(r)===day);
  }else if(series==='Candidate events'){
    events=(state.events||[]).filter(e=>String(e.event_date||'').slice(0,10)===day);
    reports=linkedReportsForEvents(events);
  }else if(series==='Aggregated logistics observations'){
    note='This logistics series is aggregate-only. No observation-level aircraft identifiers, routes, or source records are published.';
  }else{
    events=(state.events||[]).filter(e=>String(e.event_date||'').slice(0,10)===day&&String(e.actor||'')===String(series||''));
    reports=linkedReportsForEvents(events);
  }
  reports=uniqueReports(reports);
  const sources=[],seen=new Set();
  for(const r of reports){
    const code=sourceCodeForReport(r),name=r.source||'Unknown source',k=code+'|'+name;
    if(seen.has(k))continue;seen.add(k);sources.push({code,name});
  }
  return {series:String(series||'Data'),date:day,value:Number(value)||0,events,reports,sources,note};
}
function ensureChartTip(){
  let tip=$('#chartPointTip');
  if(tip)return tip;
  tip=document.createElement('div');tip.id='chartPointTip';tip.className='chart-point-tip';tip.hidden=true;document.body.appendChild(tip);return tip;
}
function showChartPointTip(point){
  const tip=ensureChartTip(),ctx=chartPointContext(point.dataset.series,point.dataset.date,point.dataset.value);
  const eventLine=ctx.events.length?`<div><b>${ctx.events.length}</b> fused candidate event${ctx.events.length===1?'':'s'}</div>`:'';
  const sources=ctx.sources.length?ctx.sources.slice(0,6).map(s=>`<span><b>${esc(s.code)}</b> ${esc(s.name)}</span>`).join(''):'<span>No linked source report in the public archive.</span>';
  const hint=ctx.reports.length?'<em>Click this point to open and highlight the linked Intel Feed reports.</em>':(ctx.note?`<em>${esc(ctx.note)}</em>`:'');
  tip.innerHTML=`<strong>${esc(ctx.series)} • ${esc(chartDateLabel(ctx.date))}</strong><div class="chart-point-value">COUNT ${ctx.value}</div>${eventLine}<div class="chart-point-sources">${sources}</div>${hint}`;
  const rect=point.getBoundingClientRect();
  tip.hidden=false;
  const w=Math.min(380,Math.max(260,tip.offsetWidth||320));
  const left=Math.max(8,Math.min(window.innerWidth-w-8,rect.left+rect.width/2-w/2));
  const top=Math.max(8,rect.top-(tip.offsetHeight||150)-10);
  tip.style.left=left+'px';tip.style.top=top+'px';
}
function hideChartPointTip(){const tip=$('#chartPointTip');if(tip)tip.hidden=true;}
function clearChartJump(){
  $$('.report-jump-highlight').forEach(el=>el.classList.remove('report-jump-highlight'));
  const box=$('#feedJumpContext');if(box){box.hidden=true;box.innerHTML='';}
}
function jumpToReports(reports,context={}){
  reports=uniqueReports(reports);
  if(!reports.length)return false;
  state.langFilter='all';state.countryFilter='all';
  $$('.lang').forEach(b=>b.classList.toggle('active',b.dataset.lang==='all'));
  $$('.country-feed').forEach(b=>b.classList.toggle('active',b.dataset.country==='all'));
  const feedTab=$('.tab[data-view="feed"]');if(feedTab)feedTab.click();else renderFeeds();
  renderFeeds();
  const box=$('#feedJumpContext');
  if(box){
    const sourceList=uniqueReports(reports).map(r=>sourceCodeForReport(r)+' '+(r.source||'Unknown source'));
    box.hidden=false;
    box.innerHTML=`<div><strong>CHART SELECTION</strong><span>${esc(context.label||'Linked source reporting')}</span><small>${esc(sourceList.join(' • '))}</small></div><button type="button" id="clearChartJump">CLEAR HIGHLIGHT</button>`;
    $('#clearChartJump')?.addEventListener('click',clearChartJump);
  }
  requestAnimationFrame(()=>{
    clearChartJumpHighlightsOnly();
    const cards=reports.map(r=>document.getElementById('feed-'+reportDomToken(r))).filter(Boolean);
    cards.forEach(el=>el.classList.add('report-jump-highlight'));
    cards[0]?.scrollIntoView({behavior:'smooth',block:'center'});
  });
  return true;
}
function clearChartJumpHighlightsOnly(){$$('.report-jump-highlight').forEach(el=>el.classList.remove('report-jump-highlight'));}
function openChartPoint(point){
  const ctx=chartPointContext(point.dataset.series,point.dataset.date,point.dataset.value);
  if(!ctx.reports.length){showChartPointTip(point);return;}
  hideChartPointTip();
  jumpToReports(ctx.reports,{label:`${ctx.series} • ${chartDateLabel(ctx.date)} • ${ctx.value} record${ctx.value===1?'':'s'}`});
}
function bindChartPoints(host){
  if(!host)return;
  host.querySelectorAll('.chart-point').forEach(point=>{
    point.addEventListener('mouseenter',()=>showChartPointTip(point));
    point.addEventListener('mouseleave',hideChartPointTip);
    point.addEventListener('focus',()=>showChartPointTip(point));
    point.addEventListener('blur',hideChartPointTip);
    point.addEventListener('click',()=>openChartPoint(point));
    point.addEventListener('keydown',ev=>{if(ev.key==='Enter'||ev.key===' '){ev.preventDefault();openChartPoint(point);}});
  });
}
function lineSVG(seriesList,{height=100,showAxes=false,labels=[],pointLabels=false}={}){
  const width=800;
  const left=showAxes?46:5,right=showAxes?12:5,top=showAxes?15:5,bottom=showAxes?30:5;
  const vals=seriesList.flatMap(x=>x.values||[]).map(Number).filter(Number.isFinite);
  const rawMax=Math.max(0,...vals);
  const step=Math.max(1,Math.ceil(rawMax/4));
  const yMax=Math.max(4,step*4);
  const n=Math.max(2,...seriesList.map(x=>(x.values||[]).length),labels.length);
  const sx=i=>left+(i/(n-1))*(width-left-right);
  const sy=v=>top+(1-(Number(v)||0)/yMax)*(height-top-bottom);
  let grid='';
  if(showAxes){
    for(let i=0;i<=4;i++){
      const value=yMax-(i*step);
      const y=top+i*(height-top-bottom)/4;
      grid+='<line x1="'+left+'" y1="'+y+'" x2="'+(width-right)+'" y2="'+y+'" stroke="var(--chart-grid)" stroke-width="1"/>';
      grid+='<text x="'+(left-7)+'" y="'+(y+3)+'" text-anchor="end" fill="var(--chart-axis)" font-size="9">'+value+'</text>';
    }
    const idxs=[0,Math.round((n-1)*.25),Math.round((n-1)*.5),Math.round((n-1)*.75),n-1].filter((v,i,a)=>a.indexOf(v)===i);
    for(const i of idxs){
      const lab=labels[i]??String(i+1);
      grid+='<line x1="'+sx(i)+'" y1="'+(height-bottom)+'" x2="'+sx(i)+'" y2="'+(height-bottom+4)+'" stroke="var(--chart-axis)" stroke-width="1"/>';
      grid+='<text x="'+sx(i)+'" y="'+(height-8)+'" text-anchor="middle" fill="var(--chart-axis)" font-size="9">'+esc(chartDateLabel(lab))+'</text>';
    }
    grid+='<text x="12" y="'+(height/2)+'" transform="rotate(-90 12 '+(height/2)+')" text-anchor="middle" fill="var(--chart-axis)" font-size="9">COUNT</text>';
    grid+='<text x="'+(width/2)+'" y="'+(height-1)+'" text-anchor="middle" fill="var(--chart-axis)" font-size="9">DATE</text>';
  }
  const lines=seriesList.map(series=>{
    const values=series.values||[];
    if(!values.length)return '';
    const pts=values.map((v,i)=>sx(i)+','+sy(v)).join(' ');
    let out='<polyline fill="none" stroke="'+series.color+'" stroke-width="2.3" points="'+pts+'" vector-effect="non-scaling-stroke"/>';
    values.forEach((v,i)=>{
      if(!Number.isFinite(Number(v)))return;
      if(values.length<=45||Number(v)>0||i===values.length-1){
        out+='<circle class="chart-point" tabindex="0" role="button" aria-label="'+esc((series.label||'Series')+' '+chartDateLabel(labels[i])+' count '+Number(v))+'" data-series="'+esc(series.label||'Series')+'" data-date="'+esc(labels[i]||'')+'" data-value="'+Number(v)+'" cx="'+sx(i)+'" cy="'+sy(v)+'" r="'+(values.length<=45?3.4:2.8)+'" fill="'+series.color+'"><title>'+esc(series.label||'Series')+' • '+esc(chartDateLabel(labels[i]))+' • '+Number(v)+'</title></circle>';
      }
      if(pointLabels&&Number(v)>0&&values.length<=31){
        out+='<text x="'+sx(i)+'" y="'+Math.max(9,sy(v)-6)+'" text-anchor="middle" fill="var(--chart-axis)" font-size="8">'+Number(v)+'</text>';
      }
    });
    return out;
  }).join('');
  return '<svg viewBox="0 0 '+width+' '+height+'" preserveAspectRatio="none" role="img" aria-label="Quantitative time-series chart">'+grid+lines+'</svg>';
}
function chartDataTable(labels,seriesList){
  const n=Math.max(labels.length,...seriesList.map(x=>(x.values||[]).length));
  if(!n)return '<div class="muted-empty">No numeric observations.</div>';
  const head='<thead><tr><th>Date</th>'+seriesList.map(x=>'<th>'+esc(x.label||'Value')+'</th>').join('')+'</tr></thead>';
  const body=Array.from({length:n},(_,i)=>'<tr><td>'+esc(labels[i]||'—')+'</td>'+seriesList.map(x=>'<td>'+esc((x.values||[])[i]??0)+'</td>').join('')+'</tr>').join('');
  return '<table class="numeric-data-table">'+head+'<tbody>'+body+'</tbody></table>';
}
function renderRussianLogistics(){
  const r=state.russianLogistics||{};
  setText('rlogStatus',r.configured?'ACTIVE AGGREGATE':'NOT CONFIGURED');
  setText('rlog24',r.last_24h??0);
  setText('rlog7',r.current_7d??0);
  setText('rlog30',r.current_30d??0);
  const ch=$('#rlogChange');
  if(ch){if(r.change_7d_pct===null||r.change_7d_pct===undefined){ch.textContent=(r.current_7d??0)>0?'NEW':'—';ch.className='flat'}else{const n=Number(r.change_7d_pct)||0;ch.textContent=`${n>0?'+':''}${n.toFixed(1)}%`;ch.className=n>0?'up':n<0?'down':'flat';}}
  const rows=Array.isArray(r.daily)?r.daily.slice(-30):[];
  const labels=rows.map(x=>x.date),values=rows.map(x=>Number(x.count)||0);
  const host=$('#rlogChart');
  if(host){host.innerHTML=rows.length?lineSVG([{label:'Aggregated logistics observations',values,color:actorColor('Africa Corps/Wagner')}],{height:150,showAxes:true,labels,pointLabels:true})+'<div class="mini-chart-readout">'+esc(chartDateLabel(labels[0]))+' → '+esc(chartDateLabel(labels.at(-1)))+' • 30D total '+values.reduce((a,b)=>a+b,0)+'</div>':'<div class="runbox">No compliant flight-log observations have been ingested yet.</div>';bindChartPoints(host);}
  setText('rlogNote',(r.method_note||'Flight-log observations are a logistics proxy, not a confirmed troop count.')+' '+(r.public_redaction||''));
}
function renderActors(){
  const m=state.metrics;if(!m)return;
  const ids={'JNIM':['jnim7','jnimChange','jnimSpark'],'IS Sahel':['is7','isChange','isSpark'],'State':['state7','stateChange','stateSpark'],'Africa Corps/Wagner':['africa7','africaChange','africaSpark']};
  Object.entries(ids).forEach(([actor,[countId,chgId,sparkId]])=>{
    const trend=m.trends_7d?.[actor],rows=(m.series?.[actor]||[]).slice(-30);
    setText(countId,trend?.current??0);
    const ch=$('#'+chgId);ch.textContent=pct(trend);ch.className=trendClass(trend);
    const labels=rows.map(x=>x.date),values=rows.map(x=>Number(x.count)||0);
    const total=values.reduce((a,b)=>a+b,0),max=Math.max(0,...values),latest=values.at(-1)??0;
    $('#'+sparkId).innerHTML=lineSVG([{label:actor,values:values,color:actorColor(actor)}],{height:92,showAxes:true,labels:labels,pointLabels:true})+
      '<div class="mini-chart-readout">'+esc(chartDateLabel(labels[0]))+' → '+esc(chartDateLabel(labels.at(-1)))+' • latest '+latest+' • 30D total '+total+' • max/day '+max+'</div>';
    bindChartPoints($('#'+sparkId));
  });
  renderRussianLogistics();
}
function renderQuant(){
  const m=state.metrics;if(!m)return;
  const actors=['JNIM','IS Sahel','State','Africa Corps/Wagner'];
  const rowsByActor=Object.fromEntries(actors.map(a=>[a,(m.series?.[a]||[]).slice(-state.range)]));
  const labels=(rowsByActor['JNIM']||[]).map(x=>x.date);
  const series=actors.map(a=>({label:a,color:actorColor(a),values:(rowsByActor[a]||[]).map(x=>Number(x.count)||0)}));
  $('#actorChart').innerHTML=lineSVG(series,{height:330,showAxes:true,labels:labels,pointLabels:state.range<=30});
  bindChartPoints($('#actorChart'));
  const readout=series.map(x=>x.label+': latest '+(x.values.at(-1)??0)+' • period total '+x.values.reduce((a,b)=>a+b,0)+' • max/day '+Math.max(0,...x.values)).join(' | ');
  setText('actorChartReadout',chartDateLabel(labels[0])+' → '+chartDateLabel(labels.at(-1))+' • '+readout);
  const dataHost=$('#actorChartData');if(dataHost)dataHost.innerHTML=chartDataTable(labels,series);
  setText('metricNote',m.method_note||'');
  [['JNIM','qJnim','qJnimChange','qJnim30','qJnim30Change'],['IS Sahel','qIs','qIsChange','qIs30','qIs30Change'],['State','qState','qStateChange','qState30','qState30Change'],['Africa Corps/Wagner','qAfrica','qAfricaChange','qAfrica30','qAfrica30Change']].forEach(([a,cid,xid,c30,x30])=>{
    const t7=m.trends_7d?.[a],t30=m.trends_30d?.[a];
    setText(cid,t7?.current??0);const e7=$('#'+xid);e7.textContent=pct(t7);e7.className='quantchange '+trendClass(t7);
    setText(c30,t30?.current??0);const e30=$('#'+x30);e30.textContent=pct(t30);e30.className='quantchange '+trendClass(t30);
  });
}
function kvBars(obj,limit=8){
  const entries=Object.entries(obj||{}).sort((a,b)=>b[1]-a[1]).slice(0,limit);
  const max=Math.max(1,...entries.map(x=>Number(x[1])||0));
  return entries.map(([k,v])=>`<div class="barrow"><span>${esc(k)}</span><div><i style="width:${Math.max(4,(Number(v)||0)/max*100)}%"></i></div><strong>${esc(v)}</strong></div>`).join('')||'<div class="muted-empty">No data in this window.</div>';
}
function renderThirty(){
  const t=state.thirty;if(!t)return;
  setText('thirtyStamp',`through ${fmtTime(t.generated_at)}`);
  const summary=[
    ['Relevant reports',t.reports??0],['Candidate events',t.candidate_events??0],['Corroborated',t.corroborated_events??0],
    ['Mapped events',t.mapped_events??0],['Sources represented',t.distinct_sources??0],
    ['JNIM',t.by_actor?.['JNIM']??0],['IS Sahel',t.by_actor?.['IS Sahel']??0],['State',t.by_actor?.['State']??0],['Other',t.by_actor?.['Other']??0]
  ];
  $('#thirtySummary').innerHTML=summary.map(([k,v])=>`<div class="opscard"><span>${esc(k)}</span><strong>${esc(v)}</strong></div>`).join('');
  $('#thirtyActors').innerHTML=kvBars(t.by_actor,8);
  $('#thirtyCountries').innerHTML=kvBars(t.by_country,8);
  $('#thirtyTypes').innerHTML=kvBars(t.by_event_type,10);
  $('#thirtyLanguages').innerHTML=kvBars(t.by_language,8);
  const srcObj=Object.fromEntries((t.top_sources||[]).map(x=>[(x.source_code?x.source_code+' • ':'')+x.source,x.count]));
  $('#thirtySources').innerHTML=kvBars(srcObj,10);
  const daily=t.daily||[];
  const dailyLabels=daily.map(x=>x.date);
  const reportSeries=daily.map(x=>Number(x.reports)||0),eventSeries=daily.map(x=>Number(x.events)||0);
  const thirtySeries=[{label:'Relevant reports',values:reportSeries,color:'#59c3d8'},{label:'Candidate events',values:eventSeries,color:'#e7ad53'}];
  $('#thirtyChart').innerHTML=lineSVG(thirtySeries,{height:180,showAxes:true,labels:dailyLabels,pointLabels:true})+
    '<div class="chartlegend"><span><i class="dot" style="background:#59c3d8"></i>Relevant reports</span><span><i class="dot state"></i>Candidate events</span></div>';
  bindChartPoints($('#thirtyChart'));
  setText('thirtyChartReadout',chartDateLabel(dailyLabels[0])+' → '+chartDateLabel(dailyLabels.at(-1))+' • reports '+reportSeries.reduce((a,b)=>a+b,0)+' • candidate events '+eventSeries.reduce((a,b)=>a+b,0)+' • latest day '+(reportSeries.at(-1)??0)+' reports / '+(eventSeries.at(-1)??0)+' events');
  const thirtyData=$('#thirtyChartData');if(thirtyData)thirtyData.innerHTML=chartDataTable(dailyLabels,thirtySeries);
  $('#thirtyTimeline').innerHTML=(t.latest_events||[]).slice(0,24).map((e,i)=>`<div class="timeline-row timeline-event" role="button" tabindex="0" data-event-index="${i}" data-event-date="${esc(e.event_date||'')}"><span>${esc(e.event_date||'—')}</span><b style="color:${actorColor(e.actor)}">${esc(e.actor||'Other')}</b><span>${esc(e.event_type||'event')}</span><span>${esc([e.city,e.country].filter(Boolean).join(', ')||'Location unresolved')}</span><strong>${esc(e.source_count??1)} src</strong><p>${esc(e.title||'')}<small class="timeline-open-hint">VIEW DOSSIER →</small></p></div>`).join('')||'<div class="runbox">No candidate events currently fall inside the 30-day window.</div>';
  $('#thirtyReports').innerHTML=(t.latest_reports||[]).slice(0,28).map(r=>`<div class="timeline-row report-row"><span>${esc(r.published_at?fmtTimestampUTC(r.published_at):'PUB UNAVAILABLE')}</span><b>${esc((r.language||'').toUpperCase())}</b><span>${esc(r.candidate_event?'EVENT':'REPORT')}</span><span>${esc([r.city,r.country].filter(Boolean).join(', ')||'Regional')}</span><strong>${esc((r.source_code||sourceCodeByName(r.source)||'SRC-UNASSIGNED')+' • '+(r.source||''))}</strong><p>${esc(r.title||'')}<br><small>Collected: ${esc(fmtTimestampUTC(r.collected_at||r.discovered_at))}</small></p></div>`).join('')||'<div class="runbox">No relevant reports currently fall inside the 30-day window.</div>';
  setText('thirtyNote',t.method_note||'');
  const dates=[...new Set((t.latest_events||[]).map(e=>e.event_date).filter(Boolean))].sort().reverse();
  const strip=$('#eventDateStrip');if(strip)strip.innerHTML=dates.map(d=>`<button class="date-chip ${state.timelineDate===d?'active':''}" data-date="${esc(d)}">${esc(d.slice(5))}</button>`).join('')||'<span class="report-meta">No dated candidate events.</span>';
  $$('.date-chip').forEach(b=>b.onclick=()=>{state.timelineDate=b.dataset.date;$('#clearTimelineFilter').hidden=false;renderMap();renderThirty()});
  $$('.timeline-event').forEach(r=>{const open=()=>{const e=(t.latest_events||[])[Number(r.dataset.eventIndex)];if(e&&window.SAHEL_EVENT_DRAWER?.open)window.SAHEL_EVENT_DRAWER.open(e)};r.onclick=open;r.onkeydown=ev=>{if(ev.key==='Enter'||ev.key===' '){ev.preventDefault();open()}}});
  const clear=$('#clearTimelineFilter');if(clear){clear.hidden=!state.timelineDate;clear.onclick=()=>{state.timelineDate=null;renderMap();renderThirty()}};
}

function downloadSultanaBrief(b,format='json'){
  if(!b)return;
  const date=String(b.reporting_date||new Date().toISOString().slice(0,10));
  if(format==='txt'){downloadBlob(b.text||'No briefing text available.',`sultana-aes-brief-${date}.txt`,'text/plain;charset=utf-8');return;}
  downloadBlob(JSON.stringify(b,null,2),`sultana-aes-brief-${date}.json`,'application/json;charset=utf-8');
}
function renderSultanaArchive(){
  const host=$('#sultanaArchive');if(!host)return;
  const rows=Array.isArray(state.sultanaArchive?.briefings)?state.sultanaArchive.briefings:[];
  setText('sultanaArchiveCount',`${rows.length} brief${rows.length===1?'':'s'}`);
  host.innerHTML=rows.map((b,i)=>{
    const cov=b.coverage||{};
    return `<article class="sultana-archive-row"><div><strong>${esc(b.reporting_date||'Undated')}</strong><span>${esc(cov.retained_articles_reviewed??0)} articles • ${esc(cov.distinct_sources??0)} sources • ${esc(b.assessment_confidence||'UNRATED')} confidence</span></div><div class="sultana-archive-actions"><button type="button" data-sultana-download="${i}" data-format="txt">TXT</button><button type="button" data-sultana-download="${i}" data-format="json">JSON</button></div></article>`;
  }).join('')||'<div class="runbox">No archived Sultana briefings yet.</div>';
  host.querySelectorAll('[data-sultana-download]').forEach(btn=>{btn.onclick=()=>downloadSultanaBrief(rows[Number(btn.dataset.sultanaDownload)],btn.dataset.format||'json');});
}
function renderBriefing(){
  const b=state.briefing;if(!b)return;
  const cov=b.coverage||{};
  setText('briefStamp','');
  const briefStamp=$('#briefStamp');
  if(briefStamp)briefStamp.hidden=true;
  const meta=$('#sultanaBriefMeta');
  if(meta)meta.innerHTML=[
    ['ARTICLES REVIEWED',cov.retained_articles_reviewed??0],
    ['DISTINCT SOURCES',cov.distinct_sources??0],
    ['LINKED EVENTS',cov.linked_candidate_events??0],
    ['MULTI-SOURCE',cov.multi_source_candidate_events??0],
    ['WINDOW','24H'],
    ['CONFIDENCE',b.assessment_confidence||'UNRATED']
  ].map(([k,v])=>`<div><span>${esc(k)}</span><strong>${esc(v)}</strong></div>`).join('');
  const host=$('#briefing');
  if(host){
    const sections=Array.isArray(b.sections)?b.sections:[];
    host.innerHTML=sections.length?sections.map(s=>`<section class="sultana-brief-section"><h3>${esc(s.heading||'Assessment')}</h3>${s.text?`<p>${esc(s.text)}</p>`:''}${Array.isArray(s.bullets)&&s.bullets.length?`<ul>${s.bullets.map(x=>`<li>${esc(x)}</li>`).join('')}</ul>`:''}</section>`).join(''):`<pre>${esc(b.text||'No briefing generated.')}</pre>`;
  }
  const txt=$('#downloadSultanaTxt');if(txt)txt.onclick=()=>downloadSultanaBrief(b,'txt');
  const json=$('#downloadSultanaJson');if(json)json.onclick=()=>downloadSultanaBrief(b,'json');
  const all=$('#downloadAllSultanaJson');if(all)all.onclick=()=>downloadBlob(JSON.stringify(state.sultanaArchive||{briefings:[]},null,2),'sultana-aes-briefing-archive.json','application/json;charset=utf-8');
  renderSultanaArchive();
}

function renderOps(){
  const o=state.overview||{},r=o.last_run||{},on=o.source_onboarding||{};setText('sourceMonitorTitle',`${o.sources_configured??state.sources.length??74} Active Sources • ${on.candidate_total??300} Candidate Registry`);
  $('#opsSummary').innerHTML=[['Patch',o.site_patch_version||SITE_UI_VERSION],['Active sources',o.sources_configured??74],['Candidate registry',on.candidate_total??300],['Verified / active candidates',on.verified_or_active??0],['Dynamic sources loaded',r.dynamic_sources_loaded??on.dynamic_sources_enabled??0],['Verified this run',r.source_candidates_verified_this_run??on.verified_this_run??0],['Live',o.sources_live??0],['Degraded',o.sources_degraded??0],['Failed',o.sources_failed??0],['Report target',`${r.documents_retained??0}/${r.report_target??100}`],['Collection waves',r.collection_waves??0],['Targeted sources queried',r.targeted_sources_queried??0],['Targeted links added',r.targeted_links_discovered??0],['Links discovered',r.documents_discovered??0],['Articles attempted',r.documents_selected??0],['Pre-fetch filtered',r.prefetch_skipped??0],['Previously seen',r.known_url_skipped??0],['URL dupes',r.duplicate_url_skipped??0],['Title dupes',r.title_duplicates_skipped??0],['Source-cap skipped',r.source_cap_skipped??0],['New relevant',r.documents_retained??0],['Research leads',r.research_leads_archive??0],['Indexed context',r.indexed_context_archive??0],['Analytical context',r.analytical_context_archive??0],['Child incidents',r.analytical_child_incidents??0],['Archive total',r.archive_reports??state.reports.length],['Candidate events',r.candidate_events_archive??state.events.length],['Events 7D',r.candidate_events_7d??0],['Events 30D',r.candidate_events_30d??state.thirty?.candidate_events??0],['Reports 30D',r.reports_30d??state.thirty?.reports??0],['Archive rejects',r.archive_rejected_by_precision_rules??0],['Archive rescreened',r.archive_rescreened??0],['Date proxies',r.event_date_proxy_reports??0],['Funnel audit gap',r.funnel_unaccounted??0],['Translations',r.translations??0],['Translation fails',r.translation_failures??0]].map(([k,v])=>`<div class="opscard"><span>${esc(k)}</span><strong>${esc(v)}</strong></div>`).join('');
  const lc=o.language_coverage||{},selectedLang=r.selected_by_language||{},retainedLang=r.retained_cycle_by_language||{};
  const langs=[['fr','French'],['en','English'],['ar','Arabic']];
  const total30=langs.reduce((n,[k])=>n+(lc[k]?.reports_30d||0),0);
  $('#languageCoverage').innerHTML=langs.map(([k,label])=>{const x=lc[k]||{};const share=total30?Math.round((x.reports_30d||0)*100/total30):0;return `<div class="language-row"><strong>${label}</strong><span>${x.configured_sources??0} sources</span><span>${selectedLang[k]??0} selected → ${retainedLang[k]??0} retained</span><span>${x.reports_30d??0} reports / 30D</span><b>${share}%</b></div>`}).join('');
  const ar30=lc.ar?.reports_30d||0,en30=lc.en?.reports_30d||0,fr30=lc.fr?.reports_30d||0;
  const warnings=[];if(ar30===0)warnings.push('ARABIC COLLECTION GAP: zero retained Arabic reports in the last 30 days.');if(en30>0&&fr30/en30>=5)warnings.push('LANGUAGE IMBALANCE: French reporting exceeds English by at least 5:1.');if(total30&&Math.max(fr30,en30,ar30)/total30>.85)warnings.push('COLLECTION BIAS WARNING: one language supplies more than 85% of retained 30-day reporting.');
  $('#languageWarning').textContent=warnings.join(' ' )||'No severe language-coverage warning in the current 30-day corpus.';
  const q=o.data_quality||{};setText('qualityStatus',q.collection_status||'—');
  const qm=[['Date resolution',q.date_resolution_pct],['Precise geography',q.precise_geography_pct],['Actor attribution',q.actor_attribution_pct],['Multi-source corroboration',q.multi_source_corroboration_pct]];
  $('#qualityMetrics').innerHTML=qm.map(([k,v])=>`<div><span>${esc(k)}</span><strong>${esc(v??0)}%</strong><i><b style="width:${Math.max(0,Math.min(100,Number(v)||0))}%"></b></i></div>`).join('');
  const blind=q.collection_blind_spots||[];$('#blindSpotWarning').textContent=blind.length?'COLLECTION DEGRADED: '+blind.join(' • '):'No major collection blind spot detected by the current automated checks.';
  const t=state.thirty||{};const reports30=t.reports??0,incidentReports=t.incident_reports??0,events30=t.candidate_events??0,corroborated=t.corroborated_events??0;
  $('#pipelineFunnel').innerHTML=`<span>${reports30} relevant reports / 30D</span><i>→</i><span>${incidentReports} incident reports</span><i>→</i><span>${events30} unique fused events</span><i>→</i><span>${corroborated} multi-source events</span>`;
  $('#sourceRows').innerHTML=state.sources.map(s=>`<tr><td><b class="source-code">${esc(s.source_code||sourceCodeById(s.id)||'SRC-UNASSIGNED')}</b></td><td><a href="${esc(s.homepage)}" target="_blank" rel="noopener">${esc(s.name)}</a></td><td>${esc((s.language||'').toUpperCase())}</td><td>${esc(s.source_type||'—')}</td><td>${esc(s.focus)}</td><td class="statuscell ${statusClass(s.status)}">${esc(s.status)}</td><td>${esc(s.access_mode||'—')}</td><td>${esc(s.contribution_status||'—')}</td><td>${esc(relTime(s.last_checked_at))}</td><td>${esc(s.last_discovered_candidates??0)}</td><td>${esc(s.last_new_documents??0)}</td><td>${esc((s.translation_success_archive??0)+'/'+(s.translation_eligible_archive??0))}</td><td>${esc(s.error_category||'')}</td></tr>`).join('');
  $('#runHistory').innerHTML=state.runs.map(r=>`<div class="runrow"><span>${esc(fmtTime(r.finished_at||r.started_at))}</span><strong>${esc(r.status)}</strong><span>${r.sources_success}/${r.sources_total} sources</span><span>${r.documents_discovered} discovered</span><span>${r.documents_retained} new relevant</span><span>${r.archive_reports??"—"} archive reports</span><span>${r.candidate_events_archive??"—"} candidate events</span><span>${r.archive_rejected_by_precision_rules??0} archive rejects</span><span>${r.translations??0}/${r.translations_attempted??0} translated</span><span>${r.translation_failures??0} translation failures</span><span>${r.event_changes} event changes</span></div>`).join('')||'<div class="runbox">No completed runs yet.</div>';
}

function loadVoices(){state.voices=speechSynthesis.getVoices();const sel=$('#voiceSelect');if(!sel)return;const prior=sel.value;sel.innerHTML='';state.voices.forEach((v,i)=>{const o=document.createElement('option');o.value=i;o.textContent=v.name;sel.appendChild(o)});let idx=prior!==''?Number(prior):-1;if(!Number.isFinite(idx)||!state.voices[idx])idx=state.voices.findIndex(v=>/Microsoft Ava Online \(Natural\)/i.test(v.name));if(idx<0)idx=state.voices.findIndex(v=>/Ava/i.test(v.name));if(idx<0)idx=state.voices.findIndex(v=>v.lang&&v.lang.toLowerCase().startsWith('en'));if(idx>=0)sel.value=idx;setText('voiceStatus',idx>=0?state.voices[idx].name:'default browser voice')}
if('speechSynthesis'in window){loadVoices();speechSynthesis.onvoiceschanged=loadVoices;}
function sentenceChunks(text){const parts=(text||'').match(/[^.!?]+[.!?]+|[^.!?]+$/g)||[];const out=[];let cur='';for(const p of parts){if((cur+' '+p).length>430&&cur){out.push(cur.trim());cur=p}else cur+=' '+p}if(cur.trim())out.push(cur.trim());return out}
function selectedVoice(){const sel=$('#voiceSelect');return state.voices[Number(sel?.value)]||null}
function reportTimestamp(r){const d=new Date(r.published_at||r.discovered_at||0);return isNaN(d)?0:d.getTime()}
function reportInReaderWindow(r){if(state.readerRange==='all')return true;const ts=reportTimestamp(r);if(!ts)return false;return Date.now()-ts<=Number(state.readerRange)*86400000}
function isReadableReport(r){return Boolean(r&&r.title&&((r.language==='en')||(r.translated_title&&r.translation_status==='success')))}
function buildReaderQueue(){return state.reports.filter(r=>isReadableReport(r)&&reportInReaderWindow(r)).sort((a,b)=>reportTimestamp(b)-reportTimestamp(a))}
function readerText(r,index,total){const translated=r.language!=='en'&&r.translated_title;const title=translated?r.translated_title:r.title;const body=translated?(r.translated_excerpt||''):(r.excerpt||'');const location=[r.city,r.country].filter(Boolean).join(', ');const kind=r.candidate_event?'candidate event':'context report';const lang=translated?`translated from ${(r.language||'').toUpperCase()}`:'English original';const bits=[`Source ${index+1} of ${total}.`,r.source?`From ${r.source}.`:'',location?`${location}.`:'',`${kind}.`,`${lang}.`,title?`${title}.`:'',body&&body!==title?body:''];return bits.filter(Boolean).join(' ')}
function updateReaderStatus(){const readable=buildReaderQueue();const waiting=state.reports.filter(r=>r.language!=='en'&&!r.translated_title).length;const rangeLabel=state.readerRange==='all'?'archive':`${state.readerRange}D`;if(state.readerRunning){const current=Math.min(state.readerIndex+1,Math.max(1,state.readerQueue.length));setText('readerStatus',state.readerPaused?`Paused • ${current}/${state.readerQueue.length} • ${rangeLabel}`:`Reading ${current}/${state.readerQueue.length} • cycle ${state.readerCycle+1} • ${rangeLabel}`)}else setText('readerStatus',`${readable.length} readable English/translated reports • ${waiting} awaiting translation • ${rangeLabel}`)}
async function speakChunk(chunk,mode='briefing',session=null){if(!chunk)return;await new Promise(resolve=>{let done=false;const finish=()=>{if(done)return;done=true;clearInterval(guard);resolve()};const u=new SpeechSynthesisUtterance(chunk);const voice=selectedVoice();if(voice)u.voice=voice;u.rate=.95;u.pitch=1;u.onend=finish;u.onerror=finish;const guard=setInterval(()=>{if(mode==='reader'&&(!state.readerRunning||session!==state.readerSession))finish();if(mode==='briefing'&&!state.speaking)finish()},200);if(mode==='reader'&&(!state.readerRunning||session!==state.readerSession))return finish();speechSynthesis.speak(u)})}
async function speakText(text,mode='briefing',session=null){for(const chunk of sentenceChunks(text)){if(mode==='reader'&&(!state.readerRunning||session!==state.readerSession))break;if(mode==='briefing'&&!state.speaking)break;while(mode==='reader'&&state.readerPaused&&state.readerRunning&&session===state.readerSession)await new Promise(r=>setTimeout(r,250));if(mode==='reader'&&(!state.readerRunning||session!==state.readerSession))break;await speakChunk(chunk,mode,session)}}
function stopAudio(){state.speaking=false;state.readerRunning=false;state.readerPaused=false;state.readerIndex=0;state.readerSession+=1;if('speechSynthesis'in window)speechSynthesis.cancel();const p=$('#pauseLoopBtn');if(p)p.textContent='Ⅱ PAUSE';updateReaderStatus()}
async function speakBriefing(){if(!('speechSynthesis'in window)||!state.briefing?.text)return;stopAudio();state.speaking=true;await speakText(state.briefing.text,'briefing');state.speaking=false}
async function startReaderLoop(){if(!('speechSynthesis'in window))return;stopAudio();const session=++state.readerSession;state.readerRunning=true;state.readerPaused=false;state.readerCycle=0;state.readerIndex=0;state.readerQueue=buildReaderQueue();if(!state.readerQueue.length){setText('readerStatus','No English originals or successful translations are available in this window.');state.readerRunning=false;return}while(state.readerRunning&&session===state.readerSession){if(!state.readerQueue.length){setText('readerStatus','No readable sources. Waiting for the next collector refresh…');await new Promise(r=>setTimeout(r,15000));state.readerQueue=buildReaderQueue();continue}for(state.readerIndex=0;state.readerIndex<state.readerQueue.length&&state.readerRunning&&session===state.readerSession;state.readerIndex++){while(state.readerPaused&&state.readerRunning&&session===state.readerSession)await new Promise(r=>setTimeout(r,250));if(!state.readerRunning||session!==state.readerSession)break;const currentReport=state.readerQueue[state.readerIndex];setText('readerNow',`${currentReport.source||'Unknown source'} • ${currentReport.translated_title||currentReport.title||''}`);updateReaderStatus();await speakText(readerText(currentReport,state.readerIndex,state.readerQueue.length),'reader',session);if(state.readerRunning&&!state.readerPaused)await new Promise(r=>setTimeout(r,700))}if(!state.readerRunning||session!==state.readerSession)break;state.readerCycle+=1;setText('readerStatus',`Completed cycle ${state.readerCycle}. Refreshing sources…`);await refresh();state.readerQueue=buildReaderQueue();state.readerIndex=0;await new Promise(r=>setTimeout(r,1200))}if(session===state.readerSession){setText('readerNow','');updateReaderStatus()}}
function toggleReaderPause(){if(!state.readerRunning)return;state.readerPaused=!state.readerPaused;const b=$('#pauseLoopBtn');if(state.readerPaused){if('speechSynthesis'in window)speechSynthesis.pause();if(b)b.textContent='▶ RESUME'}else{if('speechSynthesis'in window)speechSynthesis.resume();if(b)b.textContent='Ⅱ PAUSE'}updateReaderStatus()}
$('#briefBtn').onclick=speakBriefing;$('#sourceLoopBtn').onclick=startReaderLoop;$('#pauseLoopBtn').onclick=toggleReaderPause;$('#stopBtn').onclick=stopAudio;
$('#readerRange').onchange=e=>{state.readerRange=e.target.value==='all'?'all':Number(e.target.value);localStorage.setItem('sicReaderRange',String(e.target.value));updateReaderStatus()};
const savedReaderRange=localStorage.getItem('sicReaderRange');if(savedReaderRange){state.readerRange=savedReaderRange==='all'?'all':Number(savedReaderRange);const rs=$('#readerRange');if(rs)rs.value=savedReaderRange}
setInterval(()=>{if(state.readerRunning&&!state.readerPaused&&'speechSynthesis'in window&&speechSynthesis.paused)speechSynthesis.resume()},10000);

refresh();setInterval(refresh,30000);



