/* Sahel Intel v2.9.3 — Daily Briefing UI */
(() => {
  'use strict';
  const DATA_URL = './data/daily_briefings.json';
  const ARCHIVE_URL = './data/briefing_archive_index.json';
  const REFRESH_MS = 60000;
  const $ = (id) => document.getElementById(id);

  let bundle = null;
  let archiveIndex = null;
  let selectedDate = null;
  let selectedCountry = 'All';
  let selectedActor = 'All';
  let lastDeskDate = deskToday();

  function deskToday() {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(new Date());
    const value = Object.fromEntries(parts.map(p => [p.type, p.value]));
    return `${value.year}-${value.month}-${value.day}`;
  }

  const esc = (value) => String(value ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#039;');

  function dayLabel(day) {
    if (!day) return 'Unknown date';
    const d = new Date(day + 'T12:00:00Z');
    return Number.isNaN(d.getTime()) ? day : new Intl.DateTimeFormat('en-US', {
      timeZone: 'UTC', year: 'numeric', month: 'short', day: '2-digit'
    }).format(d).toUpperCase();
  }

  function stamp(value) {
    if (!value) return 'Not established';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return esc(value);
    return new Intl.DateTimeFormat('en-US', {
      year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit',
      hour12: false, timeZone: 'America/New_York', timeZoneName: 'short'
    }).format(d);
  }

  function confidenceClass(value) {
    const x = String(value || '').toLowerCase();
    if (x.includes('high')) return 'db-good';
    if (x.includes('moderate') || x.includes('medium')) return 'db-warn';
    return 'db-bad';
  }

  function metric(label, value, note='') {
    return `<div class="db-metric"><span>${esc(label)}</span><strong>${esc(value)}</strong>${note ? `<small>${esc(note)}</small>` : ''}</div>`;
  }

  function briefings() { return bundle?.briefings || []; }
  function selectedBrief() {
    return briefings().find(b => b.reporting_date === selectedDate) || null;
  }

  function renderSummary() {
    const host = $('dailyBriefingSummary');
    if (!host) return;
    const b = selectedBrief();
    if (!b) {
      host.innerHTML = `<div class="db-empty">The ${esc(dayLabel(selectedDate || deskToday()))} briefing is being prepared. It will appear after the next collection run.</div>`;
      return;
    }
    const sections = Array.isArray(b.briefing_sections) && b.briefing_sections.length
      ? b.briefing_sections
      : [{heading: 'Assessment', text: b.executive_assessment || 'No assessment has been generated for this date.'}];
    host.innerHTML = `
      <article class="db-paper">
        <div class="db-paper-header">
          <div><span class="eyebrow">SAHEL INTELLIGENCE DESK • OPEN SOURCE</span>
            <h2>${b.reporting_date === deskToday() ? 'Daily Intelligence Brief' : 'Archived Intelligence Brief'}</h2>
            <p>${esc(dayLabel(b.reporting_date))} • Mali / Burkina Faso / Niger</p>
          </div>
          <div class="db-paper-actions"><button class="db-action" id="dbReadBrief">▶ READ BRIEF</button><button class="db-action" id="dbStopBrief">■ STOP</button></div>
        </div>
        <div class="db-paper-body">${sections.map(section => `<section class="db-paragraph"><h3>${esc(section.heading)}</h3><p>${esc(section.text)}</p></section>`).join('')}</div>
        <div class="db-paper-foot">Open-source reporting • Updated ${stamp(b.generated_at)} • Source checks and records under review are listed below</div>
      </article>`;
    $('dbReadBrief')?.addEventListener('click', () => speak(sections.map(section => `${section.heading}. ${section.text}`).join(' ')));
    $('dbStopBrief')?.addEventListener('click', stopSpeech);
  }

  function renderList() {
    const host = $('dailyBriefingList');
    if (!host) return;
    const bs = briefings();
    if (!bs.length) {
      host.innerHTML = '<div class="db-empty">No briefings available.</div>';
      return;
    }
    host.innerHTML = bs.map(b => {
      const m = b.headline_metrics || {};
      const active = b.reporting_date === selectedDate ? ' active' : '';
      return `<button class="db-history-card${active}" data-db-date="${esc(b.reporting_date)}">
        <div class="db-history-top"><strong>${esc(dayLabel(b.reporting_date))}</strong><span class="db-pill ${confidenceClass(b.collection_confidence)}">${esc(b.collection_confidence || 'UNKNOWN')}</span></div>
        <div class="db-history-stats"><span>${esc(m.events_occurring_on_date ?? 0)} events</span><span>${esc(m.reports_collected_on_date ?? 0)} reports</span><span>${esc(m.multi_source_events ?? 0)} corroborated</span></div>
      </button>`;
    }).join('');
    host.querySelectorAll('[data-db-date]').forEach(btn => btn.addEventListener('click', () => {
      selectedDate = btn.dataset.dbDate;
      renderAll();
      $('dailyBriefingDetail')?.scrollIntoView({behavior:'smooth', block:'start'});
    }));
  }

  function judgmentList(items) {
    if (!items?.length) return '<p class="muted">No automated judgment available.</p>';
    return `<ul class="db-list">${items.map(x => `<li>${esc(x)}</li>`).join('')}</ul>`;
  }

  function eventMatches(e) {
    if (selectedCountry !== 'All' && e.country !== selectedCountry) return false;
    if (selectedActor !== 'All' && e.actor !== selectedActor) return false;
    return true;
  }

  function eventCard(e) {
    const domains = (e.independent_source_domains || []).slice(0, 6);
    const urls = e.report_urls || [];
    return `<article class="db-event-card">
      <div class="db-event-head">
        <div><span class="db-kicker">${esc(e.actor || 'Other')} • ${esc(e.event_type || 'Unclassified')}</span><h4>${esc(e.title || 'Untitled candidate event')}</h4></div>
        <span class="db-pill ${confidenceClass(e.confidence)}">${esc(e.confidence || 'candidate')}</span>
      </div>
      <p>${esc(e.summary || '')}</p>
      <div class="db-date-grid">
        <div><span>EVENT DATE</span><strong>${esc(e.event_date || 'Unresolved')}</strong><small>${esc(e.event_date_confidence || '')}</small></div>
        <div><span>PUBLICATION</span><strong>${stamp(e.publication_time)}</strong></div>
        <div><span>COLLECTION</span><strong>${stamp(e.collection_time)}</strong></div>
        <div><span>VERIFICATION</span><strong>${esc(e.verification_date || 'Not independently verified')}</strong><small>${esc(e.verification_basis || '')}</small></div>
      </div>
      <div class="db-event-meta">
        <span>${esc(e.city || 'Location unresolved')}${e.country ? `, ${esc(e.country)}` : ''}</span>
        <span>${esc(e.independent_source_count || 0)} independent domain(s)</span>
        <span>${esc(e.source_count || 0)} linked report(s)</span>
      </div>
      ${domains.length ? `<div class="db-source-row"><b>Independent domains:</b> ${domains.map(esc).join(' • ')}</div>` : ''}
      ${urls.length ? `<div class="db-links">${urls.slice(0,5).map((u,i)=>`<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">SOURCE ${i+1} ↗</a>`).join('')}</div>` : ''}
    </article>`;
  }

  function profileTable(title, rows) {
    return `<div class="db-profile"><h4>${esc(title)}</h4>${rows.join('')}</div>`;
  }

  function renderCountryArticles(b) {
    const grouped = b.country_article_summaries || {};
    const countries = ['Mali','Burkina Faso','Niger'];
    const blocks = countries.map(country => {
      const rows = Array.isArray(grouped[country]) ? grouped[country] : [];
      const cards = rows.map(r => `<article class="db-event-card db-article-card">
        <div class="db-event-head"><div><span class="db-kicker">${esc(country)} • ${esc(r.source || 'SOURCE')}</span><h4>${esc(r.title || 'Untitled report')}</h4></div>${r.candidate_event?'<span class="db-pill">MAP CANDIDATE</span>':'<span class="db-pill">RETAINED</span>'}</div>
        <p><b>Article summary:</b> ${esc(r.summary || 'Summary unavailable.')}</p>
        <div class="db-event-meta"><span>Event date: ${esc(r.event_date || 'unresolved')}</span></div>
        ${r.url?`<div class="db-links"><a href="${esc(r.url)}" target="_blank" rel="noopener noreferrer">OPEN SOURCE ↗</a></div>`:''}
      </article>`).join('');
      return `<section class="db-country-articles"><div class="db-section-head"><h3>${esc(country)} retained reporting</h3><span>${rows.length} summarized</span></div>${cards || '<div class="db-empty">No retained reports for this country on the selected desk date.</div>'}</section>`;
    });
    return blocks.join('');
  }

  function renderProfiles(b) {
    const countries = b.country_profiles || {};
    const actors = b.actor_profiles || {};
    const cRows = Object.entries(countries).map(([name,p]) => `<div class="db-profile-row"><span>${esc(name)}</span><strong>${esc(p.events ?? 0)} events</strong><small>${esc(p.reports_collected ?? 0)} reports collected • Δ ${Number(p.delta_events_vs_previous_day || 0) >= 0 ? '+' : ''}${esc(p.delta_events_vs_previous_day ?? 0)}</small></div>`);
    const aRows = Object.entries(actors).map(([name,p]) => `<div class="db-profile-row"><span>${esc(name)}</span><strong>${esc(p.events ?? 0)} events</strong><small>7D ${esc(p.current_7d ?? 0)} • prior 7D ${esc(p.previous_7d ?? 0)} • Δ ${Number(p.delta_vs_previous_day || 0) >= 0 ? '+' : ''}${esc(p.delta_vs_previous_day ?? 0)}</small></div>`);
    return `<div class="db-profile-grid">${profileTable('COUNTRY PICTURE', cRows)}${profileTable('ACTOR PICTURE', aRows)}</div>`;
  }

  function renderDetail() {
    const host = $('dailyBriefingDetail');
    if (!host) return;
    const b = selectedBrief();
    if (!b) { host.innerHTML = ''; return; }
    const notes = b.collection_notes || {};
    const events = (b.significant_events || []).filter(eventMatches);
    const m = b.headline_metrics || {};
    host.innerHTML = `<details class="db-annex"><summary>Supporting evidence and collection figures <span>VIEW SOURCE RECORDS ↓</span></summary><div class="db-annex-content">
      <section class="db-section"><h3>Key Judgments</h3>${judgmentList(b.key_judgments)}</section>
      <section class="db-section"><div class="db-section-head"><h3>Retained Article Summaries</h3><span>mapped + unmapped</span></div>${renderCountryArticles(b)}</section>
      <section class="db-section">
        <div class="db-section-head"><h3>Significant Events</h3><span>${events.length} shown</span></div>
        <div class="db-filter-row">
          <span>COUNTRY</span>${['All','Mali','Burkina Faso','Niger'].map(x=>`<button data-db-country="${esc(x)}" class="${selectedCountry===x?'active':''}">${esc(x)}</button>`).join('')}
          <span>ACTOR</span>${['All','JNIM','IS Sahel','State'].map(x=>`<button data-db-actor="${esc(x)}" class="${selectedActor===x?'active':''}">${esc(x)}</button>`).join('')}
        </div>
        <div class="db-event-list">${events.length ? events.map(eventCard).join('') : '<div class="db-empty">No significant events match this filter for the selected date.</div>'}</div>
      </section>
      <div class="db-two-col">
        <section class="db-section"><h3>What Changed Since Yesterday</h3>${judgmentList(b.what_changed_since_yesterday)}</section>
        <section class="db-section"><h3>Emerging Patterns</h3>${judgmentList(b.emerging_patterns)}</section>
      </div>
      <section class="db-section"><h3>Intelligence Gaps</h3>${judgmentList(b.intelligence_gaps)}</section>
      ${renderProfiles(b)}
      <section class="db-section">
        <h3>Daily counts</h3><div class="db-metric-grid">
          ${metric('Events dated this day', m.events_occurring_on_date ?? 0)}
          ${metric('Records held for review', m.records_held_for_review ?? 0)}
          ${metric('Reports collected', m.reports_collected_on_date ?? 0)}
          ${metric('Older events discovered', m.newly_discovered_older_events ?? 0)}
          ${metric('Date awaiting check', m.events_awaiting_date_verification ?? 0)}
          ${metric('Multi-source candidates', m.multi_source_events ?? 0)}
          ${metric('Sources represented', m.distinct_sources_collected ?? 0)}
        </div>
      </section>
      <section class="db-section">
        <h3>Collection Notes</h3>
        <div class="db-note-grid">
          ${metric('Collection health', notes.collection_confidence || b.collection_confidence || 'UNKNOWN')}
          ${metric('Source paths reached', `${notes.sources_success ?? 0}/${notes.sources_total ?? 0}`)}
          ${metric('Failed paths', notes.sources_failed ?? 0)}
          ${metric('Degraded paths', notes.sources_degraded ?? '—')}
          ${metric('Documents discovered', notes.documents_discovered ?? 0)}
          ${metric('Documents retained', notes.documents_retained ?? 0, `target ${notes.report_target ?? 100}`)}
        </div>
        ${judgmentList(notes.collection_confidence_reasons)}
      </section>
      </div></details>`;

    host.querySelectorAll('[data-db-country]').forEach(btn => btn.addEventListener('click', () => { selectedCountry = btn.dataset.dbCountry; renderDetail(); }));
    host.querySelectorAll('[data-db-actor]').forEach(btn => btn.addEventListener('click', () => { selectedActor = btn.dataset.dbActor; renderDetail(); }));
  }

  function renderArchive() {
    const host = $('dailyBriefingArchive');
    if (!host) return;
    const items = archiveIndex?.briefings || [];
    const active = bundle?.active_count || briefings().length;
    const total = bundle?.total_briefings || active;
    host.innerHTML = `
      <div class="db-archive-head"><div><span class="eyebrow">PERMANENT RECORD</span><h3>Briefing Archive</h3></div><div class="db-archive-count"><strong>${esc(total)}</strong><span>total • latest ${esc(active)} loaded in dashboard</span></div></div>
      <p class="muted">The dashboard keeps the latest 33 complete briefings. Older complete briefings are retained in the private repository archive; this public index keeps their dates and summary metadata without exposing the full private archive.</p>
      ${items.length ? `<div class="db-archive-list">${items.map(x=>`<div class="db-archive-row"><strong>${esc(dayLabel(x.reporting_date))}</strong><span>${esc(x.events ?? 0)} events</span><span>${esc(x.reports_collected ?? 0)} reports</span><span class="db-pill ${confidenceClass(x.collection_confidence)}">${esc(x.collection_confidence)}</span><p>${esc(x.executive_assessment || '')}</p></div>`).join('')}</div>` : '<div class="db-empty">No briefing has rotated into the permanent archive yet.</div>'}`;
  }

  function speak(text) {
    if (!('speechSynthesis' in window) || !text) return;
    stopSpeech();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'en-US';
    u.rate = 0.96;
    const voices = window.speechSynthesis.getVoices();
    u.voice = voices.find(v => /female|jenny|aria|samantha|zira|ava/i.test(v.name)) || voices.find(v => /^en/i.test(v.lang)) || null;
    window.speechSynthesis.speak(u);
  }
  function stopSpeech() { if ('speechSynthesis' in window) window.speechSynthesis.cancel(); }

  function renderAll() {
    if (!selectedDate) selectedDate = deskToday();
    renderSummary(); renderList(); renderDetail(); renderArchive();
  }

  async function load() {
    try {
      const today = deskToday();
      if (today !== lastDeskDate) { lastDeskDate = today; selectedDate = today; }
      const [b, a] = await Promise.all([
        fetch(DATA_URL, {cache:'no-store'}).then(r => r.ok ? r.json() : Promise.reject(new Error(`daily briefings ${r.status}`))),
        fetch(ARCHIVE_URL, {cache:'no-store'}).then(r => r.ok ? r.json() : {briefings:[]}).catch(()=>({briefings:[]}))
      ]);
      bundle = b; archiveIndex = a;
      if (selectedDate && selectedDate !== today && !briefings().some(x => x.reporting_date === selectedDate)) selectedDate = today;
      renderAll();
    } catch (err) {
      const host = $('dailyBriefingSummary');
      if (host) host.innerHTML = `<div class="db-empty">Daily briefing data is unavailable. The collector must run the v2.9.3 briefing builder first.<br><small>${esc(err.message)}</small></div>`;
    }
  }

  document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); });
  window.addEventListener('beforeunload', stopSpeech);
  load();
  setInterval(load, REFRESH_MS);
})();

