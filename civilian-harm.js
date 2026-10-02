(()=>{
  'use strict';

  const q=s=>document.querySelector(s);
  const qa=s=>[...document.querySelectorAll(s)];
  const esc=s=>String(s??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  const safeUrl=v=>{try{const u=new URL(v,location.href);return ['http:','https:'].includes(u.protocol)?u.href:''}catch(_){return ''}};
  const countryCode={'Mali':'MLI','Burkina Faso':'BFA','Niger':'NER'};

  const rules=[
    {code:'HR-KILL',label:'Civilian killing / execution',re:/\b(kill(?:ed|ing|s)?|dead|deaths?|massacr(?:e|ed)|execut(?:ed|ion)|slain|fatalit(?:y|ies)|morts?|tu[ée]s?|massacre)\b/i},
    {code:'HR-INJ',label:'Civilian injury',re:/\b(injur(?:ed|ies|y)|wound(?:ed|s)?|bless[ée]s?)\b/i},
    {code:'HR-DET',label:'Detention / arrest concern',re:/\b(arbitrary detention|detain(?:ed|ment)|arrest(?:ed|s)?|custody|d[ée]tenu(?:e|es|s)?)\b/i},
    {code:'HR-DIS',label:'Disappearance / missing',re:/\b(enforced disappearance|disappear(?:ed|ance|ances)|missing|port[ée]s?\s+disparu(?:e|es|s)?)\b/i},
    {code:'HR-TORT',label:'Torture / mistreatment',re:/\b(tortur(?:e|ed|ing)|ill-treatment|mistreat(?:ed|ment)|beaten in custody|mauvais traitements)\b/i},
    {code:'HR-SV',label:'Sexual violence',re:/\b(rape(?:d|s)?|sexual violence|sexual assault|violences? sexuelles?|viol)\b/i},
    {code:'HR-DISP',label:'Forced displacement',re:/\b(forced displacement|forcibly displaced|displaced civilians?|fled their homes?|forced from their homes?|expelled from|d[ée]plac[ée]s?)\b/i},
    {code:'HR-PROP',label:'Property destruction',re:/\b(homes? (?:were )?(?:burned|burnt|destroyed)|houses? (?:were )?(?:burned|burnt|destroyed)|village(?:s)? (?:was|were)? ?(?:burned|burnt|torched|destroyed)|arson)\b/i},
    {code:'HR-LOOT',label:'Looting / property seizure',re:/\b(loot(?:ed|ing)|pillag(?:e|ed|ing)|property seizure|seized livestock|stolen livestock)\b/i},
    {code:'HR-KIDNAP',label:'Kidnapping / hostage taking',re:/\b(kidnap(?:ped|ping)|abduct(?:ed|ion|ions)|hostage(?:s)?|enl[èe]vement)\b/i},
    {code:'HR-MED',label:'Medical personnel / facility harm',re:/\b((?:attack|strike|shell|raid|burn|destroy|kill|abduct)\w*\s+(?:a\s+)?(?:hospital|clinic|health centre|health center)|(?:hospital|clinic|medical personnel|health workers?)\b.{0,50}\b(?:attack|strike|shell|raid|burn|destroy|kill|abduct)\w*)\b/i,self:true},
    {code:'HR-REL',label:'Religious site / personnel harm',re:/\b((?:attack|strike|shell|raid|burn|destroy|kill|abduct)\w*\s+(?:a\s+)?(?:mosque|church|imam|cleric|religious site)|(?:mosque|church|imam|cleric|religious site)\b.{0,50}\b(?:attack|strike|shell|raid|burn|destroy|kill|abduct)\w*)\b/i,self:true},
    {code:'HR-AID',label:'Humanitarian access / aid worker harm',re:/\b((?:aid workers?|humanitarian workers?)\b.{0,60}\b(?:kill|attack|abduct|detain|injur)\w*|(?:block|deny|obstruct)\w*.{0,40}\bhumanitarian (?:aid|access))\b/i,self:true},
    {code:'HR-INDIS',label:'Indiscriminate attack indicator',re:/\b(indiscriminate|indiscriminately|shelling|bombardment|airstrike|air strike|drone strike)\b/i}
  ];

  const civilianContext=/\b(civilian(?:s)?|villager(?:s)?|resident(?:s)?|farmer(?:s)?|pastoralist(?:s)?|women|children|child|famil(?:y|ies)|non[- ]combatant(?:s)?|civilian population|population civile|civils?|villageois|habitants)\b/i;
  const disputeContext=/\b(den(?:y|ied|ies)|disput(?:e|ed|es)|reject(?:ed|s)? the allegation|contested|counterclaim|said the victims were|described the dead as militants)\b/i;

  const ui={country:'all',category:'all',days:30};
  let reports=[];
  let events=[];
  let cases=[];

  function hashKey(v){
    let h=2166136261;
    const s=String(v||'');
    for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619)}
    return (h>>>0).toString(36).toUpperCase().padStart(6,'0');
  }
  function reportKey(r){return String(r?.id||r?.url||[r?.source,r?.title,r?.published_at,r?.discovered_at].filter(Boolean).join('|'))}
  function dateInDays(v,days){
    if(!v)return false;
    const d=new Date(String(v).slice(0,10)+'T23:59:59Z');
    if(isNaN(d))return false;
    const age=Date.now()-d.getTime();
    return age>=0&&age<=days*86400000;
  }
  function eventIndex(){
    const map=new Map();
    for(const e of events){
      const urls=Array.isArray(e?.report_urls)?e.report_urls:[];
      for(const url of urls){
        if(!url)continue;
        const prior=map.get(url);
        if(!prior||(prior.report_urls||[]).length<urls.length)map.set(url,e);
      }
    }
    return map;
  }
  function actorLabel(r,e){
    // Actor buckets describe association/activity, not necessarily perpetration.
    // Only an explicit perpetrator field is strong enough for the civilian-harm attribution panel.
    return String(r?.perpetrator||e?.perpetrator||'Attribution unresolved');
  }
  function locationLabel(r,e){
    const city=r?.city||e?.city;
    const country=r?.country||e?.country;
    return [city,country].filter(Boolean).join(', ')||'Location unresolved';
  }
  function caseFromReport(r,idx){
    const e=idx.get(r?.url)||null;
    const claims=Array.isArray(r?.casualty_claims)?r.casualty_claims:[];
    const explicitCivilianClaim=claims.some(c=>civilianContext.test(String(c?.victim_text||'')));
    const analyticalContainer=Boolean(r?.analytical_container||r?.retention_class==='analytical_context');
    // Long analytical products routinely mention civilians, killings, looting, armed groups,
    // and state forces in the same document. Do not turn that co-occurrence into a fabricated
    // incident card. An analytical product must have incident-level structured evidence first.
    if(analyticalContainer&&!e&&!r?.civilian_targeting_flag&&!explicitCivilianClaim)return null;
    const text=[r?.translated_title,r?.title,r?.article_summary,r?.translated_excerpt,r?.excerpt,r?.target,r?.event_type,e?.summary].filter(Boolean).join(' ');
    const hasCivilian=Boolean(r?.civilian_targeting_flag)||explicitCivilianClaim||(Array.isArray(r?.victim_categories)&&r.victim_categories.includes('civilian'))||civilianContext.test(text)||civilianContext.test(String(r?.target||''));
    const categories=rules.filter(rule=>rule.re.test(text)&&(hasCivilian||rule.self)).map(rule=>({code:rule.code,label:rule.label}));
    if(hasCivilian&&(Number.isFinite(Number(r?.fatalities_min))||Number.isFinite(Number(r?.fatalities_max)))&&!categories.some(x=>x.code==='HR-KILL'))categories.unshift({code:'HR-KILL',label:'Civilian killing / execution'});
    if(!categories.length)return null;

    const sourceCount=Math.max(1,Array.isArray(e?.report_urls)?e.report_urls.length:1);
    const eventDate=r?.event_date||e?.event_date||'';
    const country=r?.country||e?.country||'Regional';
    const actor=actorLabel(r,e);
    const location=locationLabel(r,e);
    const rawSummary=r?.article_summary||r?.translated_excerpt||r?.excerpt||'No retained article summary available.';
    const summary=String(rawSummary).replace(/\{\{[^{}]{1,120}\}\}/g,' ').replace(/\s+/g,' ').trim();
    const hasAttribution=Boolean(r?.perpetrator||e?.perpetrator);
    const hasPrecise=Boolean(r?.city||e?.city||(Array.isArray(e?.incident_locations)&&e.incident_locations.length));
    const review=[];
    if(sourceCount<2)review.push('single-source reporting');
    if(!eventDate)review.push('incident date unresolved');
    if(!hasAttribution)review.push('perpetrator attribution unresolved');
    if(!hasPrecise)review.push('precise locality unresolved');
    const disputed=disputeContext.test(text);
    if(disputed)review.push('reporting contains dispute/denial language');

    const code=countryCode[country]||'SAH';
    const id='CH-'+code+'-'+hashKey(reportKey(r)).slice(0,7);
    return {
      id,
      report:r,
      linked_event:e,
      title:r?.translated_title||r?.title||'Untitled retained report',
      summary,
      country,
      location,
      actor,
      event_date:eventDate,
      published_at:r?.published_at||'',
      collected_at:r?.collected_at||r?.discovered_at||'',
      source:r?.source||'Unknown source',
      url:r?.url||'',
      source_count:sourceCount,
      categories,
      disputed,
      review,
      evidence_status:sourceCount>=3?'Multiple-source case linkage':sourceCount===2?'Two-source case linkage':'Single-source report',
      attribution_basis:hasAttribution?'Named alleged perpetrator in structured extraction':'Perpetrator unresolved',
      location_precision:hasPrecise?'Named/structured locality available':country!=='Regional'?'Country-level only':'Unresolved',
      fatalities_min:r?.fatalities_min??e?.fatalities_min??null,
      fatalities_max:r?.fatalities_max??e?.fatalities_max??null,
      fatalities_best:r?.fatalities_best??e?.fatalities_best??null,
      injured_min:r?.injured_min??e?.injured_min??null,
      injured_max:r?.injured_max??e?.injured_max??null,
      abducted_min:r?.abducted_min??e?.abducted_min??null,
      abducted_max:r?.abducted_max??e?.abducted_max??null,
      casualty_disputed:Boolean(r?.casualty_disputed||e?.casualty_disputed),
      victim_categories:Array.isArray(r?.victim_categories)?r.victim_categories:(Array.isArray(e?.victim_categories)?e.victim_categories:[]),
      casualty_claims:Array.isArray(r?.casualty_claims)?r.casualty_claims:(Array.isArray(e?.casualty_claims)?e.casualty_claims:[])
    };
  }
  function buildCases(){
    const idx=eventIndex();
    const seen=new Set();
    const out=[];
    for(const r of reports){
      const item=caseFromReport(r,idx);
      if(!item)continue;
      const key=reportKey(r);
      if(seen.has(key))continue;
      seen.add(key);out.push(item);
    }
    out.sort((a,b)=>String(b.event_date||b.published_at||b.collected_at).localeCompare(String(a.event_date||a.published_at||a.collected_at)));
    cases=out;
  }
  function filteredCases(){
    return cases.filter(c=>(ui.country==='all'||c.country===ui.country)&&(ui.category==='all'||c.categories.some(x=>x.code===ui.category)));
  }
  function setText(id,v){const el=document.getElementById(id);if(el)el.textContent=v}
  function fullTimestamp(v){if(!v)return 'UNAVAILABLE';const d=new Date(v);if(isNaN(d))return 'UNAVAILABLE';return new Intl.DateTimeFormat('en-US',{timeZone:'UTC',year:'numeric',month:'short',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false,timeZoneName:'short'}).format(d)}
  function shortDate(v){
    if(!v)return '—';
    const d=new Date(String(v).slice(0,10)+'T00:00:00Z');
    if(isNaN(d))return String(v);
    return d.toLocaleDateString(undefined,{month:'short',day:'numeric',timeZone:'UTC'});
  }
  function trendRows(){
    const rows=[];
    const today=new Date();today.setUTCHours(0,0,0,0);
    for(let back=ui.days-1;back>=0;back--){
      const d=new Date(today.getTime()-back*86400000);
      const iso=d.toISOString().slice(0,10);
      rows.push({date:iso,screened:0,multi:0,review:0});
    }
    const idx=new Map(rows.map((r,i)=>[r.date,i]));
    for(const c of filteredCases()){
      const date=String(c.event_date||'').slice(0,10);
      if(!idx.has(date))continue;
      const row=rows[idx.get(date)];
      row.screened+=1;
      if(c.source_count>=2)row.multi+=1;
      if(c.review.length)row.review+=1;
    }
    return rows;
  }
  function trendChartSVG(rows){
    const width=900,height=260,left=48,right=14,top=18,bottom=34;
    const maxRaw=Math.max(0,...rows.flatMap(r=>[r.screened,r.multi,r.review]));
    const step=Math.max(1,Math.ceil(maxRaw/4)),yMax=Math.max(4,step*4);
    const sx=i=>left+(i/Math.max(1,rows.length-1))*(width-left-right);
    const sy=v=>top+(1-(Number(v)||0)/yMax)*(height-top-bottom);
    let out='';
    for(let i=0;i<=4;i++){
      const value=yMax-i*step,y=top+i*(height-top-bottom)/4;
      out+='<line x1="'+left+'" y1="'+y+'" x2="'+(width-right)+'" y2="'+y+'" stroke="var(--chart-grid)" stroke-width="1"/>';
      out+='<text x="'+(left-7)+'" y="'+(y+3)+'" text-anchor="end" fill="var(--chart-axis)" font-size="10">'+value+'</text>';
    }
    const tickIdx=[0,Math.round((rows.length-1)*.25),Math.round((rows.length-1)*.5),Math.round((rows.length-1)*.75),rows.length-1].filter((v,i,a)=>a.indexOf(v)===i);
    for(const i of tickIdx){
      out+='<text x="'+sx(i)+'" y="'+(height-10)+'" text-anchor="middle" fill="var(--chart-axis)" font-size="10">'+esc(shortDate(rows[i]?.date))+'</text>';
    }
    out+='<text x="12" y="'+(height/2)+'" transform="rotate(-90 12 '+(height/2)+')" text-anchor="middle" fill="var(--chart-axis)" font-size="9">REPORT COUNT</text>';
    out+='<text x="'+(width/2)+'" y="'+(height-1)+'" text-anchor="middle" fill="var(--chart-axis)" font-size="9">INCIDENT DATE</text>';
    const series=[['screened','Screened reports','var(--cyan)'],['multi','Multi-source linked','var(--green)'],['review','Needs review','var(--amber)']];
    for(const [key,label,color] of series){
      const pts=rows.map((r,i)=>sx(i)+','+sy(r[key])).join(' ');
      out+='<polyline fill="none" stroke="'+color+'" stroke-width="2.4" points="'+pts+'" vector-effect="non-scaling-stroke"/>';
      rows.forEach((r,i)=>{
        const v=r[key];if(!v)return;
        out+='<circle cx="'+sx(i)+'" cy="'+sy(v)+'" r="3" fill="'+color+'"><title>'+esc(label)+' • '+esc(r.date)+' • '+v+'</title></circle>';
        if(rows.length<=31)out+='<text x="'+sx(i)+'" y="'+Math.max(10,sy(v)-7)+'" text-anchor="middle" fill="var(--chart-axis)" font-size="9">'+v+'</text>';
      });
    }
    return '<svg viewBox="0 0 '+width+' '+height+'" preserveAspectRatio="none" role="img" aria-label="Civilian harm screening trend by incident date">'+out+'</svg>'+
      '<div class="chartlegend"><span><i class="dot" style="background:var(--cyan)"></i>Screened reports</span><span><i class="dot" style="background:var(--green)"></i>Multi-source linked</span><span><i class="dot" style="background:var(--amber)"></i>Needs review</span></div>';
  }
  function renderTrend(){
    const rows=trendRows();
    const chart=q('#civilianTrendChart');if(chart)chart.innerHTML=trendChartSVG(rows);
    const total=rows.reduce((n,r)=>n+r.screened,0),multi=rows.reduce((n,r)=>n+r.multi,0),review=rows.reduce((n,r)=>n+r.review,0);
    const first=rows[0]?.date,last=rows.at(-1)?.date;
    setText('civilianTrendReadout',shortDate(first)+' → '+shortDate(last)+' • screened '+total+' • multi-source '+multi+' • needs review '+review+' • peak/day '+Math.max(0,...rows.map(r=>r.screened)));
    const data=q('#civilianTrendData');
    if(data)data.innerHTML='<table class="numeric-data-table"><thead><tr><th>Date</th><th>Screened reports</th><th>Multi-source linked</th><th>Needs review</th></tr></thead><tbody>'+rows.map(r=>'<tr><td>'+esc(r.date)+'</td><td>'+r.screened+'</td><td>'+r.multi+'</td><td>'+r.review+'</td></tr>').join('')+'</tbody></table>';
    qa('.civilian-range').forEach(b=>b.classList.toggle('active',Number(b.dataset.civilianDays)===ui.days));
  }
  function barRows(items){
    const max=Math.max(1,...items.map(x=>x[1]));
    const total=Math.max(1,items.reduce((n,x)=>n+(Number(x[1])||0),0));
    return items.map(([label,n])=>'<div class="civilian-breakdown-row"><span>'+esc(label)+'</span><div class="civilian-breakdown-track" title="'+esc(label)+': '+esc(n)+'"><div class="civilian-breakdown-fill" style="width:'+Math.max(4,Math.round(n/max*100))+'%"></div></div><strong>'+esc(n)+' · '+Math.round((Number(n)||0)*100/total)+'%</strong></div>').join('');
  }
  function countBy(values){
    const m=new Map();
    for(const v of values){const k=String(v||'Unknown');m.set(k,(m.get(k)||0)+1)}
    return [...m.entries()].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0]));
  }
  function renderBreakdowns(){
    const country=q('#civilianCountryBreakdown');
    if(country)country.innerHTML=barRows(countBy(cases.map(c=>c.country)).slice(0,8))||'<div class="civilian-empty">No screened records.</div>';
    const actor=q('#civilianActorBreakdown');
    if(actor)actor.innerHTML=barRows(countBy(cases.map(c=>c.actor)).slice(0,8))||'<div class="civilian-empty">No attribution data.</div>';
    const cats=[];
    for(const c of cases)for(const cat of c.categories)cats.push(cat.label);
    const category=q('#civilianCategoryBreakdown');
    if(category)category.innerHTML=barRows(countBy(cats).slice(0,10))||'<div class="civilian-empty">No harm indicators.</div>';
  }
  function casualtyValue(min,max,best){
    if(best!==null&&best!==undefined)return String(best);
    if(min!==null&&min!==undefined&&max!==null&&max!==undefined)return Number(min)===Number(max)?String(min):String(min)+'–'+String(max);
    if(min!==null&&min!==undefined)return String(min);
    if(max!==null&&max!==undefined)return String(max);
    return '—';
  }
  function caseCard(c){
    const source=safeUrl(c.url);
    const chips=c.categories.map(x=>'<span class="civilian-pill">'+esc(x.code)+' · '+esc(x.label)+'</span>').join('');
    const review=c.review.length?c.review.join(' • '):'No automatic review flags.';
    const allegation=c.actor==='Attribution unresolved'?'No perpetrator attribution is resolved in the retained structured fields.':'The retained structured extraction names '+c.actor+' as the alleged perpetrator. Review the source before treating the attribution as established.';
    const dispute=c.disputed?'The retained text contains denial, dispute, or competing-characterization language. Review the underlying source before drawing conclusions.':'No explicit denial/dispute language was detected in the retained summary/title. Absence of a detected dispute is not proof of agreement.';
    const placeMeta=c.location&&c.location!==c.country?c.country+' • '+c.location:c.country;
    return '<article class="civilian-case '+(c.source_count>=2?'corroborated':'review')+'">'+
      '<div class="civilian-case-head"><div><span class="civilian-case-id">'+esc(c.id)+'</span><h3>'+esc(c.title)+'</h3></div><span class="methodpill">'+esc(c.evidence_status)+'</span></div>'+
      '<div class="civilian-case-meta">'+esc(placeMeta)+' • Event date: '+esc(c.event_date||'unresolved')+' • Source: '+esc(c.source)+' • Linked sources: '+esc(c.source_count)+'</div>'+ 
      '<div class="civilian-case-meta"><strong>PUBLISHED:</strong> '+esc(fullTimestamp(c.published_at))+' • <strong>COLLECTED BY SAHEL INTEL:</strong> '+esc(fullTimestamp(c.collected_at))+'</div>'+
      '<div class="civilian-case-meta"><strong>Fatalities:</strong> '+esc(casualtyValue(c.fatalities_min,c.fatalities_max,c.fatalities_best))+' • <strong>Injured:</strong> '+esc(casualtyValue(c.injured_min,c.injured_max,null))+' • <strong>Abducted:</strong> '+esc(casualtyValue(c.abducted_min,c.abducted_max,null))+(c.casualty_disputed?' • <strong>CONFLICTING TOLLS</strong>':'')+(c.victim_categories.length?' • Groups mentioned: '+esc(c.victim_categories.join(', ')):'')+'</div>'+
      '<div class="civilian-indicators">'+chips+'</div>'+
      '<div class="civilian-evidence-grid">'+
        '<div class="civilian-evidence"><small>REPORTED INFORMATION</small><p>'+esc(c.summary)+'</p></div>'+
        '<div class="civilian-evidence"><small>ALLEGED ATTRIBUTION</small><p>'+esc(allegation)+'</p></div>'+
        '<div class="civilian-evidence"><small>CORROBORATION / DISPUTE</small><p>'+esc(dispute)+' Evidence status: '+esc(c.evidence_status)+'.</p></div>'+
        '<div class="civilian-evidence"><small>UNKNOWN / NEEDS REVIEW</small><p>'+esc(review)+' • Location precision: '+esc(c.location_precision)+'.</p></div>'+
      '</div>'+
      '<div class="civilian-case-actions">'+(source?'<a href="'+esc(source)+'" target="_blank" rel="noopener">OPEN SOURCE ↗</a>':'')+'<span class="civilian-review-reasons">'+esc(c.attribution_basis)+'</span></div>'+
    '</article>';
  }
  function render(){
    setText('civilianTotal',cases.length);
    setText('civilian30',cases.filter(c=>dateInDays(c.event_date,30)).length);
    setText('civilianMulti',cases.filter(c=>c.source_count>=2).length);
    setText('civilianReview',cases.filter(c=>c.review.length).length);
    renderBreakdowns();
    renderTrend();
    const rows=filteredCases();
    setText('civilianCaseCount',rows.length+' case'+(rows.length===1?'':'s'));
    const host=q('#civilianCases');
    if(host)host.innerHTML=rows.length?rows.map(caseCard).join(''):'<div class="civilian-empty">No retained reports match this civilian-harm screening view.</div>';
    qa('.civilian-country-filter').forEach(b=>b.classList.toggle('active',b.dataset.civilianCountry===ui.country));
  }
  function exportRows(format){
    const rows=filteredCases();
    if(!rows.length)return;
    const stamp=new Date().toISOString().slice(0,10);
    if(format==='json'){
      const payload={exported_at:new Date().toISOString(),method:'keyword-assisted civilian-harm screening of retained reports; not a legal determination',record_count:rows.length,records:rows};
      download(JSON.stringify(payload,null,2),'sahel-intel-civilian-harm-'+stamp+'.json','application/json;charset=utf-8');
      return;
    }
    const fields=['case_id','country','location','event_date','published_at','collected_at','source','source_count','evidence_status','alleged_actor','categories','victim_categories','fatalities_min','fatalities_max','fatalities_best','injured_min','injured_max','abducted_min','abducted_max','casualty_disputed','review_flags','summary','url'];
    const csv=[fields.join(',')];
    for(const c of rows){
      const vals=[c.id,c.country,c.location,c.event_date,c.published_at,c.collected_at,c.source,c.source_count,c.evidence_status,c.actor,c.categories.map(x=>x.code).join('|'),c.victim_categories.join('|'),c.fatalities_min,c.fatalities_max,c.fatalities_best,c.injured_min,c.injured_max,c.abducted_min,c.abducted_max,c.casualty_disputed,c.review.join('|'),c.summary,c.url];
      csv.push(vals.map(csvCell).join(','));
    }
    download(csv.join('\n'),'sahel-intel-civilian-harm-'+stamp+'.csv','text/csv;charset=utf-8');
  }
  function csvCell(v){const s=String(v??'');return '"'+s.replace(/"/g,'""')+'"'}
  function download(contents,name,type){
    const blob=new Blob([contents],{type});
    const url=URL.createObjectURL(blob);
    const a=document.createElement('a');
    a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  function bind(){
    qa('.civilian-country-filter').forEach(b=>b.onclick=()=>{ui.country=b.dataset.civilianCountry||'all';render()});
    qa('.civilian-range').forEach(b=>b.onclick=()=>{ui.days=Math.max(1,Number(b.dataset.civilianDays)||30);render()});
    const category=q('#civilianCategory');if(category)category.onchange=()=>{ui.category=category.value||'all';render()};
    const json=q('#downloadCivilianJson');if(json)json.onclick=()=>exportRows('json');
    const csv=q('#downloadCivilianCsv');if(csv)csv.onclick=()=>exportRows('csv');
  }
  async function load(){
    try{
      const stamp=Date.now();
      const [rr,ee]=await Promise.all([
        fetch('./data/reports.json?ts='+stamp,{cache:'no-store'}),
        fetch('./data/events.json?ts='+stamp,{cache:'no-store'})
      ]);
      if(!rr.ok)throw new Error('reports '+rr.status);
      reports=await rr.json();
      events=ee.ok?await ee.json():[];
      if(!Array.isArray(reports))reports=[];
      if(!Array.isArray(events))events=[];
      buildCases();
      render();
    }catch(err){
      console.error('Civilian Harm Monitor data error',err);
      const host=q('#civilianCases');
      if(host)host.innerHTML='<div class="civilian-empty">Civilian Harm Monitor could not load retained-report data: '+esc(err.message)+'</div>';
    }
  }

  bind();
  load();
  setInterval(load,60000);
})();
