// Step 2 - Weekly Planning
(function(){
  const state = {
    items: [], // from etapa 1
    filters: { impacto: 'all', esforco: 'all' },
    squads: [],
    currentSquad: '',
    grids: {}, // { [squad]: { weeks: number, grid: { 'Sem 1': { t1:[], t2:[], t3:[] }, ... } } }
  };

  const IMP_ORDER = ['Altíssimo','Alto','Médio','Baixo'];
  const ESF_ORDER = ['Baixo','Médio','Alto'];

  function loadItems() {
    try {
      const raw = localStorage.getItem('priorizacao_state');
      if (!raw) return;
      const parsed = JSON.parse(raw);
      state.items = (parsed.items || []).map(it => ({...it}));
    } catch(e) { /* noop */ }
    // Load grid/weeks if present
    try {
      const raw2 = localStorage.getItem('priorizacao_step2');
      if (raw2) {
        const parsed2 = JSON.parse(raw2);
        if (parsed2 && parsed2.grids) state.grids = parsed2.grids;
        if (parsed2 && parsed2.currentSquad) state.currentSquad = parsed2.currentSquad;
      }
    } catch(e) { /* noop */ }

    // squads list
    const set = new Set();
    state.items.forEach(it=> { const s=(it.squad||'').trim(); if (s) set.add(s); });
    state.squads = Array.from(set).sort();
    if (!state.currentSquad) state.currentSquad = state.squads[0] || '';
  }

  function normalizeString(v){
    if (v==null) return '';
    return String(v).trim().toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu,'');
  }

  function sortItems(items){
    return items.slice().sort((a,b)=>{
      const ai = IMP_ORDER.indexOf(a.impactClass||'');
      const bi = IMP_ORDER.indexOf(b.impactClass||'');
      if (ai !== bi) return ai - bi; // Altíssimo first (lower index)
      const ae = ESF_ORDER.indexOf(a.effortClass||'');
      const be = ESF_ORDER.indexOf(b.effortClass||'');
      if (ae !== be) return ae - be; // Baixo first
      return normalizeString(a.demanda).localeCompare(normalizeString(b.demanda));
    });
  }

  function el(tag, className, attrs={}){
    const e=document.createElement(tag);
    if (className) e.className=className;
    for (const [k,v] of Object.entries(attrs)) e.setAttribute(k,v);
    return e;
  }
  function clear(node){ while(node.firstChild) node.removeChild(node.firstChild); }

  function getSquadData(){
    const key = state.currentSquad || '';
    if (!state.grids[key]) state.grids[key] = { weeks: 5, grid: {} };
    return state.grids[key];
  }

  function ensureWeeks(){
    const board = document.getElementById('weeksBoard');
    clear(board);
    // headers
    board.appendChild(el('div','y-label empty'));
    board.appendChild(el('div','x-header')).textContent='Tarefa 1';
    board.appendChild(el('div','x-header')).textContent='Tarefa 2';
    board.appendChild(el('div','x-header')).textContent='Tarefa 3';

    const sdata = getSquadData();
    for (let i=1;i<=sdata.weeks;i++){
      const weekKey = `Ciclo ${i}`;
      if (!sdata.grid[weekKey]) sdata.grid[weekKey] = { t1: [], t2: [], t3: [] };
      board.appendChild(el('div','y-label')).textContent = weekKey;
      ['t1','t2','t3'].forEach(slot=>{
        const c = el('div','cell',{ 'data-week': weekKey, 'data-slot': slot });
        attachDrop(c);
        board.appendChild(c);
      });
    }
  }

  function attachDrop(target){
    target.addEventListener('dragover',ev=>{ ev.preventDefault(); target.classList.add('drag-over'); });
    target.addEventListener('dragleave',()=> target.classList.remove('drag-over'));
    target.addEventListener('drop',ev=>{
      ev.preventDefault(); target.classList.remove('drag-over');
      const id = Number(ev.dataTransfer.getData('text/plain'));
      const item = state.items.find(x=>x.id===id);
      if (!item) return;
      const week = target.getAttribute('data-week');
      const slot = target.getAttribute('data-slot');
      const sdata = getSquadData();
      // move: remove from every slot in all cycles, then set here
      removeFromAllSlots(sdata, id);
      sdata.grid[week][slot] = [id];
      render();
      persistGrid();
    });
  }

  function removeFromAllSlots(sdata, id){
    for (const [w, slots] of Object.entries(sdata.grid)){
      ['t1','t2','t3'].forEach(sl=>{
        const arr = slots[sl] || [];
        const idx = arr.indexOf(id);
        if (idx !== -1) arr.splice(idx,1);
      });
    }
  }

  function render(){
    // render weeks grid slots
    const board = document.getElementById('weeksBoard');
    const cells = Array.from(board.querySelectorAll('.cell'));
    cells.forEach(c=>clear(c));

    const sdata = getSquadData();
    for (const [week,slots] of Object.entries(sdata.grid)){
      for (const slot of ['t1','t2','t3']){
        const ids = slots[slot] || [];
        const target = board.querySelector(`.cell[data-week="${week}"][data-slot="${slot}"]`);
        ids.forEach(id=>{
          const it = state.items.find(x=>x.id===id);
          if (!it) return;
          target.appendChild(card(it));
        });
      }
      // highlight overload: 2 or more efforts 'Alto' in the cycle
      const altos = ['t1','t2','t3'].reduce((acc,slot)=>{
        const id = slots[slot]?.[0];
        const it = id ? state.items.find(x=>x.id===id) : null;
        return acc + ((it && it.effortClass==='Alto') ? 1 : 0);
      },0);
      const rowCells = board.querySelectorAll(`.cell[data-week="${week}"]`);
      rowCells.forEach(cell => {
        if (altos >= 2) cell.classList.add('cycle-overload'); else cell.classList.remove('cycle-overload');
      });
    }

    // render backlog
    const bl = document.getElementById('backlogList2');
    clear(bl);
    const byIdPlaced = new Set();
    for (const [week,slots] of Object.entries(sdata.grid)){
      ['t1','t2','t3'].forEach(slot=> (slots[slot]||[]).forEach(id=>byIdPlaced.add(id)));
    }
    const imp = document.getElementById('impactoFilter2').value;
    const ab = document.getElementById('abordagemFilter2').value;
    const esc = document.getElementById('escopoFilter2').value;
    const pr = document.getElementById('principalFilter2').value;
    const squadPlanSel = document.getElementById('squadPlanSel').value;
    const squadBacklogSel = document.getElementById('squadBacklogSel').value;
    const subBack = document.getElementById('subSquadBacklogSel')?.value || '__ALL__';
    const urg = document.getElementById('urgenciaFilter2').value;
    const et = document.getElementById('esforcoTecnicoFilter2').value;
    const filtered = sortItems(state.items).filter(it=>{
      if (byIdPlaced.has(it.id)) return false;
      const iok = imp==='all' || it.impactClass===imp;
      const abOk = ab==='all' || (it.abordagemClass||'Outros')===ab;
      const escOk = esc==='all' || (it.escopoClass||'Outros')===esc;
      const prOk = pr==='all' || (it.principalImpactClass||'Outros')===pr;
      // backlog-specific squad + subSquad filters
      const sok = (squadBacklogSel==='__ALL__') || !squadBacklogSel || it.squad===squadBacklogSel;
      const subOk = (subBack==='__ALL__') || (subBack==='__NONE__' ? !(it.subSquad && it.subSquad.trim()) : it.subSquad===subBack);
      const uok = urg==='all' || String((it.urgencia ?? 0)) === urg;
      const etOk = et==='all' || (et==='Sem' ? (it.effortClass==null) : (it.effortClass===et));
      return iok && abOk && escOk && prOk && sok && subOk && uok && etOk;
    });
    filtered.forEach(it=> bl.appendChild(card(it)));

    const vc = document.getElementById('visibleCountStep2');
    if (vc) vc.textContent = String(filtered.length);

    // enable dropping back to backlog
    const backlogAside = document.getElementById('backlog2');
    if (backlogAside && !backlogAside._dndBound) {
      backlogAside.addEventListener('dragover', ev=>{ ev.preventDefault(); backlogAside.classList.add('drag-over'); });
      backlogAside.addEventListener('dragleave', ()=> backlogAside.classList.remove('drag-over'));
      backlogAside.addEventListener('drop', ev=>{
        ev.preventDefault(); backlogAside.classList.remove('drag-over');
        const id = Number(ev.dataTransfer.getData('text/plain'));
        const sdata = getSquadData();
        removeFromAllSlots(sdata, id);
        render();
        persistGrid();
      });
      backlogAside._dndBound = true;
    }
  }

  function card(item){
    const c = el('div','card',{ draggable: 'true', 'data-id': item.id });
    // classes de cor
    if (item.abordagemClass === 'Problema') c.classList.add('card--problema');
    else if (item.abordagemClass === 'Oportunidade') c.classList.add('card--oportunidade');
    if (item.escopoClass === 'Operação') c.classList.add('card--operacao');
    else if (item.escopoClass === 'Inovação') c.classList.add('card--inovacao');

    const title = el('div','card-title'); title.textContent = item.demanda || '(sem título)';
    const meta = el('div','card-meta');
    const p1 = el('span','pill'); p1.textContent = `Impacto: ${item.impactClass||'—'}`;
    const p2 = el('span','pill'); p2.textContent = `Esforço: ${item.effortClass||'—'}`;
    const p3 = el('span','pill'); p3.textContent = `Squad: ${item.squad||'—'}`;
    meta.appendChild(p1); meta.appendChild(p2); meta.appendChild(p3);
    const badges = el('div','card-badges');
    const tipoBadge = el('span','badge');
    const tipoLabel = item.tipoEsforco ? item.tipoEsforco : '-';
    if (tipoLabel === 'Tarefa') tipoBadge.classList.add('badge--tarefa');
    else if (tipoLabel === 'Iniciativa') tipoBadge.classList.add('badge--iniciativa');
    else if (tipoLabel === 'Ideia') tipoBadge.classList.add('badge--ideia');
    else if (tipoLabel === 'Follow-up') tipoBadge.classList.add('badge--follow');
    tipoBadge.textContent = `tipo esf.: ${tipoLabel}`;
    badges.appendChild(tipoBadge);
    if ((item.subSquad||'').trim()) {
      const ss = el('span','badge'); ss.textContent = `SubSquad: ${(item.subSquad||'').trim()}`; badges.appendChild(ss);
    }
    const urgBadge = el('span','badge');
    urgBadge.textContent = `Urgência: ${item.urgencia ?? 0}`;
    badges.appendChild(urgBadge);

    c.appendChild(title); c.appendChild(meta); c.appendChild(badges);
    // radar + progresso
    const radar = el('div','card-radar' + (item.andamento ? ' on' : ''));
    c.appendChild(radar);
    const footer = el('div','card-footer');
    const progress = el('div','progress');
    const bar = el('div','progress-bar'); bar.style.width = `${item.progresso ?? 0}%`; progress.appendChild(bar);
    const label = el('div','progress-label'); label.textContent = `${item.progresso ?? 0}%`;
    footer.appendChild(progress); footer.appendChild(label);
    c.appendChild(footer);

    c.addEventListener('dragstart',ev=>{ ev.dataTransfer.setData('text/plain', String(item.id)); ev.dataTransfer.effectAllowed='move'; });
    return c;
  }

  function exportCsv(){
    const rows = [['Squad','Ciclo','Tarefa1','Tarefa2','Tarefa3','SubSquad1','SubSquad2','SubSquad3']];
    // export all squads
    const rowsBySquad = [];
    for (const [squad, data] of Object.entries(state.grids)){
      const weeks = Object.keys(data.grid).sort((a,b)=>{
      const na = Number(a.replace(/\D+/g,''));
      const nb = Number(b.replace(/\D+/g,''));
      return na - nb;
      });
      for (const week of weeks){
        const slots = data.grid[week];
        const ids = [slots.t1?.[0], slots.t2?.[0], slots.t3?.[0]];
        const items = ids.map(id=> state.items.find(x=>x.id===id));
        const names = items.map(it=> it?.demanda || '');
        const subs = items.map(it=> it?.subSquad || '');
        rows.push([squad, week, ...names, ...subs]);
      }
    }
    const esc = (v)=>{
      v = v==null? '': String(v);
      if (v.includes('"')) v = v.replace(/"/g,'""');
      if (/,|\n|\r|"/.test(v)) return `"${v}"`;
      return v;
    };
    const csv = rows.map(r=> r.map(esc).join(',')).join('\n');
    const blob = new Blob([csv],{type:'text/csv;charset=utf-8;'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'planejamento_ciclos.csv'; a.click();
    URL.revokeObjectURL(url);
  }

  function persistGrid(){
    try {
      const payload = JSON.stringify({ grids: state.grids, currentSquad: state.currentSquad });
      localStorage.setItem('priorizacao_step2', payload);
    } catch(e){ /* noop */ }
  }

  // Filters persistence (Step 2)
  function persistFilters2(){
    try {
      const vals = {
        impacto: document.getElementById('impactoFilter2')?.value || 'all',
        abordagem: document.getElementById('abordagemFilter2')?.value || 'all',
        escopo: document.getElementById('escopoFilter2')?.value || 'all',
        principal: document.getElementById('principalFilter2')?.value || 'all',
        urgencia: document.getElementById('urgenciaFilter2')?.value || 'all',
        esforcoTecnico: document.getElementById('esforcoTecnicoFilter2')?.value || 'all',
        squadBacklog: document.getElementById('squadBacklogSel')?.value || '__ALL__',
        subSquadBacklog: document.getElementById('subSquadBacklogSel')?.value || '__ALL__',
      };
      localStorage.setItem('priorizacao_filters_step2', JSON.stringify(vals));
    } catch(e){ /* noop */ }
  }
  function loadFilters2(){
    try {
      const raw = localStorage.getItem('priorizacao_filters_step2');
      if (!raw) return;
      const vals = JSON.parse(raw);
      const set = (id,val)=>{ const el=document.getElementById(id); if (el && typeof val!== 'undefined') el.value = val; };
      set('impactoFilter2', vals.impacto);
      set('abordagemFilter2', vals.abordagem);
      set('escopoFilter2', vals.escopo);
      set('principalFilter2', vals.principal);
      set('urgenciaFilter2', vals.urgencia);
      set('esforcoTecnicoFilter2', vals.esforcoTecnico);
      set('squadBacklogSel', vals.squadBacklog);
      set('subSquadBacklogSel', vals.subSquadBacklog);
    } catch(e){ /* noop */ }
  }

  // Init
  window.addEventListener('DOMContentLoaded', ()=>{
    loadItems();
    ensureWeeks();
    // render will be called after filters load

    // populate squads select
    const squadSel = document.getElementById('squadPlanSel');
    const squadBackSel = document.getElementById('squadBacklogSel');
    const subBackSel = document.getElementById('subSquadBacklogSel');
    while (squadSel.firstChild) squadSel.removeChild(squadSel.firstChild);
    while (squadBackSel.firstChild) squadBackSel.removeChild(squadBackSel.firstChild);
    while (subBackSel.firstChild) subBackSel.removeChild(subBackSel.firstChild);
    // Add 'Todas' for reset targeting
    const allOpt = document.createElement('option'); allOpt.value='__ALL__'; allOpt.textContent='Todas (Squads)'; squadSel.appendChild(allOpt);
    const allOpt2 = document.createElement('option'); allOpt2.value='__ALL__'; allOpt2.textContent='Todas (Backlog)'; squadBackSel.appendChild(allOpt2);
    state.squads.forEach(s=>{ const o=document.createElement('option'); o.value=s; o.textContent=s; squadSel.appendChild(o); });
    state.squads.forEach(s=>{ const o=document.createElement('option'); o.value=s; o.textContent=s; squadBackSel.appendChild(o); });
    // populate subSquads from items
    const subs = Array.from(new Set(state.items.map(it=> (it.subSquad||'').trim()).filter(Boolean))).sort();
    const allSub = document.createElement('option'); allSub.value='__ALL__'; allSub.textContent='Todas (SubSquad)'; subBackSel.appendChild(allSub);
    const noneSub = document.createElement('option'); noneSub.value='__NONE__'; noneSub.textContent='Sem subSquad'; subBackSel.appendChild(noneSub);
    subs.forEach(v=>{ const o=document.createElement('option'); o.value=v; o.textContent=v; subBackSel.appendChild(o); });
    if (state.currentSquad && state.squads.includes(state.currentSquad)) squadSel.value = state.currentSquad;
    squadSel.addEventListener('change', ()=>{
      const val = squadSel.value;
      if (val === '__ALL__') { // do not change current view
        return;
      }
      state.currentSquad = val;
      ensureWeeks(); render(); persistGrid();
    });

    const bind = (id)=>{ const el=document.getElementById(id); if (el) el.addEventListener('change', ()=>{ persistFilters2(); render(); }); };
    ['impactoFilter2','abordagemFilter2','escopoFilter2','principalFilter2','urgenciaFilter2','esforcoTecnicoFilter2','squadBacklogSel','subSquadBacklogSel'].forEach(bind);
    document.getElementById('addWeekBtn').addEventListener('click', ()=>{ const sdata=getSquadData(); sdata.weeks += 1; ensureWeeks(); render(); persistGrid(); });
    document.getElementById('exportWeeksBtn').addEventListener('click', exportCsv);
    document.getElementById('resetFilters2Btn').addEventListener('click', ()=>{
      const set=(id,val)=>{ const el=document.getElementById(id); if (el) el.value=val; };
      set('impactoFilter2','all'); set('abordagemFilter2','all'); set('escopoFilter2','all'); set('principalFilter2','all'); set('urgenciaFilter2','all'); set('esforcoTecnicoFilter2','all');
      persistFilters2(); render();
    });
    document.getElementById('resetPlanBtn').addEventListener('click', ()=>{
      const val = squadSel.value;
      if (val === '__ALL__') {
        state.squads.forEach(s=>{ state.grids[s] = { weeks: 5, grid: {} }; });
      } else {
        const s = val || state.currentSquad;
        if (s) state.grids[s] = { weeks: 5, grid: {} };
      }
      ensureWeeks(); render(); persistGrid();
    });
    document.getElementById('backToStep1').addEventListener('click', ()=>{ window.location.href = 'index.html'; });

    // Load saved filters after DOM is ready, then render
    loadFilters2();
    // restore backlog squad if persisted
    try { const raw = localStorage.getItem('priorizacao_filters_step2'); if (raw){ const v=JSON.parse(raw); if (v && v.squadBacklog) { const el=document.getElementById('squadBacklogSel'); if (el) el.value=v.squadBacklog; } } } catch(e){}
    render();
  });
})();
