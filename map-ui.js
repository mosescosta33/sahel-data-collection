/* Interactive map for the existing Sahel Intel frontend. No collector changes required. */
(() => {
  'use strict';
  const STYLE_ROOT = 'https://tiles.openfreemap.org/styles/';
  const STYLES = new Set(['positron', 'bright', 'dark']);
  const AES = new Set(['Mali', 'Burkina Faso', 'Niger']);
  const empty = () => ({type:'FeatureCollection',features:[]});
  const byId = id => document.getElementById(id);
  const goodCoord = (lat,lng) => lat !== null && lng !== null && lat !== '' && lng !== '' && Number.isFinite(Number(lat)) && Number.isFinite(Number(lng)) && Math.abs(Number(lat)) <= 90 && Math.abs(Number(lng)) <= 180 && !(Number(lat) === 0 && Number(lng) === 0);
  let map, lastState, callbacks, currentFeatures=empty(), recordIndex=new Map(), visibleEvents=[], dates=[], layersReady=false, markerHandlers=false;
  let fallback=false, loadTimer, controlsBound=false, svgView=[0,0,1000,560];
  let showMarkers=true, showBorders=true, styleName='positron';
  const startBounds=[[-17.8,9.0],[16.4,25.0]];

  const COUNTRY_ANCHORS={
    'Mali':{lat:19.4,lng:-5.4},
    'Burkina Faso':{lat:12.0,lng:-3.5},
    'Niger':{lat:18.8,lng:9.8}
  };
  function normPlace(v){
    return String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[’']/g,"'").trim();
  }
  function cityFallback(e){
    const city=normPlace(e?.city), country=normPlace(e?.country);
    if(!city)return null;
    const cities=typeof CITY_LABELS!=='undefined'?CITY_LABELS:[];
    const exact=cities.find(c=>normPlace(c.name)===city && (!country||normPlace(c.country)===country));
    if(exact&&goodCoord(exact.lat,exact.lng)){
      return {lat:Number(exact.lat),lng:Number(exact.lng),name:exact.name,country:exact.country,precision:'city-reference'};
    }
    return null;
  }


  function status(message){const el=byId('mapLoadStatus');if(!el)return;el.hidden=!message;el.textContent=message||''}
  function activateFallback(){
    if(fallback)return;
    fallback=true;clearTimeout(loadTimer);layersReady=false;
    try{map?.remove()}catch(_){}map=null;
    const host=byId('map');if(host)host.replaceChildren();
    status('Compatibility map · drag to pan, use + / − to zoom. Street tiles unavailable.');
    const style=byId('mapStyle');if(style)style.disabled=true;
    if(lastState&&callbacks)render(lastState,callbacks);
  }
  function initialize(){
    const host=byId('map');if(!host)return;
    if(!controlsBound){
      controlsBound=true;bindSearch();bindTimeline();
      byId('mapStyle').onchange=e=>{if(!STYLES.has(e.target.value)||!map)return;styleName=e.target.value;layersReady=false;map.setStyle(STYLE_ROOT+styleName);armTimeout()};
      byId('mapMarkersLayer').onchange=e=>{showMarkers=e.target.checked;applyVisibility()};
      byId('mapBordersLayer').onchange=e=>{showBorders=e.target.checked;applyVisibility()};
    }
    if(map||fallback)return;
    if(!window.maplibregl){activateFallback();return}
    try{
      map=new maplibregl.Map({container:host,style:STYLE_ROOT+styleName,center:[0.1,16.1],zoom:4,attributionControl:true,maxZoom:16});
      map.addControl(new maplibregl.NavigationControl({showCompass:false}),'bottom-right');
      map.fitBounds(startBounds,{padding:32,duration:0});
      map.on('style.load', installLayers);
      map.on('error',e=>{console.warn('Map resource error',e.error||e);if(!layersReady)status('Loading street map… compatibility map will open if loading fails.')});
      map.on('webglcontextlost',activateFallback);
      armTimeout();
    }catch(error){console.warn('Using compatibility map',error);activateFallback()}
  }
  function armTimeout(){clearTimeout(loadTimer);loadTimer=setTimeout(()=>{if(!layersReady)activateFallback()},12000)}
  const projectFallback=(lng,lat)=>[(Number(lng)+17.8)/34.2*1000,(25-Number(lat))/16*560];
  function focusFallback(lng,lat){const [x,y]=projectFallback(lng,lat);svgView=[x-125,y-70,250,140];renderFallback()}
  function renderFallback(){
    const host=byId('map');if(!host)return;
    const make=(name,attrs={})=>{const el=document.createElementNS('http://www.w3.org/2000/svg',name);for(const [k,v] of Object.entries(attrs))el.setAttribute(k,String(v));return el};
    const svg=make('svg',{viewBox:svgView.join(' '),role:'group','aria-label':'Compatibility event map',tabindex:0});
    svg.classList.add('compatibility-map');
    const update=()=>svg.setAttribute('viewBox',svgView.join(' '));
    const zoom=f=>{const w=Math.max(80,Math.min(2000,svgView[2]*f)),h=w*.56;svgView=[svgView[0]+(svgView[2]-w)/2,svgView[1]+(svgView[3]-h)/2,w,h];update()};
    for(const country of window.SAHEL_MAP_DATA?.countries||[]){
      const g=country.geometry,polys=g.type==='Polygon'?[g.coordinates]:g.coordinates;
      const d=polys.map(poly=>poly.map(ring=>ring.map((p,i)=>`${i?'L':'M'}${projectFallback(p[0],p[1]).join(',')}`).join(' ')+' Z').join(' ')).join(' ');
      svg.append(make('path',{d,fill:AES.has(country.properties?.name)?'#dae6d6':'#eef0df',stroke:showBorders?'#83958d':'none','stroke-width':1,'vector-effect':'non-scaling-stroke'}));
    }
    const cities=typeof CITY_LABELS!=='undefined'?CITY_LABELS:[];
    for(const c of cities){const [x,y]=projectFallback(c.lng,c.lat);const label=make('text',{x:x+5,y:y-5,fill:'#304840','font-size':11});label.textContent=c.name;svg.append(label)}
    if(showMarkers)for(const f of currentFeatures.features){
      const [x,y]=projectFallback(...f.geometry.coordinates),e=recordIndex.get(f.properties.key);
      const dot=make('circle',{cx:x,cy:y,r:6,fill:callbacks.actorColor(f.properties.actor),stroke:'#fff','stroke-width':2,tabindex:0,role:'button','aria-label':`${e.city||e.country||'Location'}: ${e.title||e.event_type||'Candidate event'}`});
      dot.classList.add('compatibility-marker');
      const title=make('title');title.textContent=`${e.city||e.country||''} · ${e.event_date||''} · ${e.title||''}`;dot.append(title);
      const select=()=>{callbacks.showEventDetail(e);enhanceDetails(e)};
      dot.onclick=select;dot.onkeydown=ev=>{if(ev.key==='Enter'||ev.key===' '){ev.preventDefault();select()}};svg.append(dot);
    }
    let drag;
    svg.onpointerdown=ev=>{if(ev.target.closest('.compatibility-marker'))return;drag={x:ev.clientX,y:ev.clientY,view:[...svgView]};svg.setPointerCapture(ev.pointerId)};
    svg.onpointermove=ev=>{if(!drag)return;const rect=svg.getBoundingClientRect(),scale=Math.min(rect.width/drag.view[2],rect.height/drag.view[3]);svgView=[drag.view[0]-(ev.clientX-drag.x)/scale,drag.view[1]-(ev.clientY-drag.y)/scale,drag.view[2],drag.view[3]];update()};
    svg.onpointerup=svg.onpointercancel=()=>{drag=null};
    svg.onkeydown=ev=>{if(ev.target!==svg)return;const shifts={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]};if(shifts[ev.key]){ev.preventDefault();svgView[0]+=shifts[ev.key][0]*svgView[2]/10;svgView[1]+=shifts[ev.key][1]*svgView[3]/10;update()}else if(ev.key==='+'||ev.key==='='){zoom(.7)}else if(ev.key==='-'){zoom(1.4)}};
    const controls=document.createElement('div');controls.className='compatibility-controls';
    for(const [label,action] of [['Zoom in',()=>zoom(.7)],['Zoom out',()=>zoom(1.4)],['Reset map',()=>{svgView=[0,0,1000,560];update()}]]){const b=document.createElement('button');b.type='button';b.textContent=label==='Zoom in'?'+':label==='Zoom out'?'−':'Reset';b.setAttribute('aria-label',label);b.onclick=action;controls.append(b)}
    host.replaceChildren(svg,controls);
  }
  function installLayers(){
    if(!map||!map.isStyleLoaded()||map.getSource('sahel-events'))return;
    clearTimeout(loadTimer);layersReady=true;status('');
    const countries=(window.SAHEL_MAP_DATA?.countries||[]).filter(f=>AES.has(f.properties?.name));
    map.addSource('sahel-borders',{type:'geojson',data:{type:'FeatureCollection',features:countries}});
    map.addLayer({id:'sahel-border-lines',type:'line',source:'sahel-borders',paint:{'line-color':'#dd6758','line-width':['interpolate',['linear'],['zoom'],3,1.2,8,2.4],'line-opacity':0.78}});
    map.addSource('sahel-events',{type:'geojson',data:currentFeatures,cluster:true,clusterRadius:43,clusterMaxZoom:11});
    map.addLayer({id:'sahel-clusters',type:'circle',source:'sahel-events',filter:['has','point_count'],paint:{'circle-color':'#b85e3e','circle-radius':['step',['get','point_count'],18,8,23,30,29],'circle-stroke-color':'#ffffff','circle-stroke-width':2,'circle-opacity':0.95}});
    map.addLayer({id:'sahel-cluster-count',type:'symbol',source:'sahel-events',filter:['has','point_count'],layout:{'text-field':['get','point_count_abbreviated'],'text-size':13},paint:{'text-color':'#ffffff'}});
    map.addLayer({id:'sahel-points',type:'circle',source:'sahel-events',filter:['!', ['has','point_count']],paint:{'circle-radius':['interpolate',['linear'],['zoom'],4,7,10,11],'circle-color':['match',['get','actor'],'JNIM','#df625b','IS Sahel','#a977d8','State','#d39646','#588dbd'],'circle-stroke-color':'#ffffff','circle-stroke-width':2.2}});
    if(!markerHandlers){
      markerHandlers=true;
      map.on('click','sahel-clusters',async ev=>{
        const f=ev.features?.[0];if(!f)return;
        try{const zoom=await map.getSource('sahel-events').getClusterExpansionZoom(f.properties.cluster_id);map.easeTo({center:f.geometry.coordinates,zoom:Math.min(zoom,13),duration:420})}catch(err){console.warn(err)}
      });
      map.on('click','sahel-points',ev=>{
        const key=ev.features?.[0]?.properties?.key;const e=recordIndex.get(key);
        if(e){callbacks.showEventDetail(e);enhanceDetails(e);}
      });
      ['sahel-clusters','sahel-points'].forEach(layer=>{
        map.on('mouseenter',layer,()=>map.getCanvas().style.cursor='pointer');
        map.on('mouseleave',layer,()=>map.getCanvas().style.cursor='');
      });
    }
    applyVisibility();
  }
  function applyVisibility(){
    if(fallback){renderFallback();return}
    if(!map||!layersReady)return;
    for(const id of ['sahel-clusters','sahel-cluster-count','sahel-points'])if(map.getLayer(id))map.setLayoutProperty(id,'visibility',showMarkers?'visible':'none');
    if(map.getLayer('sahel-border-lines'))map.setLayoutProperty('sahel-border-lines','visibility',showBorders?'visible':'none');
  }
  function render(state, api){
    lastState=state;callbacks=api;initialize();
    if(!Array.isArray(state.events))return;
    visibleEvents=state.events.filter(e=>api.eventInWindow(e,state.mapDays)&&(!state.timelineDate||e.event_date===state.timelineDate)&& (state.actorFilter==='all'||e.actor===state.actorFilter));
    const features=[],missing=[];recordIndex=new Map();
    visibleEvents.forEach((e,i)=>{
      const locations=Array.isArray(e.incident_locations)&&e.incident_locations.length?e.incident_locations:Array.isArray(e.locations)&&e.locations.length?e.locations:[];
      const valid=locations.filter(l=>goodCoord(l?.lat,l?.lng)).map(l=>({...l,precision:l.precision||l.confidence||'reported-location'}));
      let points=valid.length?valid:goodCoord(e.lat,e.lng)?[{lat:e.lat,lng:e.lng,name:e.city,country:e.country,precision:'reported-coordinate'}]:[];
      if(!points.length){
        const city=cityFallback(e);
        if(city)points=[city];
      }
      if(!points.length&&COUNTRY_ANCHORS[e.country]){
        const a=COUNTRY_ANCHORS[e.country];
        points=[{lat:a.lat,lng:a.lng,name:e.country,country:e.country,precision:'country-reference'}];
      }
      if(!points.length){missing.push(e);return}
      points.forEach((l,j)=>{
        const key=`${i}-${j}`;
        const precision=l.precision||'reported-location';
        recordIndex.set(key,{...e,city:l.name||e.city,country:l.country||e.country,lat:Number(l.lat),lng:Number(l.lng),_map_precision:precision});
        features.push({type:'Feature',geometry:{type:'Point',coordinates:[Number(l.lng),Number(l.lat)]},properties:{key,actor:e.actor||'Other',precision}})
      });
    });
    currentFeatures={type:'FeatureCollection',features};
    if(layersReady&&map.getSource('sahel-events'))map.getSource('sahel-events').setData(currentFeatures);
    const count=byId('mapExplorerCount');if(count)count.textContent=`${visibleEvents.length} candidate events · ${features.length} map locations`;
    const totals=byId('mapCountryCounts');if(totals)totals.textContent=`${state.mapDays==='all'?'All available dates':state.mapDays===1?'Last 24 hours':`Last ${state.mapDays} days`} · ${visibleEvents.length} candidate events · ${features.length} map locations · ${missing.length} without precise coordinates`;
    const country=byId('mapCountryOnly');if(country){country.innerHTML=missing.length?`<h4>Location not precise (${missing.length})</h4><p>These records have no usable coordinates. They are listed here without a map pin.</p>${missing.slice(0,12).map((e,i)=>`<button type="button" data-missing="${i}">${api.esc([e.city,e.country].filter(Boolean).join(', ')||'Location unresolved')} · ${api.esc(e.event_date||'Date unresolved')}</button>`).join('')}`:'';country.querySelectorAll('[data-missing]').forEach(b=>b.onclick=()=>{const e=missing[Number(b.dataset.missing)];api.showEventDetail(e);enhanceDetails(e)})}
    if(fallback)renderFallback();
    updateTimeline(state);
  }
  function enhanceDetails(e){
    const el=byId('mapEventDetail');if(!el)return;
    el.hidden=false;
    const mode=e._map_precision||'';
    const precision=mode==='country-reference'?'Country-level reference point (exact incident location unresolved)':mode==='city-reference'?'City reference point (not an exact incident site)':mode==='reported-coordinate'?'Reported coordinate':mode==='reported-location'||mode==='explicit-place'?'Reported place coordinate':goodCoord(e.lat,e.lng)?(e.city?'Town-level point (not an exact site)':'Approximate reported position'):'Location precision unresolved';
    const annotation=document.createElement('div');annotation.className='map-precision';annotation.textContent=`Map precision: ${precision} · Open-source candidate, not independently verified`;
    el.append(annotation);
    const urls=Array.isArray(e.report_urls)?e.report_urls:[];
    if(urls.length){const box=document.createElement('div');box.className='map-source-links';urls.slice(0,6).forEach((url,i)=>{try{const u=new URL(url);if(!['http:','https:'].includes(u.protocol))return;const a=document.createElement('a');a.href=u.href;a.target='_blank';a.rel='noopener noreferrer';a.textContent=`Source ${i+1}: ${u.hostname} ↗`;box.append(a)}catch(_){}});el.append(box)}
    el.scrollIntoView({behavior:'smooth',block:'nearest'});
  }
  function updateTimeline(state){
    dates=[...new Set((state.events||[]).map(e=>e.event_date).filter(x=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(x)))].sort().slice(-21);
    const slider=byId('mapTimeline'),label=byId('mapTimelineLabel'),clear=byId('mapTimelineClear');if(!slider||!label||!clear)return;
    slider.disabled=dates.length===0;slider.max=String(Math.max(0,dates.length-1));slider.value=String(Math.max(0,dates.indexOf(state.timelineDate)));
    label.textContent=state.timelineDate?`Reported event date: ${state.timelineDate}`:'Select a reported event date';clear.hidden=!state.timelineDate;
  }
  function bindTimeline(){
    const slider=byId('mapTimeline'),clear=byId('mapTimelineClear');
    slider.oninput=()=>{if(!lastState||!dates.length)return;lastState.timelineDate=dates[Number(slider.value)];lastState.mapDays='all';document.querySelectorAll('.map-range').forEach(b=>b.classList.toggle('active',b.dataset.days==='all'));render(lastState,callbacks)};
    clear.onclick=()=>{if(!lastState)return;lastState.timelineDate=null;render(lastState,callbacks)};
  }
  function bindSearch(){
    const input=byId('mapPlaceSearch'),results=byId('mapSearchResults');if(!input||!results)return;
    const cities=typeof CITY_LABELS!=='undefined'?CITY_LABELS:[];
    const search=()=>{
      const term=input.value.trim().toLocaleLowerCase();results.replaceChildren();
      if(term.length<2){results.hidden=true;return}
      const matches=cities.filter(c=>c.name.toLocaleLowerCase().includes(term)).slice(0,7);
      results.hidden=matches.length===0;
      for(const c of matches){const b=document.createElement('button');b.type='button';b.textContent=c.name;b.onclick=()=>{input.value=c.name;results.hidden=true;fallback?focusFallback(c.lng,c.lat):map?.flyTo({center:[Number(c.lng),Number(c.lat)],zoom:9,essential:true})};results.append(b)}
    };
    input.addEventListener('input',search);input.addEventListener('keydown',ev=>{if(ev.key==='Escape')results.hidden=true;if(ev.key==='Enter'){const b=results.querySelector('button');if(b)b.click()}});
    document.addEventListener('click',ev=>{if(!ev.target.closest('.map-search'))results.hidden=true});
  }
  function resize(){if(map)map.resize()}
  window.SAHEL_MAP_UI={render,resize};
})();

