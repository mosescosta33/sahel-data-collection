(() => {
  'use strict';
  const host = document.getElementById('researchLab');
  if (!host) return;
  const escape = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const number = value => value === null || value === undefined || !Number.isFinite(Number(value)) ? '—' : Number(value)!==0&&Math.abs(Number(value))<0.0001 ? Number(value).toExponential(3) : Number(value).toLocaleString('en-US',{maximumFractionDigits:4});
  const methods = {
    descriptive:['Descriptive','Descriptive statistics','Counts, mean, median, variance, standard deviation, zero share, and civilian events per 100 selected events.','No sampling or causal claim. Missing fatalities remain unknown.'],
    correlation:['Descriptive','Correlation','Pearson r and Spearman rho between the chosen outcome and lagged predictors.','Pooled observations are dependent; naive p-values are labeled accordingly.'],
    ols:['Regression','OLS regression','Yᵢₜ = βXᵢₜ + fixed effects + εᵢₜ','Use a continuous outcome, inspect heteroskedasticity, and avoid interpreting count OLS as a rate ratio.'],
    logistic:['Regression','Civilian-targeting logit','logit P(civilian targeting = 1) = β₀ + β₁Russian participation + β₂Jihadist participation + country effects','Event-level model. exp(β) is an odds ratio. Separation prevents valid estimation.'],
    poisson:['Regression','Poisson count model','log E(Yᵢₜ) = βXᵢ,ₜ₋₁ + fixed effects + optional log(population)','Poisson conditional variance equals its mean. Inspect dispersion and dependence.'],
    negative_binomial:['Regression','Negative binomial (NB2)','log E(Yᵢₜ) = βXᵢ,ₜ₋₁ + fixed effects; Var(Y|X) = μ + αμ²','α is estimated. exp(β) is an incidence-rate ratio; it describes a conditional association.'],
    zero_inflated:['Regression','Zero-inflated negative binomial','P(Y=0) = π + (1−π)P_NB(Y=0); E(Y) = (1−π)μ','Constant-only structural-zero model. Its process needs substantive justification.'],
    hurdle:['Regression','Poisson hurdle','A zero/nonzero process plus a zero-truncated positive-count process.','Component-specific coefficients; implemented estimator reports model-based, not clustered, standard errors.'],
    fixed_effects:['Regression','Unit + month fixed effects','Yᵢₜ = βXᵢ,ₜ₋₁ + αᵢ + λₜ + εᵢₜ','OLS with unit and calendar-month effects; short nonlinear panels raise separate incidental-parameter issues.'],
    did:['Causal','Difference-in-differences','Yᵢₜ = β(Treatedᵢ × Postₜ) + αᵢ + λₜ + εᵢₜ','One common adoption date. Requires parallel untreated trends, no anticipation, no differential shocks and no interference.'],
    event_study:['Causal','Intervention event study','Yᵢₜ = Σₖ≠−1 βₖ(Treatedᵢ × 1[event time=k]) + αᵢ + λₜ + εᵢₜ','Reference month −1; endpoint bins pool tails. A failed lead test does not establish parallel trends.'],
    matching:['Causal','Propensity matching + DiD','Pre-treatment score → 1:1 matching without replacement → 0.2-SD logit caliper → matched DiD.','Balance and common support must be assessed. Matching cannot remove unmeasured confounding.'],
    weighting:['Causal','ATT weighting + DiD','Weight treated units 1; controls p/(1−p); trim scores to [0.05,0.95].','Scores use pre-treatment means only. Report SMDs, effective N and conditional uncertainty.'],
    spatial:['Spatial','Clustering, hotspots and KDE','Moran I; symmetric k-nearest-neighbor weights; Gi* normal z; BH q-values; spherical distances.','Analysis is conditional on occupied degree-grid cells. KDE is observed concentration, not population-adjusted risk.'],
    diffusion:['Spatial','Border distance + diffusion','Count border events preceded by a cross-border jihadist event within the chosen radius and lookback.','Requires your country-boundary GeoJSON. Spatial/temporal co-occurrence does not establish diffusion causally.'],
    network:['Networks','Actor interaction network','Degree; inverse-count weighted betweenness; density; components; HHI = Σ actor interaction-share².','Actor1/Actor2 interactions do not by themselves identify alliances, hostility or influence.'],
    survival:['Causal','Event history / Cox','h(t|X) = h₀,country(t) exp(βX); recurrent gap spells, censored at coverage end.','Covariates fixed at spell start. Assumes proportional hazards; same-day events are collapsed.'],
    forecast:['Forecast','One-month-ahead forecasting','Lagged features → expanding-window validation → Poisson ridge / random forest; event probability via logit.','No random split. Compare persistence baseline. Error bands are empirical and do not guarantee nominal coverage.'],
    bayesian:['Regression','Bayesian hierarchical Poisson','log μᵢₜ = βXᵢₜ + u_country + v_unit; Gaussian priors; Laplace posterior around MAP.','Standardized predictors and specified prior scales. Approximate credible intervals; full MCMC replication provided in R.'],
    robustness:['Diagnostics','Robustness and diagnostics','Compare Poisson/NB2 and country/unit/time fixed effects; retain failed specifications.','Never choose a model by statistical significance. Check missingness, coverage, convergence and reporting bias.']
  };
  const lab = {events:null,covariates:null,roster:null,boundaries:null,worker:null,busy:false,id:0,result:null,panel:[],panelCsv:'',history:[],public:null};
  const query = id => host.querySelector('#' + id);
  const options = Object.entries(methods).map(([key,m])=>`<option value="${key}">${escape(m[1])}</option>`).join('');
  host.innerHTML = `
    <div class="ql-heading"><div><span class="eyebrow">REPRODUCIBLE CONFLICT RESEARCH</span><h2>ACLED Research Lab</h2><p>Build a subnational panel, estimate models, examine assumptions, and download the research record.</p></div><span id="qlSource" class="ql-source">ACLED · awaiting data</span></div>
    <div class="ql-layout"><aside class="ql-setup">
      <h3>Research dataset</h3>
      <label class="ql-field">Import ACLED export<input id="qlFile" type="file" accept=".csv,.json,.tsv" /></label><p class="ql-hint">CSV or JSON. Raw records stay in this browser's memory. Closing or reloading clears the import.</p>
      <fieldset><legend>Countries</legend>${['Mali','Burkina Faso','Niger'].map(c=>`<label class="ql-check"><input type="checkbox" name="qlCountry" value="${c}" checked>${c}</label>`).join('')}</fieldset>
      <div class="ql-date-pair"><label class="ql-field">Coverage starts<input id="qlStart" type="date"></label><label class="ql-field">Coverage ends<input id="qlEnd" type="date"></label></div>
      <label class="ql-check"><input id="qlCoverage" type="checkbox">I confirm this export covers all selected countries and dates within my access tier, including months with zero recorded events.</label>
      <label class="ql-field">Actor contains<input id="qlActor" type="text" placeholder="All actors" maxlength="150"></label>
      <label class="ql-field">Outcome event filter<select id="qlEvents" multiple aria-label="Outcome event types"><option>Battles</option><option>Explosions/Remote violence</option><option>Violence against civilians</option><option>Strategic developments</option><option>Protests</option><option>Riots</option></select></label><p class="ql-hint">No selection means all types. Actor/event filters apply to the outcome; covariates use all events in the covered context.</p>
      <label class="ql-field">Unit of analysis<select id="qlUnit"><option value="admin1_month">Admin1 × month</option><option value="country_month">Country × month</option><option value="grid_month">0.5-degree grid × month</option></select></label>
      <label class="ql-field">Outcome<select id="qlOutcome"><option value="civilian_events">Civilian-targeting event count</option><option value="violent_events">Violent event count</option><option value="total_events">Total selected event count</option><option value="fatalities">Reported fatalities</option><option value="civilian_rate">Civilian targeting per 100 events</option></select></label>
      <label class="ql-field">Method<select id="qlMethod">${options}</select></label>
      <details><summary>Model specification</summary>
        <label class="ql-field">Predictors, comma-separated<textarea id="qlPredictors">russian_events_lag1, jihadist_events_lag1, armed_actor_count_lag1, log1p_fatalities_lag1</textarea></label>
        <label class="ql-field">Fixed effects<select id="qlEffects"><option value="country_month">Country + calendar month</option><option value="unit_month">Unit + calendar month</option><option value="country">Country</option><option value="unit">Unit</option><option value="month">Calendar month</option><option value="none">None</option></select></label>
        <label class="ql-field">Covariates CSV<input id="qlCovariates" type="file" accept=".csv,.json"></label><p class="ql-hint">Keys: unit_id + month, or country + admin1 + month. Add population or measured territorial/political covariates. No values are invented.</p>
        <label class="ql-field">Complete unit roster CSV<input id="qlRoster" type="file" accept=".csv,.json"></label><p class="ql-hint">unit_id, country (plus admin1 for Admin1 panels). Includes regions with no events. Without a roster, the universe contains observed units only.</p>
        <label class="ql-check"><input id="qlOffset" type="checkbox">Use log(population) offset in count models</label>
        <label class="ql-field">Research hypothesis<textarea id="qlHypothesis" placeholder="State the hypothesis before estimating."></textarea></label>
      </details>
      <details><summary>Intervention and comparison design</summary>
        <label class="ql-field">Intervention month<input id="qlIntervention" type="month"></label>
        <label class="ql-field">Treated countries or unit IDs<textarea id="qlTreated" placeholder="Mali, or Mali|Gao"></textarea></label>
        <label class="ql-field">Event-study window, months<input id="qlWindow" type="number" value="12" min="3" max="36"></label>
        <p class="ql-hint">Remaining units are controls. This estimator uses one common date. Check whether your comparison design and spillover assumptions are defensible.</p>
      </details>
      <details><summary>Spatial and Bayesian settings</summary>
        <label class="ql-field">Maximum geographic precision code<select id="qlGeo"><option value="1">1 · most precise</option><option value="2" selected>2 · include vicinity</option><option value="3">3 · include wider area</option></select></label>
        <label class="ql-field">Grid width in degrees<input id="qlGrid" type="number" value="0.5" min="0.1" max="2" step="0.1"></label>
        <label class="ql-field">KDE bandwidth, km<input id="qlBandwidth" type="number" value="50" min="1"></label>
        <label class="ql-field">Country boundaries GeoJSON<input id="qlBoundaries" type="file" accept=".json,.geojson"></label>
        <label class="ql-field">Border radius, km<input id="qlBorderKm" type="number" value="50" min="1"></label>
        <label class="ql-field">Cross-border lookback<select id="qlLookback"><option value="30">30 days</option><option value="60">60 days</option><option value="90">90 days</option></select></label>
        <label class="ql-field">Country prior SD<input id="qlCountryPrior" type="number" value="1" min="0.1" step="0.1"></label>
        <label class="ql-field">Unit prior SD<input id="qlUnitPrior" type="number" value="1" min="0.1" step="0.1"></label>
      </details>
      <div class="ql-actions"><button id="qlRun" class="ql-run" type="button" disabled>RUN ANALYSIS</button><button id="qlCancel" class="ql-cancel" type="button" hidden>CANCEL</button></div>
      <button id="qlClear" type="button">CLEAR IMPORT AND RESULTS</button>
    </aside><div class="ql-content">
      <div id="qlStatus" class="ql-status" role="status" aria-live="polite">Import a licensed ACLED export to begin. Scheduled aggregate results will appear here when ACLED access is configured.</div>
      <div id="qlStats" class="ql-stats"></div>
      <div class="ql-tabs" role="group" aria-label="Research sections">${['Descriptive','Regression','Causal','Spatial','Networks','Forecast','Diagnostics'].map(c=>`<button type="button" data-ql-category="${c}">${c}</button>`).join('')}</div>
      <div id="qlMethodology" class="ql-method"></div>
      <div class="ql-actions"><button id="qlResultsDownload" type="button" disabled>RESULTS JSON</button><button id="qlPanelDownload" type="button" disabled>PANEL CSV</button><button id="qlReportDownload" type="button" disabled>RESEARCH REPORT</button><button id="qlStudyDownload" type="button" disabled>COMPLETE STUDY ZIP</button><a class="ql-download" href="./research/replication_code.zip" download>R / PYTHON CODE</a></div>
      <div id="qlResult" class="ql-result"><div class="ql-empty"><h3>Your methods portfolio starts with a dataset</h3><p>The Research Lab uses dated ACLED observations. It reports sample sizes, model equations, uncertainty, diagnostics and limitations alongside the estimates.</p><p>Choose a country, coverage period, actor/event filter, unit and method. Count and causal models require confirmed coverage.</p></div></div>
      <div id="qlHistory" class="ql-history"></div>
    </div></div>`;

  function status(message,error=false) { query('qlStatus').textContent=message; query('qlStatus').dataset.error=String(error); }
  function configuration() {
    return {countries:[...host.querySelectorAll('[name=qlCountry]:checked')].map(x=>x.value),start_date:query('qlStart').value,end_date:query('qlEnd').value,coverage_confirmed:query('qlCoverage').checked,actor:query('qlActor').value.trim(),event_types:[...query('qlEvents').selectedOptions].map(x=>x.value),unit:query('qlUnit').value,outcome:query('qlOutcome').value,predictors:query('qlPredictors').value.split(',').map(x=>x.trim()).filter(Boolean),fixed_effects:query('qlEffects').value,population_offset:query('qlOffset').checked,hypothesis:query('qlHypothesis').value.trim(),intervention_date:query('qlIntervention').value,treated_units:query('qlTreated').value.split(',').map(x=>x.trim()).filter(Boolean),event_window:Number(query('qlWindow').value),max_geo_precision:Number(query('qlGeo').value),grid_degrees:Number(query('qlGrid').value),kde_bandwidth_km:Number(query('qlBandwidth').value),border_km:Number(query('qlBorderKm').value),diffusion_days:Number(query('qlLookback').value),prior_country_sd:Number(query('qlCountryPrior').value),prior_unit_sd:Number(query('qlUnitPrior').value),seed:33,permutations:199};
  }
  function methodology() {
    const method=query('qlMethod').value, m=methods[method];
    query('qlMethodology').innerHTML=`<h3>${escape(m[1])}</h3><details><summary>SHOW METHODOLOGY</summary><pre>${escape(m[2])}</pre><p>${escape(m[3])}</p><p>Data: ACLED. Default predictors are lagged Russian participation, jihadist participation, armed-actor count and log(1 + fatalities). Filters, coverage, standard errors, removed observations and diagnostics are recorded with each result.</p></details>`;
    host.querySelectorAll('[data-ql-category]').forEach(b=>b.classList.toggle('active',b.dataset.qlCategory===m[0]));
  }
  function table(rows,columns=null,limit=250) {
    if(!rows?.length) return '<p>No observations available for this output.</p>';
    columns ||= Object.keys(rows[0]);
    const format = v => typeof v==='number'?number(v):typeof v==='object'&&v!==null?JSON.stringify(v):v===null||v===undefined?'—':String(v);
    return `<div class="ql-table"><table><thead><tr>${columns.map(c=>`<th scope="col">${escape(c.replace(/_/g,' '))}</th>`).join('')}</tr></thead><tbody>${rows.slice(0,limit).map(r=>`<tr>${columns.map(c=>`<td>${escape(format(r[c]))}</td>`).join('')}</tr>`).join('')}</tbody></table></div>${rows.length>limit?`<p class="ql-hint">Showing ${limit} of ${rows.length.toLocaleString()} rows. Downloads include all rows.</p>`:''}`;
  }
  function monthlyChart(rows,key='civilian_events') {
    if(!rows?.length) return '';
    const months=[...new Set(rows.map(r=>r.month))].sort();
    const groups=[...new Set(rows.map(r=>r.country||r.model||'Series'))];
    const colors=['#146e92','#b56230','#7446ae','#39845b'];
    const W=780,H=300,L=58,R=25,T=22,B=56,max=Math.max(1,...rows.map(r=>Number(r[key])||0));
    const x=i=>L+i*(W-L-R)/Math.max(1,months.length-1), y=v=>H-B-v*(H-T-B)/max;
    let svg=`<svg class="ql-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="${escape(key)} by month with numeric axes">`;
    for(let k=0;k<=4;k++){const v=max*k/4;svg+=`<line x1="${L}" y1="${y(v)}" x2="${W-R}" y2="${y(v)}" stroke="#b4c4cb" opacity=".5"/><text x="${L-8}" y="${y(v)+4}" text-anchor="end">${number(v)}</text>`;}
    const tick=Math.max(1,Math.ceil(months.length/7));months.forEach((m,i)=>{if(i%tick===0||i===months.length-1)svg+=`<text x="${x(i)}" y="${H-B+22}" text-anchor="middle">${escape(m)}</text>`;});
    groups.forEach((g,j)=>{
      const data=rows.filter(r=>(r.country||r.model||'Series')===g), color=colors[j%colors.length];
      let path='',prior=-2;
      for(const r of data.sort((a,b)=>a.month.localeCompare(b.month))){if(r[key]===null||r[key]===undefined){prior=-2;continue;}const i=months.indexOf(r.month),v=Number(r[key]);path+=(i===prior+1?' L ':' M ')+x(i)+','+y(v);prior=i;svg+=`<circle cx="${x(i)}" cy="${y(v)}" r="3" fill="${color}"><title>${escape(g)} · ${r.month} · ${key}: ${number(v)}</title></circle>`;}
      svg+=`<path d="${path}" fill="none" stroke="${color}" stroke-width="2"/><text x="${L+j*170}" y="${H-4}" style="fill:${color}">${escape(g)}</text>`;
    });
    svg+=`<text x="${L}" y="14">${escape(key.replace(/_/g,' '))}</text></svg>`;return svg;
  }
  function coefficientChart(rows) {
    const data=rows.filter(r=>r.term==='did'||r.relative_month!==undefined||(!/Intercept|C\(|country_|unit_|alpha|inflate/.test(r.term))).slice(0,18);
    if(!data.length) return '';
    const limits=data.flatMap(r=>[r.ci_low??r.credible_low??r.coefficient,r.ci_high??r.credible_high??r.coefficient]).filter(Number.isFinite);
    if(!limits.length) return '';
    let lo=Math.min(0,...limits),hi=Math.max(0,...limits);if(lo===hi){lo-=1;hi+=1;}const pad=(hi-lo)*.08;lo-=pad;hi+=pad;
    const W=780,L=225,R=80,H=58+data.length*30,x=v=>L+(v-lo)*(W-L-R)/(hi-lo);
    let s=`<svg class="ql-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Coefficient estimates and 95 percent uncertainty intervals"><line x1="${x(0)}" y1="15" x2="${x(0)}" y2="${H-25}" stroke="#869ea9" stroke-dasharray="4 4"/>`;
    data.forEach((r,i)=>{const y=25+i*30,a=r.ci_low??r.credible_low??r.coefficient,b=r.ci_high??r.credible_high??r.coefficient;s+=`<text x="${L-10}" y="${y+4}" text-anchor="end">${escape(r.relative_month!==undefined?'Month '+r.relative_month:r.term.replace(/Q\("(.*?)"\)/,'$1').slice(0,29))}</text><line x1="${x(a)}" y1="${y}" x2="${x(b)}" y2="${y}" stroke="#176d82" stroke-width="3"/><circle cx="${x(r.coefficient)}" cy="${y}" r="4" fill="#176d82"><title>${escape(r.term)}: ${number(r.coefficient)} [${number(a)}, ${number(b)}]</title></circle><text x="${W-R+8}" y="${y+4}">${number(r.coefficient)}</text>`;});
    for(let i=0;i<=4;i++){const v=lo+(hi-lo)*i/4;s+=`<text x="${x(v)}" y="${H-6}" text-anchor="middle">${number(v)}</text>`;}
    return s+'</svg>';
  }
  function spatialChart(rows) {
    if(!rows?.length) return '';
    const lon=rows.map(r=>r.grid_lon),lat=rows.map(r=>r.grid_lat),W=780,H=390,L=55,B=42,T=25,R=25;
    const minX=Math.min(...lon)-.5,maxX=Math.max(...lon)+.5,minY=Math.min(...lat)-.5,maxY=Math.max(...lat)+.5;
    const x=v=>L+(v-minX)*(W-L-R)/(maxX-minX),y=v=>H-B-(v-minY)*(H-B-T)/(maxY-minY),maxCount=Math.max(...rows.map(r=>r.events));
    let s=`<svg class="ql-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Observed grid-cell event counts by longitude and latitude">`;
    for(let i=0;i<=4;i++){const a=minX+(maxX-minX)*i/4,b=minY+(maxY-minY)*i/4;s+=`<text x="${x(a)}" y="${H-18}" text-anchor="middle">${number(a)}°</text><text x="${L-8}" y="${y(b)+4}" text-anchor="end">${number(b)}°</text>`;}
    rows.forEach(r=>{const color=r.hotspot==='hotspot'?'#ba4934':r.hotspot==='coldspot'?'#4169a3':'#176d82';s+=`<circle cx="${x(r.grid_lon)}" cy="${y(r.grid_lat)}" r="${3+10*Math.sqrt(r.events/maxCount)}" fill="${color}" fill-opacity=".7"><title>${escape(r.country)} (${r.grid_lat}, ${r.grid_lon}) · ${r.events} events · Gi* ${number(r.gi_star_z)} · q ${number(r.gi_q_bh)}</title></circle>`;if(rows.length<=45)s+=`<text x="${x(r.grid_lon)+8}" y="${y(r.grid_lat)-6}">${r.events}</text>`;});
    return s+'<text x="55" y="15">Recorded events · size ∝ √count · red/blue = BH-significant hotspot/coldspot</text><text x="390" y="388" text-anchor="middle">Longitude · latitude on vertical axis</text></svg>';
  }
  function render(result,panel=[],panelCsv='',remember=true) {
    lab.result=result;lab.panel=panel;lab.panelCsv=panelCsv;
    query('qlSource').textContent='ACLED · '+(lab.events?'private browser import':'scheduled aggregates');
    const n=result.n??result.n_events??result.audit?.valid_rows??0;
    query('qlStats').innerHTML=[['OBSERVATIONS',n],['PANEL UNITS',result.panel_metadata?.units],['MONTHS IN WINDOW',result.panel_metadata?.months],['PANEL ROWS',result.panel_metadata?.panel_rows]].map(([label,v])=>`<div class="ql-stat"><strong>${number(v)}</strong><span>${label}</span></div>`).join('');
    let html=`<h3>${escape(result.method_label||methods[result.method]?.[1]||result.model||'Research result')}</h3><p class="ql-audit">Source: ACLED · generated ${escape(result.generated_at)} · software ${escape(result.software_version)} · N = ${number(n)}</p>`;
    if(result.model)html+=`<p><b>Model:</b> ${escape(result.model.replace(/_/g,' '))}</p>`;
    if(result.formula)html+=`<pre>${escape(result.formula)}</pre>`;
    if(result.standard_errors)html+=`<p><b>Standard errors:</b> ${escape(result.standard_errors)}</p>`;
    const interpretations=Array.isArray(result.interpretation)?result.interpretation:[result.interpretation];
    html+=interpretations.filter(Boolean).map(v=>`<p>${escape(v)}</p>`).join('');
    if(result.coefficients?.length){html+=coefficientChart(result.coefficients)+`<h4>Coefficient estimates and uncertainty</h4>`+table(result.coefficients,['term','coefficient','standard_error','posterior_sd','ci_low','ci_high','credible_low','credible_high','ratio','ratio_low','ratio_high','p_value'].filter(c=>result.coefficients.some(r=>r[c]!==undefined)));}
    if(result.series?.length){html+=monthlyChart(result.series,result.series.some(r=>r.civilian_events!==undefined)?'civilian_events':result.series.some(r=>r.preceded_events!==undefined)?'preceded_events':'events')+'<h4>Dated observations</h4>'+table(result.series);}
    if(result.variables)html+='<h4>Panel variable distributions</h4>'+table(Object.entries(result.variables).map(([variable,v])=>({variable,...v})));
    if(result.pairs)html+='<h4>Correlation estimates</h4>'+table(result.pairs);
    if(result.cells){html+=spatialChart(result.cells)+'<h4>Spatial statistics</h4>'+table(['moran_i','moran_expected','moran_permutation_p','permutations','neighbors','mean_nearest_neighbor_km','kde_bandwidth_km'].filter(k=>result[k]!==undefined).map(k=>({statistic:k,value:result[k]})))+'<h4>Grid cell identifiers, values and uncertainty</h4>'+table(result.cells);}
    if(result.nodes){html+='<h4>Actor network metrics</h4>'+table(['n_actors','n_edges','density','components','actor_hhi'].map(k=>({statistic:k,value:result[k]})))+'<h4>Actor identifiers and centrality</h4>'+table(result.nodes)+'<h4>Interactions by actor pair</h4>'+table(result.edges);}
    if(result.validation)html+='<h4>Chronological validation vs persistence baseline</h4>'+table(result.validation)+'<h4>Probability forecast validation</h4>'+table(result.probability_validation)+'<h4>Next-month forecasts by unit</h4>'+table(result.forecast);
    if(result.forecast){const summary=new Map();for(const r of result.forecast){const key=r.country+'|'+r.month;const v=summary.get(key)||{country:r.country,month:r.month,expected_events:0};v.expected_events+=r.expected_events;summary.set(key,v);}html+=monthlyChart([...summary.values()],'expected_events');}
    if(result.balance)html+='<h4>Pre-treatment balance</h4>'+table(result.balance)+'<h4>Propensity overlap</h4>'+table(result.propensity);
    if(result.group_means)html+='<h4>Treated/control pre/post means</h4>'+table(result.group_means);
    if(result.specifications)html+='<h4>All robustness specifications</h4>'+table(result.specifications.map(r=>({...r,russian_coefficient:JSON.stringify(r.russian_coefficient)})));
    if(result.diagnostics)html+='<h4>Diagnostics</h4>'+table(Object.entries(result.diagnostics).map(([diagnostic,value])=>({diagnostic,value})));
    if(result.scaling)html+='<h4>Predictor scaling</h4>'+table(result.scaling);
    html+=`<details><summary>SHOW DATA QUALITY AND PANEL CONSTRUCTION</summary>${table(Object.entries(result.audit||{}).map(([check,value])=>({check,value})))}${table(Object.entries(result.panel_metadata||{}).map(([check,value])=>({check,value})))}</details>`;
    if(result.panel_metadata?.unit_universe?.startsWith('units observed'))html+='<div class="ql-notice">The unit universe includes regions observed in this export. Regions with no events anywhere in the window are absent; import a complete unit roster for full geographic coverage.</div>';
    html+=(result.limitations||[]).map(v=>`<div class="ql-notice">${escape(v)}</div>`).join('');
    html+=`<details><summary>SHOW EXACT RESEARCH CONFIGURATION</summary><pre>${escape(JSON.stringify(result.config,null,2))}</pre></details><p class="ql-hint">${escape(result.citation||'Source: ACLED. Record the export retrieval date and access tier when publishing.')}</p>`;
    query('qlResult').innerHTML=html;
    ['qlResultsDownload','qlPanelDownload','qlReportDownload','qlStudyDownload'].forEach(id=>query(id).disabled=false);
    if(remember){lab.history.unshift({result,panel,panelCsv});lab.history=lab.history.slice(0,20);}
    query('qlHistory').innerHTML=lab.history.length?'<h4>Analyses in this browser session</h4>'+lab.history.map((r,i)=>`<button type="button" data-ql-history="${i}">${escape(r.result.method_label||r.result.method)} · N ${number(r.result.n??r.result.n_events??r.result.audit?.valid_rows)}</button>`).join(''):'';
    host.querySelectorAll('[data-ql-history]').forEach(b=>b.onclick=()=>{const h=lab.history[Number(b.dataset.qlHistory)];render(h.result,h.panel,h.panelCsv,false);});
  }
  function setBusy(busy) {lab.busy=busy;query('qlRun').disabled=busy||!lab.events;query('qlFile').disabled=busy;query('qlCancel').hidden=!busy;}
  function stop() {if(lab.worker)lab.worker.terminate();lab.worker=null;setBusy(false);}
  function run() {
    if(lab.busy||!lab.events)return;
    const cfg=configuration();if(!cfg.countries.length){status('Select at least one country.',true);return;}
    setBusy(true);status('Preparing statistical analysis…');
    if(!lab.worker){
      lab.worker=new Worker('./research-worker.js?v=4.0.0');
      lab.worker.onerror=event=>{status('Statistical worker could not run: '+event.message+'. Download the replication code to run the same analysis locally.',true);stop();};
      lab.worker.onmessage=({data})=>{
        if(data.type==='progress'){status(data.message);return;}
        if(data.id!==lab.id)return;
        setBusy(false);
        if(data.error||data.type==='error'){status(data.error||data.message,true);return;}
        render(data.result,data.panel,data.panel_csv);status('Analysis complete. Estimates, assumptions and diagnostics are shown below.');
      };
    }
    lab.worker.postMessage({id:++lab.id,method:query('qlMethod').value,events:lab.events,config:cfg,covariates:lab.covariates,roster:lab.roster,boundaries:lab.boundaries});
  }
  async function importFile(input,key) {
    const file=input.files?.[0];if(!file)return;
    if(file.size>50*1024*1024){status('Import exceeds 50 MB. Use a narrower ACLED export or the Python/R replication code.',true);input.value='';return;}
    const value=await file.text();lab[key]=value;
    if(key==='events'){
      stop();query('qlCoverage').checked=false;query('qlRun').disabled=false;
      query('qlSource').textContent='ACLED · private browser import';
      status(file.name+' imported into this browser. Set its coverage dates, confirm coverage where appropriate, then run an analysis.');
    }else status(file.name+' loaded as '+key+'. It stays in browser memory.');
  }
  function download(name,value,type='application/json') {const link=document.createElement('a'),url=URL.createObjectURL(new Blob([value],{type}));link.href=url;link.download=name;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),2000);}
  function panelCsv() {if(lab.panelCsv)return lab.panelCsv;if(!lab.panel.length)return '';const cols=Object.keys(lab.panel[0]),quote=v=>'"'+String(v??'').replace(/"/g,'""')+'"';return cols.join(',')+'\n'+lab.panel.map(r=>cols.map(c=>quote(r[c])).join(',')).join('\n');}
  function report() {
    const r=lab.result;if(!r)return '';
    const lines=['# '+(r.method_label||r.method),'','Author: Moses Costa','Source: ACLED','Generated: '+r.generated_at,'','## Research design','',r.config?.hypothesis||'Hypothesis was not recorded before estimation.','', 'Unit: '+r.config?.unit,'Outcome: '+r.config?.outcome,'N: '+(r.n??r.n_events??r.audit?.valid_rows),'', '## Specification','',r.formula||methods[r.method]?.[2]||'',r.standard_errors||'','', '## Interpretation','',...(Array.isArray(r.interpretation)?r.interpretation:[r.interpretation]).filter(Boolean),'','## Findings and uncertainty',''];
    if(r.coefficients){lines.push('| Term | Estimate | 95% lower | 95% upper | Ratio | p |','| --- | ---: | ---: | ---: | ---: | ---: |');for(const c of r.coefficients)lines.push(`| ${c.term.replace(/\|/g,'/')} | ${number(c.coefficient)} | ${number(c.ci_low??c.credible_low)} | ${number(c.ci_high??c.credible_high)} | ${number(c.ratio)} | ${number(c.p_value)} |`);}
    lines.push('','## Diagnostics','','```json',JSON.stringify(r.diagnostics||r.audit,null,2),'```','','## Limitations','',...(r.limitations||[]).map(x=>'- '+x),'','## Replication','','Configuration and complete machine-readable results accompany this report. The panel contains derived aggregates; obtain raw events through your own ACLED access.','','```json',JSON.stringify(r.config,null,2),'```','',r.citation||'ACLED event data.');return lines.join('\n');
  }
  // ZIP store format. No dependency or raw-event upload; all entries are constructed in memory.
  function zipFiles(files) {
    const encoder=new TextEncoder(),local=[],central=[];let offset=0;
    const crc32=bytes=>{let crc=0xffffffff;for(const b of bytes){crc^=b;for(let k=0;k<8;k++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return (crc^0xffffffff)>>>0;};
    for(const [name,content] of files){const nameBytes=encoder.encode(name),bytes=content instanceof Uint8Array?content:encoder.encode(content),crc=crc32(bytes);const head=new Uint8Array(30),v=new DataView(head.buffer);v.setUint32(0,0x04034b50,true);v.setUint16(4,20,true);v.setUint32(14,crc,true);v.setUint32(18,bytes.length,true);v.setUint32(22,bytes.length,true);v.setUint16(26,nameBytes.length,true);local.push(head,nameBytes,bytes);const cen=new Uint8Array(46),c=new DataView(cen.buffer);c.setUint32(0,0x02014b50,true);c.setUint16(4,20,true);c.setUint16(6,20,true);c.setUint32(16,crc,true);c.setUint32(20,bytes.length,true);c.setUint32(24,bytes.length,true);c.setUint16(28,nameBytes.length,true);c.setUint32(42,offset,true);central.push(cen,nameBytes);offset+=head.length+nameBytes.length+bytes.length;}
    const centralSize=central.reduce((s,b)=>s+b.length,0),end=new Uint8Array(22),v=new DataView(end.buffer);v.setUint32(0,0x06054b50,true);v.setUint16(8,files.length,true);v.setUint16(10,files.length,true);v.setUint32(12,centralSize,true);v.setUint32(16,offset,true);return new Blob([...local,...central,end],{type:'application/zip'});
  }
  query('qlFile').onchange=()=>importFile(query('qlFile'),'events').catch(e=>status(String(e),true));
  for(const [id,key] of [['qlCovariates','covariates'],['qlRoster','roster'],['qlBoundaries','boundaries']])query(id).onchange=()=>importFile(query(id),key).catch(e=>status(String(e),true));
  query('qlRun').onclick=run;query('qlCancel').onclick=()=>{stop();status('Analysis cancelled. Your private import is still available.');};
  query('qlClear').onclick=()=>{stop();lab.events=lab.covariates=lab.roster=lab.boundaries=lab.result=null;lab.panel=[];lab.panelCsv='';lab.history=[];['qlFile','qlCovariates','qlRoster','qlBoundaries'].forEach(id=>query(id).value='');query('qlCoverage').checked=false;query('qlRun').disabled=true;query('qlSource').textContent='ACLED · awaiting data';query('qlResult').innerHTML='<div class="ql-empty"><h3>Import cleared</h3><p>Raw records, derived results and analysis history were removed from this workspace.</p></div>';query('qlStats').innerHTML=query('qlHistory').innerHTML='';['qlResultsDownload','qlPanelDownload','qlReportDownload','qlStudyDownload'].forEach(id=>query(id).disabled=true);status('Import and results cleared.');};
  query('qlMethod').onchange=methodology;
  host.querySelectorAll('[data-ql-category]').forEach(b=>b.onclick=()=>{const method=Object.keys(methods).find(k=>methods[k][0]===b.dataset.qlCategory);query('qlMethod').value=method;methodology();});
  query('qlResultsDownload').onclick=()=>download('Sahel_Research_Results.json',JSON.stringify(lab.result,null,2));
  query('qlPanelDownload').onclick=()=>download('Sahel_Admin_Month_Panel.csv',panelCsv(),'text/csv');
  query('qlReportDownload').onclick=()=>download('Sahel_Research_Report.md',report(),'text/markdown');
  query('qlStudyDownload').onclick=async()=>{try{const response=await fetch('./research/replication_code.zip');if(!response.ok)throw new Error('Replication download is unavailable.');const files=[['results.json',JSON.stringify(lab.result,null,2)],['panel.csv',panelCsv()],['research_report.md',report()],['config/research_lab.json',JSON.stringify(lab.result.config,null,2)],['replication_code.zip',new Uint8Array(await response.arrayBuffer())],['REPLICATE.txt','Extract replication_code.zip, replace config/research_lab.json with the included configuration, and follow analysis/README.md. Obtain the raw ACLED export through your own account; raw events are intentionally absent.\n']];download('Sahel_Complete_Study.zip',zipFiles(files),'application/zip');}catch(e){status(e.message,true);}};
  methodology();
  fetch('./data/research_lab.json?ts='+Date.now(),{cache:'no-store'}).then(r=>r.ok?r.json():null).then(data=>{
    if(!data||lab.events)return;lab.public=data;
    const available=data.analyses?.filter(a=>a.status==='ok')||[];
    if(available.length){for(const a of available)lab.history.push({result:a,panel:data.panel||[],panelCsv:''});render(available[0],data.panel||[],'',false);status(data.status==='stale'?'Scheduled aggregates are stale. Last successful snapshot: '+data.last_successful_at:'Scheduled ACLED aggregates available. Import your own export to change a specification.');}
    else status(data.provenance?.reason||'No ACLED dataset has been loaded. Import your export to run the Research Lab.');
  }).catch(()=>status('No scheduled ACLED snapshot is available. Import your export to run the Research Lab.'));
  window.SAHEL_RESEARCH_LAB={methods,lab,configuration,render,report,zipFiles};
})();
