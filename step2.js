// Step 2 - Weekly Planning
(function(){
  const state = {
    items: [], // from etapa 1
    filters: { impacto: 'all', esforco: 'all' },
    weeks: 5, // default
    grid: {}, // { 'Sem 1': { t1: [id...], t2: [], t3: [] }, ... }
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
        if (parsed2 && parsed2.grid) state.grid = parsed2.grid;
        if (parsed2 && parsed2.weeks) state.weeks = parsed2.weeks;
      }
    } catch(e) { /* noop */ }
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

  function ensureWeeks(){
    const board = document.getElementById('weeksBoard');
    clear(board);
    // headers
    board.appendChild(el('div','y-label empty'));
    board.appendChild(el('div','x-header')).textContent='Tarefa 1';
    board.appendChild(el('div','x-header')).textContent='Tarefa 2';
    board.appendChild(el('div','x-header')).textContent='Tarefa 3';

    for (let i=1;i<=state.weeks;i++){
      const weekKey = `Sem ${i}`;
      if (!state.grid[weekKey]) state.grid[weekKey] = { t1: [], t2: [], t3: [] };
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
      // keep one per slot: clear previous items in this slot
      state.grid[week][slot] = [id];
      render();
      persistGrid();
    });
  }

  function render(){
    // render weeks grid slots
    const board = document.getElementById('weeksBoard');
    const cells = Array.from(board.querySelectorAll('.cell'));
    cells.forEach(c=>clear(c));

    for (const [week,slots] of Object.entries(state.grid)){
      for (const slot of ['t1','t2','t3']){
        const ids = slots[slot] || [];
        const target = board.querySelector(`.cell[data-week="${week}"][data-slot="${slot}"]`);
        ids.forEach(id=>{
          const it = state.items.find(x=>x.id===id);
          if (!it) return;
          target.appendChild(card(it));
        });
      }
    }

    // render backlog
    const bl = document.getElementById('backlogList2');
    clear(bl);
    const byIdPlaced = new Set();
    for (const [week,slots] of Object.entries(state.grid)){
      ['t1','t2','t3'].forEach(slot=> (slots[slot]||[]).forEach(id=>byIdPlaced.add(id)));
    }
    const imp = document.getElementById('impactoFilter2').value;
    const esf = document.getElementById('esforcoFilter2').value;
    const filtered = sortItems(state.items).filter(it=>{
      if (byIdPlaced.has(it.id)) return false;
      const iok = imp==='all' || it.impactClass===imp;
      const eok = esf==='all' || it.effortClass===esf;
      return iok && eok;
    });
    filtered.forEach(it=> bl.appendChild(card(it)));
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
    const rows = [['Squad','Semana','Tarefa1','Tarefa2','Tarefa3']];
    const weeks = Object.keys(state.grid).sort((a,b)=>{
      const na = Number(a.replace(/\D+/g,''));
      const nb = Number(b.replace(/\D+/g,''));
      return na - nb;
    });
    for (const week of weeks){
      const slots = state.grid[week];
      const ids = [slots.t1?.[0], slots.t2?.[0], slots.t3?.[0]];
      const items = ids.map(id=> state.items.find(x=>x.id===id));
      const squads = items.map(it=> it?.squad || '').filter(Boolean);
      const squad = squads[0] || '';
      const names = items.map(it=> it?.demanda || '');
      rows.push([squad, week, ...names]);
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
    a.href = url; a.download = 'planejamento_semanas.csv'; a.click();
    URL.revokeObjectURL(url);
  }

  function persistGrid(){
    try {
      const payload = JSON.stringify({ grid: state.grid, weeks: state.weeks });
      localStorage.setItem('priorizacao_step2', payload);
    } catch(e){ /* noop */ }
  }

  // Init
  window.addEventListener('DOMContentLoaded', ()=>{
    loadItems();
    ensureWeeks();
    render();

    document.getElementById('impactoFilter2').addEventListener('change', render);
    document.getElementById('esforcoFilter2').addEventListener('change', render);
    document.getElementById('addWeekBtn').addEventListener('click', ()=>{ state.weeks += 1; ensureWeeks(); render(); persistGrid(); });
    document.getElementById('exportWeeksBtn').addEventListener('click', exportCsv);
    document.getElementById('backToStep1').addEventListener('click', ()=>{ window.location.href = 'index.html'; });
  });
})();
