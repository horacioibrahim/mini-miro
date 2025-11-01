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
    const esf = document.getElementById('esforcoFilter2').value;
    const squadSel = document.getElementById('squadPlanSel').value;
    const urg = document.getElementById('urgenciaFilter2').value;
    const filtered = sortItems(state.items).filter(it=>{
      if (byIdPlaced.has(it.id)) return false;
      const iok = imp==='all' || it.impactClass===imp;
      const eok = esf==='all' || it.effortClass===esf;
      const sok = !squadSel || it.squad===squadSel;
      const uok = urg==='all' || String(it.urgencia??'') === urg;
      return iok && eok && sok && uok;
    });
    filtered.forEach(it=> bl.appendChild(card(it)));

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
    else if (tipoLabel === 'Follow-up') tipoBadge.classList.add('badge--follow');
    tipoBadge.textContent = `tipo esf.: ${tipoLabel}`;
    badges.appendChild(tipoBadge);

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
    const rows = [['Squad','Ciclo','Tarefa1','Tarefa2','Tarefa3']];
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
        rows.push([squad, week, ...names]);
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

  // Init
  window.addEventListener('DOMContentLoaded', ()=>{
    loadItems();
    ensureWeeks();
    render();

    // populate squads select
    const squadSel = document.getElementById('squadPlanSel');
    while (squadSel.firstChild) squadSel.removeChild(squadSel.firstChild);
    // Add 'Todas' for reset targeting
    const allOpt = document.createElement('option'); allOpt.value='__ALL__'; allOpt.textContent='Todas (Squads)'; squadSel.appendChild(allOpt);
    state.squads.forEach(s=>{ const o=document.createElement('option'); o.value=s; o.textContent=s; squadSel.appendChild(o); });
    if (state.currentSquad && state.squads.includes(state.currentSquad)) squadSel.value = state.currentSquad;
    squadSel.addEventListener('change', ()=>{
      const val = squadSel.value;
      if (val === '__ALL__') { // do not change current view
        return;
      }
      state.currentSquad = val;
      ensureWeeks(); render(); persistGrid();
    });

    document.getElementById('impactoFilter2').addEventListener('change', render);
    document.getElementById('esforcoFilter2').addEventListener('change', render);
    document.getElementById('addWeekBtn').addEventListener('click', ()=>{ const sdata=getSquadData(); sdata.weeks += 1; ensureWeeks(); render(); persistGrid(); });
    document.getElementById('exportWeeksBtn').addEventListener('click', exportCsv);
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
  });
})();
