(() => {
  'use strict';

  const PASSWORD = '33';
  const AUDIT_URL = './data/collection_audit.json';
  const STATUS_URL = './data/country_pipeline_status.json';
  const $ = (id) => document.getElementById(id);
  const esc = (v) => String(v ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;');

  let audit = null;

  function n(v){ return Number(v || 0).toLocaleString(); }
  function badge(status){
    const s = String(status || 'UNKNOWN').toUpperCase();
    return `<span class="log-badge log-${esc(s.toLowerCase())}">${esc(s)}</span>`;
  }
  function stamp(v){
    if(!v) return '—';
    const d = new Date(v);
    if(Number.isNaN(d.getTime())) return esc(v);
    return d.toLocaleString();
  }
  function pipelineCard(name, p){
    return `<article class="country-pipeline">
      <div class="country-pipeline-head"><strong>${esc(name)}</strong>${badge(p.status || 'LIVE')}</div>
      <div class="country-pipeline-metrics">
        <span><b>${n(p.sources)}</b> sources</span>
        <span><b>${n(p.discovered)}</b> discovered</span>
        <span><b>${n(p.included)}</b> included</span>
        <span><b>${n(p.excluded)}</b> excluded</span>
        <span><b>${n(p.errors)}</b> errors</span>
      </div>
      <small>${esc(p.note || 'Country-specific collection lane')}</small>
    </article>`;
  }

  async function loadPublicPipelineStatus(){
    const host = $('countryPipelineStatus');
    if(!host) return;
    try{
      const r = await fetch(`${STATUS_URL}?t=${Date.now()}`, {cache:'no-store'});
      if(!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      host.innerHTML = Object.entries(data.pipelines || {}).map(([name,p])=>pipelineCard(name,p)).join('') || '<div class="note">No pipeline status available yet.</div>';
    }catch(e){
      host.innerHTML = `<div class="coverage-warning">Pipeline status unavailable: ${esc(e.message)}</div>`;
    }
  }

  function unlocked(){ return sessionStorage.getItem('sicLogsUnlocked') === '1'; }
  function showGate(){
    if($('logsGate')) $('logsGate').hidden = false;
    if($('logsWorkspace')) $('logsWorkspace').hidden = true;
    if($('logsLockBtn')) $('logsLockBtn').hidden = true;
  }
  async function showWorkspace(){
    if($('logsGate')) $('logsGate').hidden = true;
    if($('logsWorkspace')) $('logsWorkspace').hidden = false;
    if($('logsLockBtn')) $('logsLockBtn').hidden = false;
    await loadAudit();
  }
  async function loadAudit(){
    const host = $('logsSummary');
    if(host) host.innerHTML = '<span class="note">Loading audit trail…</span>';
    try{
      const r = await fetch(`${AUDIT_URL}?t=${Date.now()}`, {cache:'no-store'});
      if(!r.ok) throw new Error(`HTTP ${r.status}`);
      audit = await r.json();
      render();
    }catch(e){
      if(host) host.innerHTML = `<div class="coverage-warning">Audit log unavailable: ${esc(e.message)}. Run the collector once after installing this update.</div>`;
      const rows = $('logsRows'); if(rows) rows.innerHTML = '';
    }
  }

  function filteredRows(){
    const pipe = $('logsPipelineFilter')?.value || 'all';
    const decision = $('logsDecisionFilter')?.value || 'all';
    const q = ($('logsSearch')?.value || '').trim().toLowerCase();
    return (audit?.decisions || []).filter(d => {
      if(pipe !== 'all' && d.pipeline !== pipe) return false;
      if(decision !== 'all' && d.decision !== decision) return false;
      if(q){
        const hay = [d.pipeline,d.decision,d.source,d.source_id,d.language,d.collection_method,d.stage,d.reason,d.title,d.url,d.collected_at].join(' ').toLowerCase();
        if(!hay.includes(q)) return false;
      }
      return true;
    });
  }

  function render(){
    if(!audit) return;
    const cards = $('logsPipelineCards');
    if(cards) cards.innerHTML = Object.entries(audit.pipelines || {}).map(([name,p])=>pipelineCard(name,p)).join('');
    const rows = filteredRows();
    const counts = rows.reduce((a,d)=>{a[d.decision]=(a[d.decision]||0)+1; return a;},{});
    const summary = $('logsSummary');
    if(summary){
      summary.innerHTML = `<strong>${n(rows.length)}</strong> visible decisions
        <span>${n(counts.INCLUDED)} included</span>
        <span>${n(counts.EXCLUDED)} excluded</span>
        <span>${n(counts.DUPLICATE)} duplicates</span>
        <span>${n(counts.ERROR)} errors</span>
        <span>Generated ${stamp(audit.generated_at)}</span>`;
    }
    const tbody = $('logsRows');
    if(!tbody) return;
    tbody.innerHTML = rows.map(d => `<tr>
      <td>${esc(d.pipeline)}</td>
      <td>${badge(d.decision)}</td>
      <td><strong>${esc(d.source || d.source_id || 'Unknown')}</strong></td>
      <td>${esc((d.language || '—').toUpperCase())}</td>
      <td>${esc(d.collection_method || '—')}</td>
      <td>${esc(d.stage || '—')}</td>
      <td class="log-reason">${esc(d.reason || 'No reason recorded')}</td>
      <td class="log-item">${d.url ? `<a href="${esc(d.url)}" target="_blank" rel="noopener noreferrer">${esc(d.title || d.url)}</a>` : esc(d.title || '—')}</td>
      <td>${stamp(d.collected_at || d.timestamp)}</td>
    </tr>`).join('') || '<tr><td colspan="9" class="note">No audit decisions match these filters.</td></tr>';
  }

  function bind(){
    $('logsUnlockForm')?.addEventListener('submit', async (e)=>{
      e.preventDefault();
      const pw = $('logsPassword')?.value || '';
      if(pw === PASSWORD){
        sessionStorage.setItem('sicLogsUnlocked','1');
        if($('logsGateMessage')) $('logsGateMessage').textContent = '';
        if($('logsPassword')) $('logsPassword').value = '';
        await showWorkspace();
      } else {
        if($('logsGateMessage')) $('logsGateMessage').textContent = 'Incorrect password.';
      }
    });
    $('logsLockBtn')?.addEventListener('click', ()=>{
      sessionStorage.removeItem('sicLogsUnlocked');
      audit = null;
      showGate();
    });
    $('logsRefreshBtn')?.addEventListener('click', loadAudit);
    ['logsPipelineFilter','logsDecisionFilter','logsSearch'].forEach(id=>{
      $(id)?.addEventListener(id === 'logsSearch' ? 'input' : 'change', render);
    });
    document.querySelector('[data-view="logs"]')?.addEventListener('click', ()=>{
      if(unlocked()) showWorkspace(); else showGate();
    });
    if(unlocked()) showWorkspace(); else showGate();
    loadPublicPipelineStatus();
  }

  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind);
  else bind();
})();