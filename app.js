// Data state
const state = {
  items: [], // { id, demanda, squad, observation, parentId, relatedIds: number[], effortRaw, impactRaw, abordagemRaw, escopoRaw, principalImpacto, principalImpactClass, tipoEsforco, progresso, andamento }
  filters: { abordagem: 'all', escopo: 'all', principal: 'all', tipo: 'all', urgencia: 'all', esforcoTecnico: 'all', subSquad: [], squad: [], groups: [], text: '', showRelations: false },
  ui: { isDragging: false, selectedId: null },
};

// Persistence (Etapa 1): save/load full items to localStorage so both steps share state
function persistState() {
  try {
    const payload = JSON.stringify({ version: 2, items: state.items });
    localStorage.setItem('priorizacao_state', payload);
  } catch (e) { /* ignore */ }
}

function loadPersistedState() {
  try {
    const raw = localStorage.getItem('priorizacao_state');
    if (!raw) return false;
    const parsed = JSON.parse(raw);
    if (parsed && Array.isArray(parsed.items)) {
      state.items = parsed.items.map(it => ({ ...it }));
      return true;
    }
  } catch (e) { /* ignore */ }
  return false;
}

// Filters persistence (Step 1)
function persistFiltersStep1() {
  try {
    localStorage.setItem('priorizacao_filters_step1', JSON.stringify(state.filters));
  } catch (e) { /* noop */ }
}

function loadFiltersStep1() {
  try {
    const raw = localStorage.getItem('priorizacao_filters_step1');
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (!parsed) return;
    state.filters = { ...state.filters, ...parsed };
    // apply to UI controls if present
    const setVal = (id, val)=>{ const el=document.getElementById(id); if (el && typeof val!== 'undefined') el.value = val; };
    setVal('abordagemFilter', state.filters.abordagem);
    setVal('escopoFilter', state.filters.escopo);
    setVal('principalFilter', state.filters.principal);
    setVal('tipoEsforcoFilter', state.filters.tipo);
    setVal('urgenciaFilter', state.filters.urgencia);
    // subSquad is multi-select via dropdown; UI label updated dynamically
    setVal('esforcoTecnicoFilter', state.filters.esforcoTecnico);
    const tf = document.getElementById('textFilter'); if (tf) tf.value = state.filters.text || '';
    const rt = document.getElementById('relationsToggle'); if (rt) rt.checked = !!state.filters.showRelations;
    // multi dropdowns
    updateSquadButtonLabel && updateSquadButtonLabel();
    const gb = document.getElementById('groupDropdownBtn'); if (gb) {
      // trigger label update via render()->summary, or rebuild list when opened
    }
  } catch(e){ /* noop */ }
}

// Column header names (exact CSV headers expected)
const HEADERS = {
  DEMANDA: 'Demanda',
  SQUAD: 'Squad',
  ESFORCO: 'Esforço técnico para entregar em produção',
  IMPACTO: 'Qual o impacto econômico que poderá trazer?',
  OBS_ADICIONAIS: 'Observações adicionais',
  PRINCIPAL_IMPACTO:
    'Principal Impacto (pensando em visibilidade a demanda é mais mercado, mais user ou mais plataforma-arquitetura-tecnologia)?',
  DEMANDA_DESC: 'Demanda descrição',
  ANDAMENTO: 'Andamento',
  PROGRESSO: 'Progresso',
  TIPO_ESFORCO: 'Tipo de esforço',
  URGENCIA: 'Urgencia',
  SUBSQUAD: 'SubSquad',
  ABORDAGEM:
    'Qual o tipo de abordagem (tratar como problema ou oportunidade) [problema = interno e repetido; oportunidade = externo e competição]',
  ESCOPO:
    'Qual o tipo de escopo (operação: core ou o que já fazemos, melhorias, correções; inovação não temos ou conhecemos parcialmente)?',
};

// Normalization helpers
function normalizeString(value) {
  if (value == null) return '';
  return String(value)
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '');
}

// Header normalization for CSV column comparisons (aggressive: remove non-alphanum)
function normalizeHeaderKey(value){
  return normalizeString(value).replace(/[^a-z0-9]+/g,'');
}

function classifyEffort(esforcoRaw) {
  const n = normalizeString(esforcoRaw);
  if (!n) return null;
  if (n.startsWith('baixo')) return 'Baixo';
  if (n.startsWith('medio')) return 'Médio';
  if (n.startsWith('alto')) return 'Alto';
  return null;
}

function classifyImpact(impactoRaw) {
  const n = normalizeString(impactoRaw);
  if (!n) return null;
  if (n.startsWith('baix')) return 'Baixo';
  if (n.startsWith('medi')) return 'Médio';
  // Specific order: altissimo first to not match "alto" prematurely
  if (n.startsWith('altissimo')) return 'Altíssimo';
  if (n.startsWith('alto')) return 'Alto';
  return null;
}

function classifyAbordagem(raw) {
  const n = normalizeString(raw);
  if (!n) return 'Outros';
  if (n.includes('oportunidade')) return 'Oportunidade';
  if (n.includes('problema')) return 'Problema';
  return 'Outros';
}

function classifyEscopo(raw) {
  const n = normalizeString(raw);
  if (!n) return 'Outros';
  if (n.includes('inovacao')) return 'Inovação';
  if (n.includes('operacao') || n.includes('operacional') || n.includes('core')) return 'Operação';
  return 'Outros';
}

function classifyPrincipalImpact(raw) {
  const n = normalizeString(raw);
  if (!n) return 'Outros';
  if (n.includes('mercado') || n.includes('lei') || n.includes('compliance') || n.includes('cliente') || n.includes('competic')) return 'Mercado';
  if (n.includes('plataforma') || n.includes('tecnolog') || n.includes('escala') || n.includes('disponibilidade') || n.includes('produtividade') || n.includes('arquitetura') || n.includes('barreira')) return 'Plataforma';
  if (n.includes('experien') || n.includes('jornada') || n.includes('engaj') || n.includes('retenc') || n.includes('usuario') || n.includes('user')) return 'Experiência';
  return 'Outros';
}

function parseAndamento(raw) {
  const n = normalizeString(raw);
  if (!n) return false;
  return n.startsWith('sim') || n === 'true' || n === '1';
}

function parseProgresso(raw) {
  if (raw == null) return 0;
  const s = String(raw).trim();
  // Remove símbolo de % se houver
  const noPct = s.replace('%','').trim();
  const n = Number(noPct);
  if (!Number.isFinite(n)) return 0;
  // Se valor vier entre 0 e 1 (Sheets com formato decimal), converte para %
  if (n >= 0 && n <= 1 && s.indexOf('%') === -1) return Math.round(n * 100);
  // Caso geral: já é percentual 0..100
  return Math.min(100, Math.max(0, Math.round(n)));
}

function classifyTipoEsforco(raw) {
  const n = normalizeString(raw);
  if (!n) return null;
  if (n.includes('tarefa')) return 'Tarefa';
  if (n.includes('iniciat')) return 'Iniciativa';
  if (n.includes('idei')) return 'Ideia';
  if (n.includes('follow')) return 'Follow-up';
  return null;
}

// Basic CSV parser supporting quotes
function parseCsv(text) {
  const rows = [];
  let i = 0;
  const len = text.length;
  let current = '';
  let row = [];
  let inQuotes = false;

  function endCell() {
    row.push(current);
    current = '';
  }
  function endRow() {
    rows.push(row);
    row = [];
  }

  while (i < len) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          current += '"';
          i += 2;
          continue;
        } else {
          inQuotes = false;
          i++;
          continue;
        }
      } else {
        current += ch;
        i++;
        continue;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
        i++;
        continue;
      }
      if (ch === ',') {
        endCell();
        i++;
        continue;
      }
      if (ch === '\n') {
        endCell();
        endRow();
        i++;
        continue;
      }
      if (ch === '\r') { // handle CRLF
        i++;
        continue;
      }
      current += ch;
      i++;
    }
  }
  // flush last cell/row
  endCell();
  if (row.length) endRow();
  return rows;
}

function rowsToObjects(rows) {
  if (!rows.length) return [];
  const headers = rows[0].map(h => h.trim());
  return rows.slice(1).filter(r => r.some(c => String(c).trim() !== '')).map(r => {
    const obj = {};
    headers.forEach((h, idx) => { obj[h] = r[idx] ?? ''; });
    return obj;
  });
}

// Try multiple header variants, including case/diacritic-insensitive
function valueByPossibleKeys(obj, candidates) {
  for (const key of candidates) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) return obj[key];
  }
  const normalizedToOriginal = {};
  for (const k of Object.keys(obj)) normalizedToOriginal[normalizeString(k)] = k;
  for (const key of candidates) {
    const nk = normalizeString(key);
    if (nk in normalizedToOriginal) return obj[normalizedToOriginal[nk]];
  }
  return undefined;
}

// DOM helpers
function el(tag, className, attrs = {}) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  Object.entries(attrs).forEach(([k, v]) => e.setAttribute(k, v));
  return e;
}

function clearChildren(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

// Rendering
function render() {
  const abordagemFilter = state.filters.abordagem;
  const escopoFilter = state.filters.escopo;
  const principalFilter = state.filters.principal;
  const tipoFilter = state.filters.tipo;
  const urgenciaFilter = state.filters.urgencia;
  const subSquadSel = state.filters.subSquad || [];
  const squadFilter = state.filters.squad;
  const textFilter = normalizeString(state.filters.text || '');

  // Prepare containers
  const board = document.getElementById('board');
  const cells = Array.from(board.querySelectorAll('.cell'));
  const backlogList = document.getElementById('backlogList');
  cells.forEach(c => clearChildren(c));
  clearChildren(backlogList);

  // filter function
  const passFilters = (item) => {
    const a = item.abordagemClass || 'Outros';
    const e = item.escopoClass || 'Outros';
    const p = item.principalImpactClass || 'Outros';
    const s = item.squad || 'Outros';
    const t = item.tipoEsforco || '-';
    const u = item.urgencia ?? 0;
    const abordagemOk = abordagemFilter === 'all' || a === abordagemFilter;
    const escopoOk = escopoFilter === 'all' || e === escopoFilter;
    const principalOk = principalFilter === 'all' || p === principalFilter;
    const tipoOk = tipoFilter === 'all' || t === tipoFilter;
    const et = state.filters.esforcoTecnico || 'all';
    const esforcoTecnicoOk = et === 'all' || (et === 'Sem' ? (item.effortClass == null) : (item.effortClass === et));
    const urgOk = urgenciaFilter === 'all' || String(u) === String(urgenciaFilter);
    const squadOk = !Array.isArray(squadFilter) || squadFilter.length === 0
      ? true
      : squadFilter.includes(s);
    const groupsSel = state.filters.groups || [];
    const gname = (item.grupo || '').trim();
    const groupOk = groupsSel.length === 0 || groupsSel.includes(gname || '__NONE__');
    const ss = (item.subSquad || '').trim();
    const subOk = (subSquadSel.length===0) || subSquadSel.includes(ss || '__NONE__');
    const textOk = !textFilter
      || normalizeString(item.demanda).includes(textFilter)
      || normalizeString(item.demandaDescricao || '').includes(textFilter);
    return abordagemOk && escopoOk && principalOk && tipoOk && urgOk && squadOk && groupOk && subOk && esforcoTecnicoOk && textOk;
  };

  // Count visible after filters (independent of placement)
  let visibleCount = 0;
  try {
    visibleCount = state.items.reduce((acc, it) => acc + (passFilters(it) ? 1 : 0), 0);
  } catch (_) {}
  const vc = document.getElementById('visibleCountStep1');
  if (vc) vc.textContent = String(visibleCount);
  const gs = document.getElementById('groupSummary');
  if (gs) {
    const sel = state.filters.groups || [];
    if (sel.length === 0) gs.textContent = 'nenhum';
    else if (sel.length === 1) gs.textContent = sel[0] === '__NONE__' ? 'nenhum' : sel[0];
    else gs.textContent = 'múltiplos';
  }

  // Place items
  for (const item of state.items) {
    const card = renderCard(item);
    if (!passFilters(item)) {
      // hide card if filtered out
      card.style.display = 'none';
    }

    if (!item.effortClass || !item.impactClass) {
      backlogList.appendChild(card);
      continue;
    }

    const target = cells.find(c =>
      c.dataset.effort === item.effortClass && c.dataset.impact === item.impactClass
    );
    if (target) {
      target.appendChild(card);
    } else {
      backlogList.appendChild(card);
    }
  }

  drawRelations();
}

// Populate SubSquad filter options dynamically
function populateSubSquadFilter(){
  const sel = document.getElementById('subSquadFilter');
  if (!sel) return;
  const keep = sel.value;
  const set = new Set();
  for (const it of state.items){ const v=(it.subSquad||'').trim(); if (v) set.add(v); }
  const values = Array.from(set).sort();
  sel.innerHTML = '';
  const mk=(val,txt)=>{ const o=document.createElement('option'); o.value=val; o.textContent=txt; return o; };
  sel.appendChild(mk('all','Todas'));
  sel.appendChild(mk('__NONE__','Sem subSquad'));
  values.forEach(v=> sel.appendChild(mk(v, v)));
  if (keep) sel.value = keep;
}

// Build list of items that pass current filters (Step 1)
function filteredItemsForVote() {
  const abordagemFilter = state.filters.abordagem;
  const escopoFilter = state.filters.escopo;
  const principalFilter = state.filters.principal;
  const tipoFilter = state.filters.tipo;
  const urgenciaFilter = state.filters.urgencia;
  const squadFilter = state.filters.squad;
  const textFilter = normalizeString(state.filters.text || '');
  const et = state.filters.esforcoTecnico || 'all';
  return state.items.filter(item => {
    const a = item.abordagemClass || 'Outros';
    const e = item.escopoClass || 'Outros';
    const p = item.principalImpactClass || 'Outros';
    const s = item.squad || 'Outros';
    const t = item.tipoEsforco || '-';
    const u = item.urgencia ?? 0;
    const abordagemOk = abordagemFilter === 'all' || a === abordagemFilter;
    const escopoOk = escopoFilter === 'all' || e === escopoFilter;
    const principalOk = principalFilter === 'all' || p === principalFilter;
    const tipoOk = tipoFilter === 'all' || t === tipoFilter;
    const esforcoTecnicoOk = et === 'all' || (et === 'Sem' ? (item.effortClass == null) : (item.effortClass === et));
    const urgOk = urgenciaFilter === 'all' || String(u) === String(urgenciaFilter);
    const squadOk = !Array.isArray(squadFilter) || squadFilter.length === 0 ? true : squadFilter.includes(s);
    const groupsSel = state.filters.groups || [];
    const gname = (item.grupo || '').trim();
    const groupOk = groupsSel.length === 0 || groupsSel.includes(gname || '__NONE__');
    const textOk = !textFilter
      || normalizeString(item.demanda).includes(textFilter)
      || normalizeString(item.demandaDescricao || '').includes(textFilter);
    return abordagemOk && escopoOk && principalOk && tipoOk && urgOk && squadOk && groupOk && esforcoTecnicoOk && textOk;
  });
}

function openVoteOverlay() {
  const overlay = document.getElementById('voteOverlay');
  const grid = document.getElementById('voteGrid');
  const count = document.getElementById('voteCount');
  if (!overlay || !grid) return;
  // build cards
  grid.innerHTML = '';
  const items = filteredItemsForVote();
  if (count) count.textContent = `(${items.length})`;
  for (const item of items) {
    const c = document.createElement('div'); c.className = 'vote-card'; c.setAttribute('data-id', String(item.id));
    // urgency quick menu will go in footer
    const menu = document.createElement('div'); menu.className = 'vote-urg-menu';
    for (let n=0;n<=5;n++){
      const b = document.createElement('button'); b.type='button'; b.className = 'vote-urg-btn'; b.textContent = String(n);
      if (Number(item.urgencia ?? 0) === n) b.classList.add('active');
      b.addEventListener('click', (ev)=>{
        ev.stopPropagation();
        item.urgencia = n;
        try { persistState(); } catch(_){ }
        // update active state + badge text
        menu.querySelectorAll('.vote-urg-btn').forEach(x=>x.classList.remove('active'));
        b.classList.add('active');
        const ub = c.querySelector('.badge-Urg'); if (ub) ub.textContent = `Urgência: ${n}`;
      });
      menu.appendChild(b);
    }
    // title
    const title = document.createElement('div'); title.className='vote-card-title'; title.textContent = item.demanda || '(sem título)'; c.appendChild(title);
    // desc
    const desc = document.createElement('div'); desc.className='vote-card-desc'; desc.textContent = item.demandaDescricao || ''; c.appendChild(desc);
    // badges
    const badges = document.createElement('div'); badges.className='vote-badges';
    // tipo esforço
    const tipo = document.createElement('span'); tipo.className='badge';
    const tl = item.tipoEsforco || '-';
    if (tl === 'Tarefa') tipo.classList.add('badge--tarefa');
    else if (tl === 'Iniciativa') tipo.classList.add('badge--iniciativa');
    else if (tl === 'Ideia') tipo.classList.add('badge--ideia');
    else if (tl === 'Follow-up') tipo.classList.add('badge--follow');
    tipo.textContent = `tipo esf.: ${tl}`;
    badges.appendChild(tipo);
    const urg = document.createElement('span'); urg.className='badge badge-Urg'; urg.textContent = `Urgência: ${item.urgencia ?? 0}`; badges.appendChild(urg);
    c.appendChild(badges);
    // footer with urgency + bora buttons
    const footer = document.createElement('div'); footer.className='vote-card-footer';
    footer.appendChild(menu);
    // Bora buttons
    const bora = document.createElement('div'); bora.className = 'vote-bora-menu';
    const boraVals = ['0.25','0.5','1','2','3'];
    for (const v of boraVals){
      const bb = document.createElement('button'); bb.type='button'; bb.className='vote-bora-btn'; bb.textContent = v;
      if ((item.boraImpact || '') === v) bb.classList.add('active');
      bb.addEventListener('click', (ev)=>{
        ev.stopPropagation();
        item.boraImpact = v;
        try { persistState(); } catch(_){ }
        bora.querySelectorAll('.vote-bora-btn').forEach(x=>x.classList.remove('active'));
        bb.classList.add('active');
      });
      bora.appendChild(bb);
    }
    footer.appendChild(bora);
    c.appendChild(footer);
    grid.appendChild(c);

    // highlight selection
    c.addEventListener('click', ()=>{
      const isSel = c.classList.toggle('selected');
      if (isSel) overlay.classList.add('has-selection');
      else {
        if (!grid.querySelector('.vote-card.selected')) overlay.classList.remove('has-selection');
      }
    });
    // prevent button clicks from toggling selection
    footer.addEventListener('click',(ev)=>{
      if (ev.target.closest('.vote-urg-btn') || ev.target.closest('.vote-bora-btn')) {
        ev.stopPropagation();
      }
    });
  }
  // apply columns per line
  applyVoteCols();
  overlay.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function closeVoteOverlay() {
  const overlay = document.getElementById('voteOverlay');
  if (!overlay) return;
  overlay.classList.add('hidden');
  document.body.style.overflow = '';
  // re-render board to reflect any urgency badge changes
  render();
}

function applyVoteCols() {
  const grid = document.getElementById('voteGrid');
  const sel = document.getElementById('voteColsSel');
  if (!grid || !sel) return;
  const n = Number(sel.value) || 5;
  grid.style.gridTemplateColumns = `repeat(${n}, minmax(0, 1fr))`;
}

function persistVoteCols(){
  try {
    const sel = document.getElementById('voteColsSel');
    if (sel) localStorage.setItem('priorizacao_vote_cols', sel.value);
  } catch(_){}
}

// Draw dashed curved lines between related items, using closest edge centers
function drawRelations() {
  const svg = document.getElementById('relationsOverlay');
  if (!svg) return;
  // clear
  while (svg.firstChild) svg.removeChild(svg.firstChild);
  if (!state.filters.showRelations) return;

  const container = document.querySelector('.board-wrapper');
  if (!container) return;
  const contRect = container.getBoundingClientRect();
  svg.setAttribute('width', String(contRect.width));
  svg.setAttribute('height', String(contRect.height));
  svg.setAttribute('viewBox', `0 0 ${contRect.width} ${contRect.height}`);

  // map id -> element
  const idToEl = new Map();
  document.querySelectorAll('.card[data-id]').forEach(el => {
    const id = Number(el.getAttribute('data-id'));
    if (!Number.isNaN(id)) idToEl.set(id, el);
  });

  function edgeCenters(r) {
    return {
      left:   { x: r.left - contRect.left,          y: r.top - contRect.top + r.height / 2 },
      right:  { x: r.right - contRect.left,         y: r.top - contRect.top + r.height / 2 },
      top:    { x: r.left - contRect.left + r.width / 2, y: r.top - contRect.top },
      bottom: { x: r.left - contRect.left + r.width / 2, y: r.bottom - contRect.top },
    };
  }

  function attachPoints(aRect, bRect) {
    const aCenters = edgeCenters(aRect);
    const bCenters = edgeCenters(bRect);
    const candidates = [
      [aCenters.right, bCenters.left],
      [aCenters.left, bCenters.right],
      [aCenters.bottom, bCenters.top],
      [aCenters.top, bCenters.bottom],
    ];
    let best = candidates[0];
    let bestD2 = Infinity;
    for (const [s, t] of candidates) {
      const dx = t.x - s.x, dy = t.y - s.y;
      const d2 = dx*dx + dy*dy;
      if (d2 < bestD2) { bestD2 = d2; best = [s, t]; }
    }
    return best; // [sourcePoint, targetPoint]
  }

  function cubicPath(s, t) {
    const dx = t.x - s.x, dy = t.y - s.y;
    const o = 0.25; // smoothness
    let c1 = { x: s.x + dx * o, y: s.y };
    let c2 = { x: t.x - dx * o, y: t.y };
    // if vertical is stronger, bend vertically
    if (Math.abs(dy) > Math.abs(dx)) {
      c1 = { x: s.x, y: s.y + dy * o };
      c2 = { x: t.x, y: t.y - dy * o };
    }
    return `M ${s.x} ${s.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${t.x} ${t.y}`;
  }

  for (const item of state.items) {
    if (!item.relatedIds || !item.relatedIds.length) continue;
    const aEl = idToEl.get(item.id);
    if (!aEl) continue;
    const aRect = aEl.getBoundingClientRect();
    for (const rid of item.relatedIds) {
      if (rid <= item.id) continue; // avoid duplicates
      const bEl = idToEl.get(rid);
      if (!bEl) continue;
      const bRect = bEl.getBoundingClientRect();
      const [s, t] = attachPoints(aRect, bRect);
      const pathEl = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      pathEl.setAttribute('d', cubicPath(s, t));
      pathEl.setAttribute('fill', 'none');
      pathEl.setAttribute('stroke', '#ef4444');
      pathEl.setAttribute('stroke-width', '2');
      pathEl.setAttribute('stroke-dasharray', '6 6');
      pathEl.setAttribute('stroke-linecap', 'round');
      svg.appendChild(pathEl);
    }
  }
}

function renderCard(item) {
  const card = el('div', 'card', { draggable: 'true', 'data-id': item.id });
  const head = el('div', 'card-head');
  const title = el('div', 'card-title');
  title.textContent = item.demanda || '(sem título)';
  const actions = el('div', 'card-actions');
  const btnDoc = el('button', 'icon-btn', { title: 'Ver detalhes (sheet)' });
  btnDoc.textContent = '🗎';
  btnDoc.addEventListener('click', (e) => { e.stopPropagation(); openDetailSheet(item.id); });
  const btnObs = el('button', 'icon-btn', { title: 'Ver Observações adicionais' });
  btnObs.textContent = '💬';
  btnObs.addEventListener('click', (e) => { e.stopPropagation(); openObsModal(item.id); });
  const btnEdit = el('button', 'icon-btn', { title: 'Editar observação complementar' });
  btnEdit.textContent = '✎';
  btnEdit.addEventListener('click', (e) => { e.stopPropagation(); openNoteModal(item.id); });
  actions.appendChild(btnDoc);
  actions.appendChild(btnObs);
  actions.appendChild(btnEdit);
  head.appendChild(title);
  head.appendChild(actions);
  const meta = el('div', 'card-meta');

  // abordagem-based border color
  if (item.abordagemClass === 'Problema') {
    card.classList.add('card--problema');
  } else if (item.abordagemClass === 'Oportunidade') {
    card.classList.add('card--oportunidade');
  }

  // escopo-based background color
  if (item.escopoClass === 'Operação') {
    card.classList.add('card--operacao');
  } else if (item.escopoClass === 'Inovação') {
    card.classList.add('card--inovacao');
  }

  const effortPill = el('span', 'pill');
  effortPill.textContent = `Esforço: ${item.effortClass || '—'}`;
  const validEfforts = ['Baixo', 'Médio', 'Alto'];
  if (!validEfforts.includes(item.effortClass)) {
    effortPill.classList.add('pill--invalid');
  }
  const impactPill = el('span', 'pill');
  impactPill.textContent = `Impacto: ${item.impactClass || '—'}`;
  const abordagemPill = el('span', 'pill');
  abordagemPill.textContent = `Abordagem: ${item.abordagemClass || 'Outros'}`;
  const escopoPill = el('span', 'pill');
  escopoPill.textContent = `Escopo: ${item.escopoClass || 'Outros'}`;
  const squadPill = el('span', 'pill');
  squadPill.textContent = `Squad: ${item.squad || '—'}`;
  const principalBadge = el('span', 'badge');
  const pClass = item.principalImpactClass;
  if (pClass === 'Experiência') principalBadge.classList.add('badge--experiencia');
  else if (pClass === 'Mercado') principalBadge.classList.add('badge--mercado');
  else if (pClass === 'Plataforma') principalBadge.classList.add('badge--plataforma');
  principalBadge.textContent = pClass || 'Outros';
  const tipoBadge = el('span', 'badge');
  const tipoLabel = item.tipoEsforco ? item.tipoEsforco : '-';
  if (tipoLabel === 'Tarefa') tipoBadge.classList.add('badge--tarefa');
  else if (tipoLabel === 'Iniciativa') tipoBadge.classList.add('badge--iniciativa');
  else if (tipoLabel === 'Ideia') tipoBadge.classList.add('badge--ideia');
  else if (tipoLabel === 'Follow-up') tipoBadge.classList.add('badge--follow');
  tipoBadge.textContent = `tipo esf.: ${tipoLabel}`;
  if (item.observation && String(item.observation).trim() !== '') {
    const notePill = el('span', 'pill pill--note');
    notePill.textContent = 'Nota';
    meta.appendChild(notePill);
  }

  meta.appendChild(effortPill);
  meta.appendChild(impactPill);
  meta.appendChild(abordagemPill);
  meta.appendChild(escopoPill);
  meta.appendChild(squadPill);
  const badgesRow = el('div', 'card-badges');
  badgesRow.appendChild(principalBadge);
  badgesRow.appendChild(tipoBadge);
  if ((item.grupo || '').trim()) {
    const gBadge = el('span','badge'); gBadge.textContent = `Grupo: ${(item.grupo||'').trim()}`; badgesRow.appendChild(gBadge);
  }
  if ((item.subSquad || '').trim()) {
    const sBadge = el('span','badge'); sBadge.textContent = `SubSquad: ${(item.subSquad||'').trim()}`; badgesRow.appendChild(sBadge);
  }
  if ((item.boraImpact || '') !== '') {
    const bBadge = el('span','badge'); bBadge.textContent = `Bora: ${item.boraImpact}`; badgesRow.appendChild(bBadge);
  }
  const urgBadge = el('span', 'badge');
  urgBadge.textContent = `Urgência: ${item.urgencia ?? 0}`;
  badgesRow.appendChild(urgBadge);

  card.appendChild(head);
  card.appendChild(meta);
  card.appendChild(badgesRow);

  // radar indicator
  const radar = el('div', 'card-radar' + (item.andamento ? ' on' : ''));
  card.appendChild(radar);

  // progress footer
  const footer = el('div', 'card-footer');
  const progress = el('div', 'progress');
  const bar = el('div', 'progress-bar');
  const progVal = Math.max(0, Math.min(100, Number(item.progresso ?? 0)));
  bar.style.width = `${progVal}%`;
  progress.appendChild(bar);
  const label = el('div', 'progress-label');
  label.textContent = `${progVal}%`;
  footer.appendChild(progress);
  footer.appendChild(label);
  card.appendChild(footer);

  // DnD events
  card.addEventListener('dragstart', (ev) => {
    ev.dataTransfer.setData('text/plain', String(item.id));
    ev.dataTransfer.effectAllowed = 'move';
    state.ui.isDragging = true;
  });
  card.addEventListener('dragend', () => { state.ui.isDragging = false; });
  card.addEventListener('click', () => {
    if (state.ui.isDragging) return;
    openNoteModal(item.id);
  });

  return card;
}

function setupDropTargets() {
  const board = document.getElementById('board');
  const cells = Array.from(board.querySelectorAll('.cell'));
  const backlog = document.getElementById('backlog');

  function attachDropEvents(target, onDropInto) {
    target.addEventListener('dragover', (ev) => {
      ev.preventDefault();
      ev.dataTransfer.dropEffect = 'move';
      target.classList.add('drag-over');
    });
    target.addEventListener('dragleave', () => target.classList.remove('drag-over'));
    target.addEventListener('drop', (ev) => {
      ev.preventDefault();
      target.classList.remove('drag-over');
      const idStr = ev.dataTransfer.getData('text/plain');
      const id = Number(idStr);
      const item = state.items.find(it => it.id === id);
      if (!item) return;
      onDropInto(item, target);
      render();
    });
  }

  cells.forEach(cell => attachDropEvents(cell, (item, target) => {
    const effort = target.dataset.effort;
    const impact = target.dataset.impact;
    item.effortClass = effort;
    item.impactClass = impact;
    persistState();
  }));

  attachDropEvents(backlog, (item) => {
    item.effortClass = null;
    item.impactClass = null;
    persistState();
  });
}

// File handling
async function handleFile(file, merge = true) {
  const text = await file.text();
  const rows = parseCsv(text);
  const objs = rowsToObjects(rows);

  // Load any persisted items to preserve user edits across reloads/imports
  let persistedMap = new Map();
  if (merge) {
    try {
      const raw = localStorage.getItem('priorizacao_state');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.items)) {
          for (const it of parsed.items) {
            const key = normalizeString(it.demanda || '');
            if (key) persistedMap.set(key, it);
          }
        }
      }
    } catch (e) { /* ignore */ }
  }

  const items = objs.map((o, idx) => {
    const effortRaw = valueByPossibleKeys(o, [HEADERS.ESFORCO]);
    const impactRaw = valueByPossibleKeys(o, [HEADERS.IMPACTO]);
    const abordagemRaw = valueByPossibleKeys(o, [HEADERS.ABORDAGEM]);
    const escopoRaw = valueByPossibleKeys(o, [HEADERS.ESCOPO]);
    const demanda = valueByPossibleKeys(o, [HEADERS.DEMANDA, 'demanda']);
    const squad = valueByPossibleKeys(o, [HEADERS.SQUAD, 'squad', 'Squad']);
    const subSquad = valueByPossibleKeys(o, [HEADERS.SUBSQUAD, 'SubSquad', 'subSquad']);
    const obsAdicionais = valueByPossibleKeys(o, [HEADERS.OBS_ADICIONAIS, 'Observações adicionais']);
    const demandaDescricao = valueByPossibleKeys(o, [HEADERS.DEMANDA_DESC, 'Demanda descrição']);
    const principalImpacto = valueByPossibleKeys(o, [HEADERS.PRINCIPAL_IMPACTO]);
    const andamentoRaw = valueByPossibleKeys(o, [HEADERS.ANDAMENTO, 'Andamento']);
    const progressoRaw = valueByPossibleKeys(o, [HEADERS.PROGRESSO, 'Progresso']);
    const tipoEsforcoRaw = valueByPossibleKeys(o, [HEADERS.TIPO_ESFORCO, 'Tipo esforço', 'Tipo']);
    const urgenciaRaw = valueByPossibleKeys(o, [HEADERS.URGENCIA, 'Urgência', 'Urgencia']);
    const effortClass = classifyEffort(effortRaw);
    const impactClass = classifyImpact(impactRaw);
    const abordagemClass = classifyAbordagem(abordagemRaw);
    const escopoClass = classifyEscopo(escopoRaw);
    const principalImpactClass = classifyPrincipalImpact(principalImpacto);
    const andamento = parseAndamento(andamentoRaw);
    const progresso = parseProgresso(progressoRaw);
    const tipoEsforco = classifyTipoEsforco(tipoEsforcoRaw);
    const urgencia = (()=>{ const n = parseInt(String(urgenciaRaw||'').match(/\d+/)?.[0]||'',10); return (n>=0 && n<=5)? (Number.isNaN(n)? 0 : n) : 0; })();
    // baseline from CSV
    const base = {
      id: idx + 1,
      demanda,
      squad,
      effortRaw,
      impactRaw,
      abordagemRaw,
      escopoRaw,
      obsAdicionais,
      demandaDescricao,
      principalImpacto,
      effortClass,
      impactClass,
      abordagemClass,
      escopoClass,
      principalImpactClass,
      andamento,
      progresso,
      tipoEsforco,
      urgencia,
      subSquad: subSquad || '',
      boraImpact: '',
      parentId: null,
      relatedIds: [],
      observation: '',
      grupo: '',
      _original: o,
    };
    // merge with persisted (preserve user edits by demanda)
    const p = persistedMap.get(normalizeString(demanda || ''));
    if (p) {
      base.id = p.id ?? base.id;
      base.tipoEsforco = p.tipoEsforco ?? base.tipoEsforco;
      base.andamento = p.andamento ?? base.andamento;
      base.progresso = p.progresso ?? base.progresso;
      base.urgencia = p.urgencia ?? base.urgencia;
      base.parentId = p.parentId ?? base.parentId;
      base.relatedIds = Array.isArray(p.relatedIds) ? p.relatedIds.slice() : base.relatedIds;
      base.observation = p.observation ?? base.observation;
      // preserve classifications chosen by user on etapa 1
      base.effortClass = p.effortClass ?? base.effortClass;
      base.impactClass = p.impactClass ?? base.impactClass;
      base.abordagemClass = p.abordagemClass ?? base.abordagemClass;
      base.escopoClass = p.escopoClass ?? base.escopoClass;
      base.principalImpactClass = p.principalImpactClass ?? base.principalImpactClass;
      base.squad = p.squad ?? base.squad;
      base.subSquad = p.subSquad ?? base.subSquad;
      base.boraImpact = p.boraImpact ?? base.boraImpact;
      base.grupo = p.grupo ?? base.grupo;
    }
    return base;
  });

  state.items = items;
  populateSquadFilter();
  populateSubSquadFilter();
  persistState();
  render();
}

// Import from classified CSV (our own export format)
async function handleClassifiedFile(file, merge = true){
  const text = await file.text();
  const rows = parseCsv(text);
  const objs = rowsToObjects(rows);

  // Prepare persisted map if merge
  let persistedMap = new Map();
  if (merge) {
    try {
      const raw = localStorage.getItem('priorizacao_state');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.items)) {
          for (const it of parsed.items) {
            const key = normalizeString(it.demanda || '');
            if (key) persistedMap.set(key, it);
          }
        }
      }
    } catch(_){}
  }

  const items = objs.map((o, idx)=>{
    const demanda = valueByPossibleKeys(o, [HEADERS.DEMANDA, 'Demanda']);
    const demandDesc = valueByPossibleKeys(o, [HEADERS.DEMANDA_DESC, 'Demanda descrição']);
    const squad = valueByPossibleKeys(o, [HEADERS.SQUAD, 'Squad']);
    let grupo = o['Grupo'] ?? '';
    const subSquad = o['SubSquad'] ?? '';
    const urgRaw = String(o['Urgencia'] ?? o['Urgência'] ?? '');
    let urgencia = (()=>{ const n = parseInt(urgRaw.replace(/\D+/g,''),10); return Number.isFinite(n)? Math.max(0, Math.min(5, n)) : 0; })();
    // Heurística de correção para CSVs antigos onde Urgencia/Grupo estavam trocados
    const grupoLooksNumber = /^\s*[0-5]\s*$/.test(String(o['Grupo'] ?? ''));
    const urgLooksName = !/^\s*[0-5]\s*$/.test(urgRaw) && String(urgRaw).trim().length>0;
    if ((urgencia===0 && grupoLooksNumber) || (urgLooksName && grupoLooksNumber)) {
      urgencia = parseInt(String(o['Grupo']).trim(),10);
      grupo = urgRaw; // o que estava em Urgencia vira grupo
    }
    const tipoEsforco = o['TipoEsforco'] ?? o['Tipo esforço'] ?? o['Tipo Esforço'] ?? o['Tipo de esforço'] ?? '';
    const andamento = String(o['Andamento']||'').trim().toLowerCase().startsWith('s');
    const progRaw = o['Progresso'] ?? o['Progresso (%)'] ?? o['progresso'] ?? o['progresso (%)'] ?? '';
    const progresso = parseProgresso(progRaw);
    const boraImpact = o['Bora_Impact'] ?? '';
    const modalidade = o['Modalidade'] || '';
    const modalidades = String(o['Modalidades']||'').split(';').map(s=>s.trim()).filter(Boolean);
    const observation = o['Observacao_Complementar'] ?? '';
    const personas = String(o['Persona']||'').split(';').map(s=>s.trim()).filter(Boolean);
    const hipoteses = o['Hipoteses'] || '';
    const proposta = o['Proposta'] || '';
    const tecnologias = String(o['Tecnologias']||'').split(';').map(s=>s.trim()).filter(Boolean);
    const servicos = String(o['Servicos']||'').split(';').map(s=>s.trim()).filter(Boolean);
    const tiposAlteracao = String(o['TiposAlteracao']||'').split(';').map(s=>s.trim()).filter(Boolean);
    const complexidade = o['Complexidade'] || '';
    const horasEstimadas = (()=>{ const n = parseInt(o['HorasEstimadas'],10); return Number.isFinite(n)? n : null; })();
    const legalRequired = String(o['RequerJuridico']||'').trim().toLowerCase().startsWith('s');
    const legalNotes = o['QuestoesJuridicas'] || '';
    const effortClass = o['Esforco_Class'] ?? classifyEffort(valueByPossibleKeys(o,[HEADERS.ESFORCO]));
    const impactClass = o['Impacto_Class'] ?? classifyImpact(valueByPossibleKeys(o,[HEADERS.IMPACTO]));
    const abordagemClass = o['Abordagem_Class'] ?? classifyAbordagem(valueByPossibleKeys(o,[HEADERS.ABORDAGEM]));
    const escopoClass = o['Escopo_Class'] ?? classifyEscopo(valueByPossibleKeys(o,[HEADERS.ESCOPO]));
    const principalImpactClass = o['PrincipalImpacto_Class'] ?? classifyPrincipalImpact(valueByPossibleKeys(o,[HEADERS.PRINCIPAL_IMPACTO]));
    const parentName = (o['Pai']||'').trim();
    const relatedNames = String(o['Relacionamentos']||'').split(';').map(s=>s.trim()).filter(Boolean);

    const base = {
      id: idx + 1,
      demanda,
      demandaDescricao: demandDesc,
      squad,
      grupo,
      subSquad,
      urgencia,
      tipoEsforco,
      andamento,
      progresso,
      boraImpact,
      modalidade,
      modalidades,
      effortClass,
      impactClass,
      abordagemClass,
      escopoClass,
      principalImpactClass,
      observation,
      personas,
      hipoteses,
      proposta,
      tecnologias,
      servicos,
      tiposAlteracao,
      complexidade,
      horasEstimadas,
      legalRequired,
      legalNotes,
      parentId: null,
      relatedIds: [],
      _original: o,
      _parentName: parentName,
      _relatedNames: relatedNames,
    };

  const p = persistedMap.get(normalizeString(demanda||''));
  if (p) {
    // On classified import, prefer CSV values (backup) and only carry over ID and links if missing
    base.id = p.id ?? base.id;
    if (base.parentId == null) base.parentId = p.parentId ?? null;
    if (!Array.isArray(base.relatedIds) || base.relatedIds.length===0) base.relatedIds = Array.isArray(p.relatedIds) ? p.relatedIds.slice() : [];
  }
    return base;
  });

  // Resolve Pai e Relacionamentos por nome
  const nameToId = new Map();
  for (const it of items) { const k = normalizeString(it.demanda||''); if (k && !nameToId.has(k)) nameToId.set(k, it.id); }
  for (const it of items) {
    if (it.parentId == null && it._parentName) {
      const pid = nameToId.get(normalizeString(it._parentName)); if (pid) it.parentId = pid;
    }
    if ((!it.relatedIds || it.relatedIds.length===0) && Array.isArray(it._relatedNames)) {
      it.relatedIds = it._relatedNames.map(n=> nameToId.get(normalizeString(n))).filter(Boolean);
    }
    delete it._parentName; delete it._relatedNames;
  }

  state.items = items;
  populateSquadFilter();
  populateSubSquadFilter();
  persistState();
  render();
}

function populateSquadFilter() {
  const panel = document.getElementById('squadDropdownPanel');
  const btn = document.getElementById('squadDropdownBtn');
  if (!panel || !btn) return;
  clearChildren(panel);
  const set = new Set();
  for (const it of state.items) {
    const name = (it.squad || '').trim();
    if (name) set.add(name);
  }
  const squads = Array.from(set).sort();

  // Actions row
  const actions = document.createElement('div');
  actions.className = 'dropdown-actions';
  const hint = document.createElement('div');
  hint.textContent = 'Selecione squads';
  const clearBtn = document.createElement('button');
  clearBtn.type = 'button';
  clearBtn.textContent = 'Limpar';
  clearBtn.addEventListener('click', () => {
    state.filters.squad = [];
    // uncheck all
    panel.querySelectorAll('input[type="checkbox"]').forEach(cb => { cb.checked = false; });
    updateSquadButtonLabel();
    render();
  });
  actions.appendChild(hint);
  actions.appendChild(clearBtn);
  panel.appendChild(actions);

  // Options
  for (const s of squads) {
    const label = document.createElement('label');
    label.className = 'dropdown-option';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.value = s;
    cb.checked = Array.isArray(state.filters.squad) && state.filters.squad.includes(s);
    const txt = document.createElement('span');
    txt.textContent = s;
    label.appendChild(cb);
    label.appendChild(txt);
    panel.appendChild(label);
  }
  updateSquadButtonLabel();
}

function updateSquadButtonLabel() {
  const btn = document.getElementById('squadDropdownBtn');
  if (!btn) return;
  const sel = state.filters.squad || [];
  if (sel.length === 0) btn.textContent = 'Squad: Todos';
  else if (sel.length <= 2) btn.textContent = `Squad: ${sel.join(', ')}`;
  else btn.textContent = `Squad: ${sel.length} selecionadas`;
}

// Export with classification columns appended (does not overwrite originals)
function exportCsv() {
  if (!state.items.length) return;
  // Deduplicate original headers by normalized key (keeps first occurrence)
  const originalHeadersRaw = Object.keys(state.items[0]._original);
  const seenKeys = new Set();
  const originalHeaders = [];
  for (const h of originalHeadersRaw){
    const k = normalizeHeaderKey(h);
    if (seenKeys.has(k)) continue;
    seenKeys.add(k);
    originalHeaders.push(h);
  }
  const originalCI = new Set(originalHeaders.map(h => normalizeHeaderKey(h)));
  const extraDefsAll = [
    { name: 'Esforco_Class', get: (it)=> it.effortClass },
    { name: 'Impacto_Class', get: (it)=> it.impactClass },
    { name: 'Abordagem_Class', get: (it)=> it.abordagemClass },
    { name: 'Escopo_Class', get: (it)=> it.escopoClass },
    { name: 'PrincipalImpacto_Class', get: (it)=> it.principalImpactClass },
    { name: 'Bora_Impact', get: (it)=> it.boraImpact || '' },
    { name: 'Andamento', get: (it)=> it.andamento ? 'Sim' : 'Não' },
    { name: 'Progresso', get: (it)=> `${it.progresso ?? 0}%` },
    { name: 'TipoEsforco', get: (it)=> it.tipoEsforco || '' },
    { name: 'SubSquad', get: (it)=> it.subSquad || '' },
    { name: 'Urgencia', get: (it)=> it.urgencia ?? '' },
    { name: 'Grupo', get: (it)=> it.grupo || '' },
    { name: 'Pai', get: (it)=> { const p = state.items.find(x=>x.id===it.parentId); return p?.demanda || ''; } },
    { name: 'Relacionamentos', get: (it)=> (it.relatedIds||[]).map(id=>{ const o=state.items.find(x=>x.id===id); return o?.demanda || `#${id}`; }).join('; ') },
    { name: 'Observacao_Complementar', get: (it)=> it.observation },
    { name: 'Modalidade', get: (it)=> (it.modalidade || (Array.isArray(it.modalidades) && it.modalidades[0]) || '') },
    { name: 'Modalidades', get: (it)=> (it.modalidades||[]).join('; ') },
    { name: 'Persona', get: (it)=> (it.personas||[]).join('; ') },
    { name: 'Hipoteses', get: (it)=> it.hipoteses || '' },
    { name: 'Proposta', get: (it)=> it.proposta || '' },
    { name: 'Tecnologias', get: (it)=> (it.tecnologias||[]).join('; ') },
    { name: 'Servicos', get: (it)=> (it.servicos||[]).join('; ') },
    { name: 'TiposAlteracao', get: (it)=> (it.tiposAlteracao||[]).join('; ') },
    { name: 'Complexidade', get: (it)=> it.complexidade || '' },
    { name: 'HorasEstimadas', get: (it)=> it.horasEstimadas ?? '' },
    { name: 'RequerJuridico', get: (it)=> it.legalRequired ? 'Sim' : 'Não' },
    { name: 'QuestoesJuridicas', get: (it)=> it.legalNotes || '' },
  ];
  const includedDefs = extraDefsAll.filter(def => !originalCI.has(normalizeHeaderKey(def.name)));
  const headers = [...originalHeaders, ...includedDefs.map(d=>d.name)];

  const lines = [];
  const esc = (v) => {
    if (v == null) v = '';
    v = String(v);
    if (v.includes('"')) v = v.replace(/"/g, '""');
    if (v.includes(',') || v.includes('\n') || v.includes('\r') || v.includes('"')) {
      return `"${v}"`;
    }
    return v;
  };

  lines.push(headers.map(esc).join(','));
  for (const it of state.items) {
    const base = originalHeaders.map(h => {
      const hk = normalizeHeaderKey(h);
      // override classification and user-edited fields with current state values
      if (hk === 'esforcoclass') return esc(it.effortClass);
      if (hk === 'impactoclass') return esc(it.impactClass);
      if (hk === 'abordagemclass') return esc(it.abordagemClass);
      if (hk === 'escopoclass') return esc(it.escopoClass);
      if (hk === 'principalimpactoclass') return esc(it.principalImpactClass);
      if (hk === 'boraimpact') return esc(it.boraImpact || '');
      if (hk === 'urgencia') return esc(it.urgencia ?? '');
      if (hk === 'grupo') return esc(it.grupo || '');
      if (hk === 'subsquad') return esc(it.subSquad || '');
      if (hk === 'tipoesforco') return esc(it.tipoEsforco || (it._original[h] ?? ''));
      if (hk.startsWith('progresso')) return esc(`${it.progresso ?? 0}%`);
      if (hk === 'andamento') return esc(it.andamento ? 'Sim' : 'Não');
      if (hk === 'pai') { const p = state.items.find(x=>x.id===it.parentId); return esc(p?.demanda || ''); }
      if (hk === 'relacionamentos') { const rel=(it.relatedIds||[]).map(id=>{ const o=state.items.find(x=>x.id===id); return o?.demanda || `#${id}`; }).join('; '); return esc(rel); }
      if (hk === 'observacaocomplementar') return esc(it.observation || '');
      if (hk === 'modalidade') return esc(it.modalidade || '');
      if (hk === 'hacasesespeciais') return esc(it.hasCaseSpecial ? 'Sim' : 'Não');
      if (hk === 'casoespecial') return esc(it.caseSpecial || '');
      return esc(it._original[h] ?? '');
    });
    const extras = includedDefs.map(def => esc(def.get(it)));
    lines.push([...base, ...extras].join(','));
  }

  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'base_classificada.csv';
  a.click();
  URL.revokeObjectURL(url);
}

// Filters
function setupFilters() {
  const abordagemSel = document.getElementById('abordagemFilter');
  const escopoSel = document.getElementById('escopoFilter');
  const principalSel = document.getElementById('principalFilter');
  const tipoSel = document.getElementById('tipoEsforcoFilter');
  const esforcoTecnicoSel = document.getElementById('esforcoTecnicoFilter');
  const urgSel = document.getElementById('urgenciaFilter');
  const squadBtn = document.getElementById('squadDropdownBtn');
  const squadPanel = document.getElementById('squadDropdownPanel');
  const groupBtn = document.getElementById('groupDropdownBtn');
  const groupPanel = document.getElementById('groupDropdownPanel');
  const groupList = document.getElementById('groupDropdownList');
  const textInput = document.getElementById('textFilter');
  const relationsToggle = document.getElementById('relationsToggle');
  abordagemSel.addEventListener('change', () => {
    state.filters.abordagem = abordagemSel.value;
    persistFiltersStep1();
    render();
  });
  escopoSel.addEventListener('change', () => {
    state.filters.escopo = escopoSel.value;
    persistFiltersStep1();
    render();
  });
  principalSel.addEventListener('change', () => {
    state.filters.principal = principalSel.value;
    persistFiltersStep1();
    render();
  });
  // SubSquad dropdown (multi)
  const subBtn = document.getElementById('subSquadDropdownBtn');
  const subPanel = document.getElementById('subSquadDropdownPanel');
  const subList = document.getElementById('subSquadDropdownList');
  function updateSubBtn(){
    const sel = state.filters.subSquad || [];
    if (!subBtn) return;
    if (sel.length === 0) subBtn.textContent = 'SubSquad: Todos';
    else if (sel.length <= 2) subBtn.textContent = `SubSquad: ${sel.map(v=> v==='__NONE__' ? 'Sem subSquad' : v).join(', ')}`;
    else subBtn.textContent = `SubSquad: ${sel.length} selecionadas`;
  }
  function rebuildSubList(){
    if (!subList) return;
    subList.innerHTML='';
    const counts = new Map();
    for (const it of state.items){ const k=(it.subSquad||'').trim() || '__NONE__'; counts.set(k,(counts.get(k)||0)+1); }
    const names = Array.from(counts.keys()).filter(k=>k!=='__NONE__').sort(); if (counts.has('__NONE__')) names.push('__NONE__');
    for (const name of names){
      const label = document.createElement('label'); label.className='dropdown-option';
      const cb = document.createElement('input'); cb.type='checkbox'; cb.value=name; cb.checked=(state.filters.subSquad||[]).includes(name);
      const span = document.createElement('span'); span.textContent = `${name==='__NONE__'?'Sem subSquad':name} (${counts.get(name)||0})`;
      label.appendChild(cb); label.appendChild(span); subList.appendChild(label);
    }
  }
  if (subBtn && subPanel){
    subBtn.addEventListener('click',(e)=>{ e.stopPropagation(); rebuildSubList(); subPanel.classList.toggle('hidden'); });
    document.addEventListener('click',(e)=>{ if (!subPanel.classList.contains('hidden')){ const dd=document.getElementById('subSquadDropdown'); if (dd && !dd.contains(e.target)) subPanel.classList.add('hidden'); }});
    subList?.addEventListener('change',()=>{ const cbs = Array.from(subList.querySelectorAll('input[type="checkbox"]')); state.filters.subSquad = cbs.filter(cb=>cb.checked).map(cb=>cb.value); updateSubBtn(); persistFiltersStep1(); render(); });
    updateSubBtn();
  }
  if (tipoSel) {
    tipoSel.addEventListener('change', () => {
      state.filters.tipo = tipoSel.value;
      persistFiltersStep1(); render();
    });
  }
  if (esforcoTecnicoSel) {
    esforcoTecnicoSel.addEventListener('change', () => {
      state.filters.esforcoTecnico = esforcoTecnicoSel.value;
      persistFiltersStep1(); render();
    });
  }
  if (urgSel) {
    urgSel.addEventListener('change', () => {
      state.filters.urgencia = urgSel.value;
      persistFiltersStep1(); render();
    });
  }
  if (textInput) {
    textInput.addEventListener('input', () => {
      state.filters.text = textInput.value;
      persistFiltersStep1(); render();
    });
  }
  if (squadBtn && squadPanel) {
    squadBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      squadPanel.classList.toggle('hidden');
    });
    document.addEventListener('click', (e) => {
      if (!squadPanel.classList.contains('hidden')) {
        const dropdown = document.getElementById('squadDropdown');
        if (dropdown && !dropdown.contains(e.target)) squadPanel.classList.add('hidden');
      }
    });
    squadPanel.addEventListener('change', (e) => {
      const checkboxes = Array.from(squadPanel.querySelectorAll('input[type="checkbox"]'));
      state.filters.squad = checkboxes.filter(cb => cb.checked).map(cb => cb.value);
      updateSquadButtonLabel();
      persistFiltersStep1();
      render();
    });
  }

  // Group filter dropdown
  function updateGroupBtn() {
    const sel = state.filters.groups || [];
    if (!groupBtn) return;
    if (sel.length === 0) groupBtn.textContent = 'Grupos: Todos';
    else if (sel.length <= 2) groupBtn.textContent = `Grupos: ${sel.map(v=> v==='__NONE__' ? 'Sem grupo' : v).join(', ')}`;
    else groupBtn.textContent = `Grupos: ${sel.length} selecionados`;
  }
  function rebuildGroupList() {
    if (!groupList) return;
    groupList.innerHTML = '';
    const counts = new Map();
    for (const it of state.items) {
      const g = (it.grupo || '').trim();
      const key = g || '__NONE__';
      counts.set(key, (counts.get(key)||0)+1);
    }
    // Ensure stable order: non-empty names then '__NONE__'
    const names = Array.from(counts.keys()).filter(k=>k!=='__NONE__').sort();
    if (counts.has('__NONE__')) names.push('__NONE__');
    for (const name of names) {
      const label = document.createElement('label'); label.className='dropdown-option';
      const cb = document.createElement('input'); cb.type='checkbox'; cb.value=name; cb.checked=(state.filters.groups||[]).includes(name);
      const span = document.createElement('span'); span.textContent = `${name==='__NONE__'?'Sem grupo':name} (${counts.get(name)||0})`;
      label.appendChild(cb); label.appendChild(span); groupList.appendChild(label);
    }
  }
  if (groupBtn && groupPanel) {
    groupBtn.addEventListener('click', (e)=>{ e.stopPropagation(); rebuildGroupList(); groupPanel.classList.toggle('hidden'); });
    document.addEventListener('click', (e)=>{ if (!groupPanel.classList.contains('hidden')) { const dd=document.getElementById('groupDropdown'); if (dd && !dd.contains(e.target)) groupPanel.classList.add('hidden'); } });
    groupList?.addEventListener('change', ()=>{
      const cbs = Array.from(groupList.querySelectorAll('input[type="checkbox"]'));
      state.filters.groups = cbs.filter(cb=>cb.checked).map(cb=>cb.value);
      updateGroupBtn(); persistFiltersStep1(); render();
    });
    updateGroupBtn();
  }
  if (relationsToggle) {
    relationsToggle.addEventListener('change', () => {
      state.filters.showRelations = relationsToggle.checked;
      drawRelations();
    });
  }

  // Sheet SubSquad live save
  const sheetSubInput = document.getElementById('sheetSubSquadInput');
  if (sheetSubInput) {
    sheetSubInput.addEventListener('input', ()=>{
      const id = state.ui.selectedId; const item = state.items.find(it=>it.id===id);
      if (!item) return; item.subSquad = String(sheetSubInput.value||''); persistState();
    });
  }
  const sheetBoraSel2 = document.getElementById('sheetBoraSel');
  if (sheetBoraSel2) {
    sheetBoraSel2.addEventListener('change', ()=>{
      const id = state.ui.selectedId; const item = state.items.find(it=>it.id===id);
      if (!item) return; item.boraImpact = sheetBoraSel2.value || '';
      persistState();
      render();
    });
  }
}

// Init
window.addEventListener('DOMContentLoaded', () => {
  // Setup DnD targets
  setupDropTargets();
  setupFilters();

  // File input
  const fileInput = document.getElementById('csvFile');
  const csvOpenBtn = document.getElementById('csvOpenBtn');
  if (csvOpenBtn && fileInput) csvOpenBtn.addEventListener('click', ()=> fileInput.click());
  fileInput.addEventListener('change', (ev) => {
    const f = ev.target.files?.[0];
    if (f) {
      let merge = true;
      try {
        const raw = localStorage.getItem('priorizacao_state');
        if (raw) {
          merge = window.confirm('Encontramos um estado salvo. Clique OK para MERGE com o CSV, ou Cancelar para ZERAR e carregar somente o CSV.');
        }
      } catch (e) { /* ignore */ }
      handleFile(f, merge);
    }
  });

  // File input (base classificada)
  const classInput = document.getElementById('csvClassFile');
  const classOpenBtn = document.getElementById('csvClassOpenBtn');
  if (classOpenBtn && classInput) classOpenBtn.addEventListener('click', ()=> classInput.click());
  classInput?.addEventListener('change', (ev)=>{
    const f = ev.target.files?.[0];
    if (f) {
      let merge = true;
      try {
        const raw = localStorage.getItem('priorizacao_state');
        if (raw) {
          merge = window.confirm('Importar base classificada. OK = MERGE com estado salvo, Cancelar = ZERAR e usar somente o CSV.');
        }
      } catch(e){}
      handleClassifiedFile(f, merge);
    }
  });

  // Try to load from localStorage if present
  if (loadPersistedState()) {
    populateSquadFilter();
  }
  loadFiltersStep1();
  populateSquadFilter();
  populateSubSquadFilter();
  render();

  // Export button
  const exportBtn = document.getElementById('exportCsvBtn');
  exportBtn.addEventListener('click', exportCsv);

  // Reset filters button handler is wired earlier

  // keep relation lines updated on viewport changes
  window.addEventListener('resize', drawRelations);
  window.addEventListener('scroll', drawRelations, true);

  // Step 2 navigation
  const goStep2Btn = document.getElementById('goStep2Btn');
  if (goStep2Btn) {
    goStep2Btn.addEventListener('click', () => {
      // Ensure latest state is stored for step 2
      persistState();
      window.location.href = 'step2.html';
    });
  }

  // Vote overlay wiring
  const openVoteBtn = document.getElementById('openVoteOverlayBtn');
  const closeVoteBtn = document.getElementById('closeVoteOverlayBtn');
  if (openVoteBtn) openVoteBtn.addEventListener('click', openVoteOverlay);
  if (closeVoteBtn) closeVoteBtn.addEventListener('click', closeVoteOverlay);
  document.addEventListener('keydown', (e)=>{
    const overlay = document.getElementById('voteOverlay');
    if (e.key === 'Escape' && overlay && !overlay.classList.contains('hidden')) closeVoteOverlay();
  });

  // vote cols selector
  const voteColsSel = document.getElementById('voteColsSel');
  if (voteColsSel) {
    // load persisted
    try { const v = localStorage.getItem('priorizacao_vote_cols'); if (v) voteColsSel.value = v; } catch(_){}
    voteColsSel.addEventListener('change', ()=>{ persistVoteCols(); applyVoteCols(); });
  }

  // Reset filters
  const resetBtn = document.getElementById('resetFiltersBtn');
  if (resetBtn) {
    resetBtn.addEventListener('click', ()=>{
      state.filters = { abordagem: 'all', escopo: 'all', principal: 'all', tipo: 'all', urgencia: 'all', esforcoTecnico: 'all', subSquad: 'all', squad: [], groups: [], text: '', showRelations: false };
      // reset UI controls
      const setVal = (id,val)=>{ const el=document.getElementById(id); if (el) el.value=val; };
      setVal('abordagemFilter','all'); setVal('escopoFilter','all'); setVal('principalFilter','all'); setVal('tipoEsforcoFilter','all'); setVal('urgenciaFilter','all'); setVal('esforcoTecnicoFilter','all'); setVal('subSquadFilter','all');
      const tf=document.getElementById('textFilter'); if (tf) tf.value='';
      const rt=document.getElementById('relationsToggle'); if (rt) rt.checked=false;
      populateSquadFilter();
      updateSquadButtonLabel && updateSquadButtonLabel();
      // group label updates via render()
      persistFiltersStep1();
      render();
    });
  }

  // Modal wiring
  const modal = document.getElementById('noteModal');
  const closeBtn = document.getElementById('noteCloseBtn');
  const cancelBtn = document.getElementById('noteCancelBtn');
  const saveBtn = document.getElementById('noteSaveBtn');
  const parentDropdown = document.getElementById('parentDropdown');
  const parentDropdownBtn = document.getElementById('parentDropdownBtn');
  const parentDropdownPanel = document.getElementById('parentDropdownPanel');
  const parentDropdownSearch = document.getElementById('parentDropdownSearch');
  const parentDropdownList = document.getElementById('parentDropdownList');
  const noteTipoSel = document.getElementById('noteTipoSel');
  const noteGroupInput = document.getElementById('noteGroupInput');
  const noteGroupDropdown = document.getElementById('noteGroupDropdown');
  const noteGroupPanel = document.getElementById('noteGroupPanel');
  const noteGroupList = document.getElementById('noteGroupList');
  const noteUrgSel = document.getElementById('noteUrgSel');
  const noteSubSquadInput = document.getElementById('noteSubSquadInput');
  closeBtn.addEventListener('click', closeNoteModal);
  cancelBtn.addEventListener('click', closeNoteModal);
  saveBtn.addEventListener('click', saveNoteModal);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeNoteModal();
  });

  if (parentDropdown && parentDropdownBtn && parentDropdownPanel) {
    parentDropdownBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      parentDropdownPanel.classList.toggle('hidden');
      if (!parentDropdownPanel.classList.contains('hidden')) {
        const id = state.ui.selectedId; const item = state.items.find(it => it.id === id);
        buildParentDropdownList(item, parentDropdownList, '');
        if (parentDropdownSearch) parentDropdownSearch.value = '';
        parentDropdownSearch?.focus();
      }
    });
    document.addEventListener('click', (e) => {
      if (parentDropdownPanel && !parentDropdownPanel.classList.contains('hidden')) {
        if (parentDropdown && !parentDropdown.contains(e.target)) parentDropdownPanel.classList.add('hidden');
      }
    });
    parentDropdownSearch?.addEventListener('input', () => {
      const id = state.ui.selectedId; const item = state.items.find(it => it.id === id);
      buildParentDropdownList(item, parentDropdownList, parentDropdownSearch.value);
    });
    parentDropdownList?.addEventListener('click', (e) => {
      const choice = e.target.closest('[data-parent-id]');
      if (!choice) return;
      const pidAttr = choice.getAttribute('data-parent-id');
      const id = state.ui.selectedId; const item = state.items.find(it => it.id === id);
      if (!item) return;
      item.parentId = pidAttr ? Number(pidAttr) : null;
      updateParentDropdownLabel(parentDropdownBtn, item);
      parentDropdownPanel.classList.add('hidden');
      persistState();
    });
  }
  if (noteTipoSel) {
    noteTipoSel.addEventListener('change', () => {
      const id = state.ui.selectedId;
      if (id == null) return;
      const item = state.items.find(it => it.id === id);
      if (item) item.tipoEsforco = noteTipoSel.value;
      render();
    });
  }
  if (noteUrgSel) {
    noteUrgSel.addEventListener('change', () => {
      const id = state.ui.selectedId;
      if (id == null) return;
      const item = state.items.find(it => it.id === id);
      if (item) item.urgencia = parseInt(noteUrgSel.value, 10);
      persistState();
      render();
    });
  }
  if (noteGroupInput) {
    function buildGroupSuggestions(filter=''){
      if (!noteGroupList) return;
      noteGroupList.innerHTML='';
      const norm = normalizeString(filter||'');
      const set = new Set();
      for (const it of state.items){ const g=(it.grupo||'').trim(); if (g) set.add(g); }
      const names = Array.from(set).filter(n=> !norm || normalizeString(n).includes(norm)).sort();
      names.forEach(name=>{
        const opt=document.createElement('div'); opt.className='dropdown-option'; opt.textContent=name;
        opt.addEventListener('mousedown', (e)=>{ // mousedown to run before input blur
          e.preventDefault(); noteGroupInput.value=name; apply(name);
          noteGroupPanel?.classList.add('hidden');
        });
        noteGroupList.appendChild(opt);
      });
    }
    function apply(val){
      const id = state.ui.selectedId; if (id == null) return;
      const item = state.items.find(it => it.id === id); if (!item) return;
      const v = String(val || '').slice(0,60).trim();
      item.grupo = v;
      persistState();
      render();
    }
    noteGroupInput.addEventListener('input', ()=>{
      noteGroupPanel?.classList.remove('hidden');
      buildGroupSuggestions(noteGroupInput.value);
      apply(noteGroupInput.value);
    });
    noteGroupInput.addEventListener('focus', ()=>{ buildGroupSuggestions(noteGroupInput.value); noteGroupPanel?.classList.remove('hidden'); });
    document.addEventListener('click', (e)=>{ if (noteGroupDropdown && !noteGroupDropdown.contains(e.target)) noteGroupPanel?.classList.add('hidden'); });
  }

  // Obs adicionais modal
  const obsModal = document.getElementById('obsModal');
  const obsClose = document.getElementById('obsCloseBtn');
  const obsOk = document.getElementById('obsOkBtn');
  obsClose.addEventListener('click', closeObsModal);
  obsOk.addEventListener('click', closeObsModal);
  obsModal.addEventListener('click', (e) => { if (e.target === obsModal) closeObsModal(); });

  // Google Sheets config modal (read-only via Published CSV)
  const sheetsCfgBtn = document.getElementById('sheetsCfgBtn');
  const sheetsCfgModal = document.getElementById('sheetsCfgModal');
  const sheetsCfgCloseBtn = document.getElementById('sheetsCfgCloseBtn');
  const sheetsCfgCancelBtn = document.getElementById('sheetsCfgCancelBtn');
  const sheetsCfgSaveBtn = document.getElementById('sheetsCfgSaveBtn');
  const sheetsTestBtn = document.getElementById('sheetsTestBtn');
  const sheetsUrlInput = document.getElementById('sheetsUrlInput');
  const sheetsNameInput = document.getElementById('sheetsNameInput');
  // GID não é necessário
  const sheetsImportMode = document.getElementById('sheetsImportMode');
  const sheetsClientIdInput = document.getElementById('sheetsClientIdInput');
  const sheetsOAuthBtn = document.getElementById('sheetsOAuthBtn');
  const sheetsAuthStatus = document.getElementById('sheetsAuthStatus');
  let gisAccessToken = null;
  const DEFAULT_GIS_CLIENT_ID = '1712067639-gp823soeiks0jvtabr52orb89jvn1geo.apps.googleusercontent.com';

  function parseSheetIdOrDirectUrl(s){
    const val = String(s||'').trim().replace(/^['"]|['"]$/g,'');
    // Caso 1: URL publicada (/d/e/.../pub?output=csv) -> usar diretamente (apenas leitura)
    if (/^https?:\/\/docs\.google\.com\/spreadsheets\/d\/e\//.test(val) && /(?:output=csv|format=csv)/.test(val)) {
      return { direct: val };
    }
    // Caso 2: URL normal de planilha -> extrai ID em qualquer sufixo (?gid=...#gid=..., /edit, /copy etc)
    const m = val.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    if (m) return { id: m[1] };
    // Caso 3: links do tipo open?id=
    const u = (()=>{ try{ return new URL(val); } catch(_){ return null; } })();
    if (u) {
      const idParam = u.searchParams.get('id');
      if (idParam) return { id: idParam };
    }
    // Caso 4: usuário colou apenas o ID (sequência segura)
    if (/^[a-zA-Z0-9-_]{20,}$/.test(val)) return { id: val };
    return { id: '' };
  }
  // Alias para compatibilidade com versões antigas que chamavam parseSheetId
  try { if (typeof window !== 'undefined' && !window.parseSheetId) { window.parseSheetId = parseSheetIdOrDirectUrl; } } catch(_) {}
  function buildPublishedCsvUrl(cfg){
    // Se veio um endpoint direto publicado, devolve como está
    if (cfg.direct) return cfg.direct;
    const id = cfg.id;
    if (cfg.gid) return `https://docs.google.com/spreadsheets/d/${id}/export?format=csv&gid=${encodeURIComponent(cfg.gid)}`;
    const sheet = encodeURIComponent(cfg.sheet || 'base_classificada');
    return `https://docs.google.com/spreadsheets/d/${id}/gviz/tq?tqx=out:csv&sheet=${sheet}`;
  }
  async function importFromPublishedCsv(merge){
    try {
      const raw = localStorage.getItem('priorizacao_sheets_cfg');
      if (!raw) { alert('Configure a planilha primeiro.'); return; }
      const cfg = JSON.parse(raw);
      const url = buildPublishedCsvUrl(cfg);
      const resp = await fetch(url, { mode: 'cors' });
      if (!resp.ok) throw new Error('HTTP '+resp.status);
      const text = await resp.text();
      const file = new File([text], 'sheet.csv', { type: 'text/csv' });
      await handleClassifiedFile(file, merge);
      alert('Importado da planilha (publicada) com sucesso.');
    } catch (e) {
      console.error('Sheets import error', e);
      alert('Falhou ao ler a planilha publicada. Verifique se a aba foi Publicada na Web e a URL/ID está correta.');
    }
  }

  function openSheetsCfg(){
    try {
      const raw = localStorage.getItem('priorizacao_sheets_cfg');
      if (raw) {
        const cfg = JSON.parse(raw);
        if (sheetsUrlInput) sheetsUrlInput.value = cfg.id || '';
        if (sheetsNameInput) sheetsNameInput.value = cfg.sheet || 'base_classificada';
        
      } else {
        if (sheetsNameInput) sheetsNameInput.value = 'base_classificada';
      }
      // Client ID é hardcoded; nenhum input necessário
    } catch(_){ if (sheetsNameInput) sheetsNameInput.value = 'base_classificada'; }
    try { const em = localStorage.getItem('priorizacao_gis_email'); if (em && sheetsAuthStatus) sheetsAuthStatus.textContent = `Autenticado: ${em}`; } catch(_){}
    sheetsCfgModal?.classList.remove('hidden');
  }
  function closeSheetsCfg(){ sheetsCfgModal?.classList.add('hidden'); }

  sheetsCfgBtn?.addEventListener('click', openSheetsCfg);
  sheetsCfgCloseBtn?.addEventListener('click', closeSheetsCfg);
  sheetsCfgCancelBtn?.addEventListener('click', closeSheetsCfg);
  sheetsCfgSaveBtn?.addEventListener('click', ()=>{
    const parsed = parseSheetIdOrDirectUrl(sheetsUrlInput?.value || '');
    const sheet = (sheetsNameInput?.value || 'base_classificada').trim() || 'base_classificada';
    localStorage.setItem('priorizacao_sheets_cfg', JSON.stringify({ ...parsed, sheet }));
    closeSheetsCfg();
  });
  sheetsTestBtn?.addEventListener('click', ()=>{
    const merge = (sheetsImportMode?.value || 'merge') === 'merge';
    // salva temporariamente antes de testar
    const parsed = parseSheetIdOrDirectUrl(sheetsUrlInput?.value || '');
    const sheet = (sheetsNameInput?.value || 'base_classificada').trim() || 'base_classificada';
    localStorage.setItem('priorizacao_sheets_cfg', JSON.stringify({ ...parsed, sheet }));
    importFromPublishedCsv(merge);
  });

  // OAuth (GIS) helpers
  function ensureGisLoaded(){
    return new Promise((resolve)=>{
      if (window.google && window.google.accounts && window.google.accounts.oauth2) return resolve();
      const s = document.createElement('script');
      s.src = 'https://accounts.google.com/gsi/client';
      s.async = true; s.defer = true;
      s.onload = ()=> resolve();
      document.head.appendChild(s);
    });
  }
  async function getGisToken(){
    await ensureGisLoaded();
    const clientId = DEFAULT_GIS_CLIENT_ID;
    return new Promise((resolve)=>{
      const tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: 'https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/drive.readonly',
        callback: (resp) => {
          if (resp && resp.access_token) {
            gisAccessToken = resp.access_token;
            // fetch email
            updateUserInfoEmail(gisAccessToken);
            resolve(gisAccessToken);
          } else {
            if (sheetsAuthStatus) sheetsAuthStatus.textContent = 'Falha na autenticação';
            resolve(null);
          }
        },
      });
      tokenClient.requestAccessToken({ prompt: '' }); // mostra consent se necessário
    });
  }
  async function updateUserInfoEmail(token){
    try {
      const resp = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', { headers: { Authorization: `Bearer ${token}` } });
      if (resp.ok) {
        const data = await resp.json();
        const email = data && data.email ? String(data.email) : '';
        if (email) {
          try { localStorage.setItem('priorizacao_gis_email', email); } catch(_){ }
          if (sheetsAuthStatus) sheetsAuthStatus.textContent = `Autenticado: ${email}`;
        } else {
          if (sheetsAuthStatus) sheetsAuthStatus.textContent = 'Autenticado';
        }
      } else {
        if (sheetsAuthStatus) sheetsAuthStatus.textContent = 'Autenticado';
      }
    } catch(_) {
      if (sheetsAuthStatus) sheetsAuthStatus.textContent = 'Autenticado';
    }
  }
  function valuesToCsv(values){
    const enc = (v)=> {
      const s = v==null ? '' : String(v);
      if (/[\",\\n]/.test(s)) return '\"' + s.replace(/\"/g,'\"\"') + '\"';
      return s;
    };
    return (values||[]).map(row => (row||[]).map(enc).join(',')).join('\\n');
  }
  function a1Col(index){
    let n = index + 1; let s = '';
    while(n>0){ const m = (n-1)%26; s = String.fromCharCode(65+m)+s; n = Math.floor((n-1)/26); }
    return s;
  }
  function normKey(s){ return String(s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'_').replace(/^_|_$/g,''); }
  function valueForHeader(key, item){
    switch(key){
      case 'demanda': return item.demanda || '';
      case 'demanda_descricao': return item.demandaDescricao || '';
      case 'squad': return item.squad || '';
      case 'subsquad': return Array.isArray(item.subSquad)? item.subSquad.join('; ') : (item.subSquad||'');
      case 'grupo': return item.grupo || '';
      case 'tipoesforco': return item.tipoEsforco || '';
      case 'urgencia': return Number(item.urgencia||0);
      case 'andamento': return item.andamento ? 'Sim' : 'Não';
      case 'progresso': return Math.max(0, Math.min(1, Number(item.progresso||0) / 100));
      case 'esforco_class': return item.effortClass || '';
      case 'impacto_class': return item.impactClass || '';
      case 'abordagem_class': return item.abordagemClass || '';
      case 'escopo_class': return item.escopoClass || '';
      case 'principalimpacto_class': return item.principalImpactClass || '';
      case 'bora_impact': return item.boraImpact || '';
      case 'observacao_complementar': return item.observation || '';
      case 'modalidade': return item.modalidade || (Array.isArray(item.modalidades) && item.modalidades[0]) || '';
      case 'modalidades': return (item.modalidades||[]).join('; ');
      case 'persona': return (item.personas||[]).join('; ');
      case 'requerjuridico': return item.legalRequired ? 'Sim' : 'Não';
      case 'questoesjuridicas': return item.legalNotes || '';
      case 'tecnologias': return (item.tecnologias||[]).join('; ');
      case 'servicos': return (item.servicos||[]).join('; ');
      case 'tiposalteracao': return (item.tiposAlteracao||[]).join('; ');
      case 'complexidade': return item.complexidade || '';
      case 'horasestimadas': return item.horasEstimadas ?? '';
      case 'pai': {
        const p = state.items.find(x=> x.id === item.parentId); return p? (p.demanda||'') : '';
      }
      case 'relacionamentos': {
        const ids = Array.isArray(item.relatedIds)? item.relatedIds : []; const names = ids.map(id=>{ const it=state.items.find(x=>x.id===id); return it? it.demanda:''; }).filter(Boolean); return names.join('; ');
      }
      default: return '';
    }
  }
  async function upsertItemToSheets(itemOrId){
    try {
      // Resolve item: accepts object, id, or uses currently selected item
      let item = itemOrId;
      if (!item || typeof item !== 'object') {
        const id = (typeof itemOrId === 'number') ? itemOrId : state.ui.selectedId;
        if (id != null) item = state.items.find(x => x.id === id);
      }
      if (!item) { console.warn('[Sheets] upsert: nenhum item resolvido (selecione um card)'); return; }
      const cfgRaw = localStorage.getItem('priorizacao_sheets_cfg');
      if (!cfgRaw) { console.warn('[Sheets] upsert: configuração ausente'); if (sheetsAuthStatus) sheetsAuthStatus.textContent = 'Configure a planilha (ID/URL de edição)'; return; }
      const cfg = JSON.parse(cfgRaw);
      const token = gisAccessToken || await getGisToken();
      if (!token) return;
      const id = cfg.id; if (!id || id.startsWith('http')) { console.warn('[Sheets] upsert: é preciso o spreadsheetId (URL de edição), link publicado não serve'); if (sheetsAuthStatus) sheetsAuthStatus.textContent = 'Use a URL de edição (…/spreadsheets/d/ID/…)'; return; }
      const title = cfg.sheet || 'base_classificada';
      console.log('[Sheets] upsert:start', { spreadsheetId: id, sheet: title, demanda: item.demanda });
      // 1) headers
      let url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(id)}/values/${encodeURIComponent(title)}!1:1`;
      let resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!resp.ok) { const body = await resp.text(); throw new Error('Falha ao ler cabeçalho: '+resp.status+' - '+body); }
      const headData = await resp.json();
      const headers = (headData.values && headData.values[0]) ? headData.values[0] : [];
      const nkeys = headers.map(h=> normKey(h));
      // 2) localizar linha pela coluna Demanda
      const demandCol = nkeys.findIndex(k=> k === 'demanda');
      let rowIndex = -1;
      if (demandCol >= 0){
        console.log('[Sheets] upsert:demandCol', demandCol);
        const colA1 = a1Col(demandCol);
        url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(id)}/values/${encodeURIComponent(title)}!${colA1}2:${colA1}`;
        resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
        if (resp.ok){
          const colData = await resp.json();
          const vals = (colData.values||[]).map(r => (r&&r[0])? String(r[0]) : '');
          const idx = vals.findIndex(v => v === (item.demanda||''));
          if (idx >= 0) rowIndex = idx + 2;
        }
      }
      // 3) construir linha
      const width = headers.length;
      const row = new Array(width).fill('');
      for (let i=0;i<width;i++) row[i] = valueForHeader(nkeys[i], item);
      // 4) update/append
      if (rowIndex > 0){
        const lastCol = a1Col(width-1);
        const range = `${title}!A${rowIndex}:${lastCol}${rowIndex}`;
        const putUrl = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(id)}/values/${encodeURIComponent(range)}?valueInputOption=RAW`;
        console.log('[Sheets] upsert:PUT', range);
        await fetch(putUrl, { method: 'PUT', headers: { 'Content-Type':'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ range, majorDimension: 'ROWS', values: [row] }) });
      } else {
        const appendUrl = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(id)}/values/${encodeURIComponent(title)}!A1:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`;
        console.log('[Sheets] upsert:APPEND');
        await fetch(appendUrl, { method: 'POST', headers: { 'Content-Type':'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ values: [row] }) });
      }
      console.log('[Sheets] upsert:done');
    } catch(e){ console.error('Sheets upsert error', e); }
  }
  // Mark as used for static analyzers and allow manual triggering in console if needed
  try { if (typeof window !== 'undefined') { window.__upsertItemToSheets = upsertItemToSheets; } } catch(_){ }
  function triggerSheetsUpsert(itemOrId){
    try {
      const fn = (typeof upsertItemToSheets === 'function') ? upsertItemToSheets : (typeof window !== 'undefined' ? window.__upsertItemToSheets : null);
      if (typeof fn === 'function') return fn(itemOrId);
      console.warn('[Sheets] upsert: função indisponível');
    } catch(e){ console.error('[Sheets] upsert wrapper error', e); }
  }
  try { if (typeof window !== 'undefined') { window.demands = window.demands || {}; window.demands.triggerSheetsUpsert = triggerSheetsUpsert; window.demands.upsertItemToSheets = upsertItemToSheets; } } catch(_){ }
  // gid → título não é mais necessário (sem GID)
  async function importFromSheetsOAuth(merge){
    try {
      const cfgRaw = localStorage.getItem('priorizacao_sheets_cfg');
      if (!cfgRaw) { alert('Configure a planilha primeiro.'); return; }
      const cfg = JSON.parse(cfgRaw);
      const token = gisAccessToken || await getGisToken();
      if (!token) return;
      let id = cfg.id || cfg.direct;
      // se usuário colou URL direta publicada, ela não serve para OAuth; exigimos id
      if (!id || id.startsWith('http')) { alert('Informe o ID/URL da planilha (não o link publicado) para OAuth.'); return; }
      let title = cfg.sheet || 'base_classificada';
      const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(id)}/values/${encodeURIComponent(title)}?majorDimension=ROWS`;
      const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!resp.ok) { const body = await resp.text(); throw new Error('HTTP '+resp.status+' - '+body); }
      const data = await resp.json();
      const csv = valuesToCsv(data.values || []);
      const file = new File([csv], 'sheet.csv', { type: 'text/csv' });
      await handleClassifiedFile(file, merge);
      alert('Importado via OAuth (Sheets API) com sucesso.');
    } catch (e) {
      console.error('Sheets OAuth import error', e);
      alert('Falhou ao ler via OAuth. Verifique permissões (você precisa ter acesso à planilha).');
    }
  }
  sheetsOAuthBtn?.addEventListener('click', async ()=>{
    // Persist current config before authenticating, so import doesn't complain
    try {
      const parsed = parseSheetIdOrDirectUrl(sheetsUrlInput?.value || '');
      const sheet = (sheetsNameInput?.value || 'base_classificada').trim() || 'base_classificada';
      localStorage.setItem('priorizacao_sheets_cfg', JSON.stringify({ ...parsed, sheet }));
    } catch(_){}
    const token = await getGisToken();
    if (!token) return;
    const merge = (sheetsImportMode?.value || 'merge') === 'merge';
    await importFromSheetsOAuth(merge);
  });

  // Sheet
  const sheet = document.getElementById('detailSheet');
  const sheetCloseBtn = document.getElementById('sheetCloseBtn');
  sheetCloseBtn.addEventListener('click', closeDetailSheet);
  // Drawer elements
  const drawer = document.getElementById('modalidadesDrawer');
  const openDrawerBtn = document.getElementById('openModalidadesDrawerBtn');
  const drawerBackBtn = document.getElementById('drawerBackBtn');
  const modalidadesList = document.getElementById('modalidadesList');
  const personaList = document.getElementById('personaList');
  const legalReqChk = document.getElementById('legalReqChk');
  const legalNotesRow = document.getElementById('legalNotesRow');
  const legalNotesText = document.getElementById('legalNotesText');
  // Diagnóstico extra controls
  const diagTechInput = document.getElementById('diagTechInput');
  const diagAddTechBtn = document.getElementById('diagAddTechBtn');
  const diagTechList = document.getElementById('diagTechList');
  const diagServInput = document.getElementById('diagServInput');
  const diagAddServBtn = document.getElementById('diagAddServBtn');
  const diagServList = document.getElementById('diagServList');
  const diagTechSuggest = document.getElementById('diagTechSuggest');
  const diagServSuggest = document.getElementById('diagServSuggest');
  const diagTypesArea = document.getElementById('diagTypesArea');
  const diagComplexSel = document.getElementById('diagComplexSel');
  const diagHoursInput = document.getElementById('diagHoursInput');
  const sheetEscopoSel = document.getElementById('sheetEscopoSel');
  const sheetAbordagemSel = document.getElementById('sheetAbordagemSel');
  const sheetImpactoSel = document.getElementById('sheetImpactoSel');
  const sheetEsforcoSel = document.getElementById('sheetEsforcoSel');
  const sheetModalidadeSel = document.getElementById('sheetModalidadeSel');
  const sheetHasCaseChk = document.getElementById('sheetHasCaseChk');
  const sheetCaseRow = document.getElementById('sheetCaseRow');
  const sheetCaseText = document.getElementById('sheetCaseText');
  const sheetUrgSel = document.getElementById('sheetUrgSel');
  const sheetObservation = document.getElementById('sheetObservation');
  const relSearch = document.getElementById('relSearch');
  const relList = document.getElementById('relList');
  const sheetAndamentoSel = document.getElementById('sheetAndamentoSel');
  const sheetProgressoInput = document.getElementById('sheetProgressoInput');
  const sheetTipoSel = document.getElementById('sheetTipoSel');
  function applyToSelected(updater) {
    const id = state.ui.selectedId;
    if (id == null) return;
    const item = state.items.find(it => it.id === id);
    if (!item) return;
    updater(item);
  }
  sheetEscopoSel.addEventListener('change', () => {
    applyToSelected((it) => { it.escopoClass = sheetEscopoSel.value; it.escopoRaw = sheetEscopoSel.value; });
    render();
  });
  sheetAbordagemSel.addEventListener('change', () => {
    applyToSelected((it) => { it.abordagemClass = sheetAbordagemSel.value; it.abordagemRaw = sheetAbordagemSel.value; });
    render();
  });
  sheetImpactoSel.addEventListener('change', () => {
    applyToSelected((it) => { it.impactClass = sheetImpactoSel.value; it.impactRaw = sheetImpactoSel.value; });
    render();
  });
  sheetEsforcoSel.addEventListener('change', () => {
    applyToSelected((it) => { it.tipoEsforco = sheetEsforcoSel.value; });
    render();
    persistState();
    try { const it = state.items.find(x=>x.id===state.ui.selectedId); if (it) { if (window.demands && typeof window.demands.triggerSheetsUpsert==='function') window.demands.triggerSheetsUpsert(it); else triggerSheetsUpsert(it); } } catch(_){ }
  });
  if (sheetUrgSel) {
    sheetUrgSel.addEventListener('change', () => {
      applyToSelected((it) => { it.urgencia = parseInt(sheetUrgSel.value, 10); });
      render();
      persistState();
    });
  }

  // Diagnóstico fields
  if (sheetModalidadeSel) {
    sheetModalidadeSel.addEventListener('change', (e)=>{
      applyToSelected((it)=>{ it.modalidade = e.target.value; });
      persistState();
    });
  }
  if (sheetHasCaseChk) {
    sheetHasCaseChk.addEventListener('change', ()=>{
      const checked = !!sheetHasCaseChk.checked;
      if (sheetCaseRow) sheetCaseRow.classList.toggle('hidden', !checked);
      applyToSelected((it)=>{ it.hasCaseSpecial = checked; });
      persistState();
    });
  }
  if (sheetCaseText) {
    sheetCaseText.addEventListener('input', ()=>{
      applyToSelected((it)=>{ it.caseSpecial = sheetCaseText.value; });
      persistState();
    });
  }

  // Modalidades drawer logic
  function buildModalidadesOptions(selected){
    if (!modalidadesList) return;
    modalidadesList.innerHTML='';
    const opts = [
      'Chamada Pública da Agricultura Familiar',
      'Chamamento Público - 13.019',
      'Chamamento Público - 9.637',
      'Concorrência',
      'Concurso',
      'Contratação Direta',
      'Cotação',
      'Credenciamento',
      'Diálogo Competitivo',
      'Dispensa',
      'Dispensa - Lei das Estatais 13.303',
      'Inexigibilidade',
      'IRP–Intenção para Registro de Preço',
      'Leilão',
      'Leilão Eletrônico',
      'Pré-Qualificação',
      'Pregão',
      'Pregão Lei das Estatais 13.303',
      'Pregão para Registro de Preço',
      'RCE–Regime de Contratação Estatal',
      'Regime Diferenciado de Contratação'
    ];
    const selSet = new Set(Array.isArray(selected)? selected : (selected ? [selected] : []));
    for (const name of opts){
      const label=document.createElement('label');
      label.textContent = name;
      if (selSet.has(name)) label.classList.add('selected');
      modalidadesList.appendChild(label);
      label.addEventListener('click',()=>{
        const it=state.items.find(x=>x.id===state.ui.selectedId); if(!it) return;
        if (!Array.isArray(it.modalidades)) it.modalidades = [];
        const idx = it.modalidades.indexOf(name);
        if (idx >= 0) {
          // deselect
          it.modalidades.splice(idx,1);
          label.classList.remove('selected');
        } else {
          // select
          it.modalidades.push(name);
          label.classList.add('selected');
        }
        // keep a primary 'modalidade' for backward compatibility (first selected or empty)
        it.modalidade = it.modalidades[0] || '';
        persistState();
      });
    }
}

  function buildPersonaOptions(selectedArr){
    if (!personaList) return;
    personaList.innerHTML='';
    const opts = ['Comprador','Fornecedor','Pregoeiro','Apoio','Administrador','Outro'];
    const selSet = new Set(selectedArr||[]);
    for (const name of opts){
      const id = 'per_'+name.replace(/\W+/g,'_');
      const label=document.createElement('label');
      const cb=document.createElement('input'); cb.type='checkbox'; cb.id=id; cb.checked=selSet.has(name);
      const span=document.createElement('span'); span.textContent=name;
      label.appendChild(cb); label.appendChild(span);
      personaList.appendChild(label);
      cb.addEventListener('change',()=>{
        const it=state.items.find(x=>x.id===state.ui.selectedId); if(!it) return; if(!Array.isArray(it.personas)) it.personas=[];
        if (cb.checked){ if(!it.personas.includes(name)) it.personas.push(name); }
        else { const i=it.personas.indexOf(name); if(i>-1) it.personas.splice(i,1); }
        persistState();
      });
    }
  }

  function renderTokenList(container, list){
    if (!container) return;
    container.innerHTML = '';
    (list||[]).forEach((value)=>{
      const chip = document.createElement('span');
      chip.className = 'token';
      const text = document.createElement('span'); text.textContent = value;
      const btn = document.createElement('button'); btn.type='button'; btn.textContent='×';
      chip.appendChild(text); chip.appendChild(btn);
      container.appendChild(chip);
      btn.addEventListener('click',()=>{
        const it=state.items.find(x=>x.id===state.ui.selectedId); if(!it) return;
        const arr = (container===diagTechList) ? (it.tecnologias||[]) : (it.servicos||[]);
        const idx = arr.indexOf(value);
        if (idx>=0) arr.splice(idx,1);
        if (container===diagTechList) it.tecnologias = arr; else it.servicos = arr;
        renderTokenList(container, arr);
        persistState();
      });
    });
  }

  function bindToken(inputEl, addBtn, container, getter){
    if (!inputEl || !addBtn || !container) return;
    addBtn.addEventListener('click',()=>{
      const v = (inputEl.value||'').trim();
      if (!v) return;
      const it=state.items.find(x=>x.id===state.ui.selectedId); if(!it) return;
      const arr = getter(it);
      if (!arr.includes(v)) arr.push(v);
      renderTokenList(container, arr);
      inputEl.value='';
      persistState();
    });
    inputEl.addEventListener('keydown',(e)=>{ if(e.key==='Enter'){ e.preventDefault(); addBtn.click(); }});
  }

  function gatherSuggestions(kind){
    const set = new Set();
    for (const it of state.items){
      if (kind==='tech'){ (it.tecnologias||[]).forEach(v=>{ if(v) set.add(v); }); }
      else { (it.servicos||[]).forEach(v=>{ if(v) set.add(v); }); }
    }
    return Array.from(set).sort((a,b)=> a.localeCompare(b));
  }
  function showSuggestions(panel, inputEl, options, onPick){
    if (!panel || !inputEl) return;
    const q = (inputEl.value||'').toLowerCase();
    const filtered = options.filter(o=> !q || o.toLowerCase().includes(q)).slice(0, 30);
    panel.innerHTML = '';
    for (const opt of filtered){
      const div = document.createElement('div');
      div.className = 'suggest-option';
      div.textContent = opt;
      panel.appendChild(div);
      div.addEventListener('mousedown', (e)=>{ e.preventDefault(); onPick(opt); panel.classList.add('hidden'); });
    }
    panel.classList.toggle('hidden', filtered.length===0);
  }

  function openModalidadesDrawer(){
    const it=state.items.find(x=>x.id===state.ui.selectedId); if(!it) return;
    buildModalidadesOptions(it.modalidades);
    buildPersonaOptions(it.personas);
    if (legalReqChk){ legalReqChk.checked = !!it.legalRequired; }
    if (legalNotesRow){ legalNotesRow.classList.toggle('hidden', !it.legalRequired); }
    if (legalNotesText){ legalNotesText.value = it.legalNotes || ''; }
    // tokens lists
    if (!Array.isArray(it.tecnologias)) it.tecnologias = [];
    if (!Array.isArray(it.servicos)) it.servicos = [];
    renderTokenList(diagTechList, it.tecnologias);
    renderTokenList(diagServList, it.servicos);
    // tipos alteração
    if (!Array.isArray(it.tiposAlteracao)) it.tiposAlteracao = [];
    if (diagTypesArea){
      diagTypesArea.querySelectorAll('.chip-toggle').forEach(btn=>{
        const tipo = btn.getAttribute('data-tipo');
        if (it.tiposAlteracao.includes(tipo)) btn.classList.add('active'); else btn.classList.remove('active');
      });
    }
    // complexidade e horas
    if (diagComplexSel) diagComplexSel.value = it.complexidade || '';
    if (diagHoursInput) diagHoursInput.value = (it.horasEstimadas ?? '').toString();
    if (drawer){
      drawer.classList.remove('hidden');
      // allow transition
      requestAnimationFrame(()=> drawer.classList.add('open'));
    }
  }
  function closeModalidadesDrawer(){
    if (!drawer) return;
    drawer.classList.remove('open');
    const handler=()=>{ drawer.classList.add('hidden'); drawer.removeEventListener('transitionend', handler); };
    drawer.addEventListener('transitionend', handler);
  }

  openDrawerBtn?.addEventListener('click', openModalidadesDrawer);
  drawerBackBtn?.addEventListener('click', closeModalidadesDrawer);

  // legal requirement events
  if (legalReqChk){
    legalReqChk.addEventListener('change', ()=>{
      const it=state.items.find(x=>x.id===state.ui.selectedId); if(!it) return; it.legalRequired = !!legalReqChk.checked; persistState();
      if (legalNotesRow) legalNotesRow.classList.toggle(true, false); // force reflow
      if (legalNotesRow) legalNotesRow.classList.toggle('hidden', !legalReqChk.checked);
    });
  }
  if (legalNotesText){
    legalNotesText.addEventListener('input', ()=>{ const it=state.items.find(x=>x.id===state.ui.selectedId); if(!it) return; it.legalNotes = legalNotesText.value; persistState(); });
  }

  // bind tokens
  bindToken(diagTechInput, diagAddTechBtn, diagTechList, (it)=>{ if(!Array.isArray(it.tecnologias)) it.tecnologias=[]; return it.tecnologias; });
  bindToken(diagServInput, diagAddServBtn, diagServList, (it)=>{ if(!Array.isArray(it.servicos)) it.servicos=[]; return it.servicos; });

  // autocomplete for tokens
  if (diagTechInput && diagTechSuggest){
    const pick = (val)=>{ const it=state.items.find(x=>x.id===state.ui.selectedId); if(!it) return; if(!Array.isArray(it.tecnologias)) it.tecnologias=[]; if(!it.tecnologias.includes(val)) it.tecnologias.push(val); renderTokenList(diagTechList, it.tecnologias); diagTechInput.value=''; persistState(); };
    const refresh = ()=> showSuggestions(diagTechSuggest, diagTechInput, gatherSuggestions('tech'), pick);
    diagTechInput.addEventListener('input', refresh);
    diagTechInput.addEventListener('focus', refresh);
  }
  if (diagServInput && diagServSuggest){
    const pick = (val)=>{ const it=state.items.find(x=>x.id===state.ui.selectedId); if(!it) return; if(!Array.isArray(it.servicos)) it.servicos=[]; if(!it.servicos.includes(val)) it.servicos.push(val); renderTokenList(diagServList, it.servicos); diagServInput.value=''; persistState(); };
    const refresh = ()=> showSuggestions(diagServSuggest, diagServInput, gatherSuggestions('serv'), pick);
    diagServInput.addEventListener('input', refresh);
    diagServInput.addEventListener('focus', refresh);
  }
  document.addEventListener('click', (e)=>{
    if (diagTechSuggest && !diagTechSuggest.contains(e.target) && e.target!==diagTechInput) diagTechSuggest.classList.add('hidden');
    if (diagServSuggest && !diagServSuggest.contains(e.target) && e.target!==diagServInput) diagServSuggest.classList.add('hidden');
  });

  // tipos alteração
  if (diagTypesArea){
    diagTypesArea.addEventListener('click', (e)=>{
      const btn = e.target.closest('.chip-toggle'); if(!btn) return;
      const tipo = btn.getAttribute('data-tipo'); if(!tipo) return;
      const it=state.items.find(x=>x.id===state.ui.selectedId); if(!it) return;
      if (!Array.isArray(it.tiposAlteracao)) it.tiposAlteracao=[];
      const i = it.tiposAlteracao.indexOf(tipo);
      if (i>=0) { it.tiposAlteracao.splice(i,1); btn.classList.remove('active'); }
      else { it.tiposAlteracao.push(tipo); btn.classList.add('active'); }
      persistState();
    });
  }

  // complexidade / horas
  if (diagComplexSel){
    diagComplexSel.addEventListener('change', ()=>{ const it=state.items.find(x=>x.id===state.ui.selectedId); if(!it) return; it.complexidade = diagComplexSel.value || ''; persistState(); });
  }
  if (diagHoursInput){
    diagHoursInput.addEventListener('input', ()=>{ const it=state.items.find(x=>x.id===state.ui.selectedId); if(!it) return; const n=parseInt(diagHoursInput.value,10); it.horasEstimadas = Number.isFinite(n)? n : null; persistState(); });
  }
  sheetObservation.addEventListener('input', () => {
    applyToSelected((it) => { it.observation = sheetObservation.value; });
    persistState();
  });
  sheetAndamentoSel.addEventListener('change', () => {
    applyToSelected((it) => { it.andamento = sheetAndamentoSel.value === 'Sim'; });
    render();
    persistState();
  });
  sheetProgressoInput.addEventListener('input', () => {
    let v = parseInt(sheetProgressoInput.value || '0', 10);
    if (Number.isNaN(v)) v = 0;
    v = Math.min(100, Math.max(0, v));
    applyToSelected((it) => { it.progresso = v; });
    render();
    persistState();
    try { const it = state.items.find(x=>x.id===state.ui.selectedId); if (it) { if (window.demands && typeof window.demands.triggerSheetsUpsert==='function') window.demands.triggerSheetsUpsert(it); else triggerSheetsUpsert(it); } } catch(_){ }
  });
  sheetTipoSel.addEventListener('change', () => {
    applyToSelected((it) => { it.tipoEsforco = sheetTipoSel.value; });
    render();
    persistState();
  });
  if (relSearch && relList) {
    relSearch.addEventListener('input', () => {
      const id = state.ui.selectedId;
      if (id == null) return;
      const item = state.items.find(it => it.id === id);
      buildRelationsList(item, relList, relSearch.value);
    });
    relList.addEventListener('change', (e) => {
      const id = state.ui.selectedId;
      if (id == null) return;
      const item = state.items.find(it => it.id === id);
      if (!item) return;
      const target = e.target;
      if (target && target.matches('input[type="checkbox"][data-rel]')) {
        const rid = Number(target.getAttribute('data-rel'));
        if (target.checked) {
          if (!item.relatedIds.includes(rid)) item.relatedIds.push(rid);
        } else {
          item.relatedIds = item.relatedIds.filter(x => x !== rid);
        }
      }
    });
  }
});

function openNoteModal(itemId) {
  state.ui.selectedId = itemId;
  const item = state.items.find(it => it.id === itemId);
  const modal = document.getElementById('noteModal');
  const title = document.getElementById('noteItemTitle');
  const textarea = document.getElementById('noteTextarea');
  const parentDropdownBtn = document.getElementById('parentDropdownBtn');
  const noteTipoSel = document.getElementById('noteTipoSel');
  const noteUrgSel = document.getElementById('noteUrgSel');
  const noteGroupInput = document.getElementById('noteGroupInput');
  const noteSubSquadInput = document.getElementById('noteSubSquadInput');
  const noteImpactSel = document.getElementById('noteImpactSel');
  const noteEsforcoSel = document.getElementById('noteEsforcoSel');
  const noteBoraSel = document.getElementById('noteBoraSel');
  const noteGroupPanel = document.getElementById('noteGroupPanel');
  title.textContent = item?.demanda || '(sem título)';
  textarea.value = item?.observation || '';
  if (noteTipoSel && item) noteTipoSel.value = item.tipoEsforco || 'Tarefa';
  if (noteUrgSel && item) noteUrgSel.value = String(item.urgencia ?? 0);
  if (noteGroupInput) noteGroupInput.value = String((item?.grupo || '')).slice(0,60);
  if (noteSubSquadInput) noteSubSquadInput.value = String(item?.subSquad || '');
  if (noteImpactSel && item) noteImpactSel.value = item.impactClass || 'Baixo';
  if (noteEsforcoSel && item) noteEsforcoSel.value = item.effortClass || 'Baixo';
  if (noteBoraSel && item) noteBoraSel.value = String(item.boraImpact || '');
  if (noteGroupPanel) noteGroupPanel.classList.add('hidden');
  if (parentDropdownBtn && item) updateParentDropdownLabel(parentDropdownBtn, item);
  modal.classList.remove('hidden');
}

function closeNoteModal() {
  const modal = document.getElementById('noteModal');
  modal.classList.add('hidden');
  state.ui.selectedId = null;
}

function saveNoteModal() {
  const textarea = document.getElementById('noteTextarea');
  const id = state.ui.selectedId;
  if (id != null) {
    const item = state.items.find(it => it.id === id);
    if (item) item.observation = textarea.value;
    const noteTipoSel = document.getElementById('noteTipoSel');
    const noteUrgSel = document.getElementById('noteUrgSel');
    const noteGroupInput = document.getElementById('noteGroupInput');
    const noteSubSquadInput = document.getElementById('noteSubSquadInput');
    const noteImpactSel = document.getElementById('noteImpactSel');
    const noteEsforcoSel = document.getElementById('noteEsforcoSel');
    const noteBoraSel = document.getElementById('noteBoraSel');
    if (item && noteTipoSel) item.tipoEsforco = noteTipoSel.value;
    if (item && noteUrgSel) item.urgencia = Number(noteUrgSel.value);
    if (item && noteGroupInput) item.grupo = String(noteGroupInput.value||'').slice(0,60);
    if (item && noteSubSquadInput) item.subSquad = String(noteSubSquadInput.value||'');
    if (item && noteImpactSel) item.impactClass = noteImpactSel.value;
    if (item && noteEsforcoSel) item.effortClass = noteEsforcoSel.value;
    if (item && noteBoraSel) item.boraImpact = String(noteBoraSel.value||'');
  }
  // persist all edits including tipoEsforco possibly changed via dropdown
  persistState();
  console.log('[Sheets] saveNoteModal:persistState');
  console.log(state.ui.selectedId);
  try { 
      const item = state.items.find(it=> it.id===state.ui.selectedId); 
      if (item && window.demands && typeof window.demands.triggerSheetsUpsert === 'function') window.demands.triggerSheetsUpsert(item); 
      else if (item) triggerSheetsUpsert(item);
    } catch(_){
      console.log('[Sheets] saveNoteModal:upsertItemToSheets:error', _);
    }
  closeNoteModal();
  render();
}

function openObsModal(itemId) {
  const item = state.items.find(it => it.id === itemId);
  const modal = document.getElementById('obsModal');
  const title = document.getElementById('obsItemTitle');
  const content = document.getElementById('obsContent');
  title.textContent = item?.demanda || '(sem título)';
  content.textContent = item?.obsAdicionais || '—';
  modal.classList.remove('hidden');
}

function closeObsModal() {
  const modal = document.getElementById('obsModal');
  modal.classList.add('hidden');
}

function openDetailSheet(itemId) {
  const item = state.items.find(it => it.id === itemId);
  if (!item) return;
  state.ui.selectedId = itemId;
  document.getElementById('sheetTitle').textContent = item.demanda || '(sem título)';
  document.getElementById('sheetDemandaDesc').textContent = item.demandaDescricao || '—';
  document.getElementById('sheetObsAdd').textContent = item.obsAdicionais || '—';
  document.getElementById('sheetPrincipalImpacto').textContent = item.principalImpacto || '—';
  const sheetEscopoSel = document.getElementById('sheetEscopoSel');
  const sheetAbordagemSel = document.getElementById('sheetAbordagemSel');
  const sheetImpactoSel = document.getElementById('sheetImpactoSel');
  const sheetEsforcoSel = document.getElementById('sheetEsforcoSel');
  const sheetObservation = document.getElementById('sheetObservation');
  if (sheetEscopoSel) sheetEscopoSel.value = item.escopoClass || 'Outros';
  if (sheetAbordagemSel) sheetAbordagemSel.value = item.abordagemClass || 'Outros';
  if (sheetImpactoSel) sheetImpactoSel.value = item.impactClass || 'Baixo';
  if (sheetEsforcoSel) sheetEsforcoSel.value = item.effortClass || 'Baixo';
  if (sheetObservation) sheetObservation.value = item.observation || '';
  const sheetModalidadeSel2 = document.getElementById('sheetModalidadeSel');
  if (sheetModalidadeSel2) sheetModalidadeSel2.value = item.modalidade || '';
  const sheetHasCaseChk2 = document.getElementById('sheetHasCaseChk');
  const sheetCaseRow2 = document.getElementById('sheetCaseRow');
  const sheetCaseText2 = document.getElementById('sheetCaseText');
  if (sheetHasCaseChk2) sheetHasCaseChk2.checked = !!item.hasCaseSpecial;
  if (sheetCaseRow2) sheetCaseRow2.classList.toggle('hidden', !item.hasCaseSpecial);
  if (sheetCaseText2) sheetCaseText2.value = item.caseSpecial || '';
  const sheetAndamentoSel = document.getElementById('sheetAndamentoSel');
  const sheetProgressoInput = document.getElementById('sheetProgressoInput');
  const sheetTipoSel = document.getElementById('sheetTipoSel');
  if (sheetAndamentoSel) sheetAndamentoSel.value = item.andamento ? 'Sim' : 'Não';
  if (sheetProgressoInput) sheetProgressoInput.value = String(item.progresso ?? 0);
  if (sheetTipoSel) sheetTipoSel.value = item.tipoEsforco || 'Tarefa';
  if (sheetUrgSel) sheetUrgSel.value = String(item.urgencia ?? 0);
  const sheetSubInput = document.getElementById('sheetSubSquadInput');
  if (sheetSubInput) sheetSubInput.value = item.subSquad || '';
  const sheetBoraSel = document.getElementById('sheetBoraSel');
  if (sheetBoraSel) sheetBoraSel.value = String(item.boraImpact || '');
  const relList = document.getElementById('relList');
  const relSearch = document.getElementById('relSearch');
  if (relList) buildRelationsList(item, relList, relSearch?.value || '');
  document.getElementById('detailSheet').classList.remove('hidden');
  const backdrop = document.getElementById('sheetBackdrop');
  if (backdrop) {
    backdrop.classList.remove('hidden');
    // close on click outside
    const onClick = ()=>{ closeDetailSheet(); };
    backdrop.addEventListener('click', onClick, { once: true });
  }
}

function buildRelationsList(item, container, query = '') {
  if (!container || !item) return;
  clearChildren(container);
  const q = normalizeString(query || '');
  const options = state.items.filter(it => it.id !== item.id && (
    !q || normalizeString(it.demanda).includes(q) || normalizeString(it.demandaDescricao || '').includes(q)
  ));
  for (const other of options) {
    const label = document.createElement('label');
    label.className = 'rel-option';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.setAttribute('data-rel', String(other.id));
    cb.checked = item.relatedIds.includes(other.id);
    const span = document.createElement('span');
    span.textContent = other.demanda || '(sem título)';
    label.appendChild(cb);
    label.appendChild(span);
    container.appendChild(label);
  }
}

function buildParentList(item, container, query = '') {
  clearChildren(container);
  const q = normalizeString(query || '');
  const options = state.items.filter(it => it.id !== item.id && (
    !q || normalizeString(it.demanda).includes(q) || normalizeString(it.demandaDescricao || '').includes(q)
  ));
  // add 'Nenhum' option
  const noneLabel = document.createElement('label');
  noneLabel.className = 'rel-option';
  const noneRadio = document.createElement('input');
  noneRadio.type = 'radio';
  noneRadio.name = 'parentChoice';
  noneRadio.value = '';
  noneRadio.checked = item.parentId == null;
  const noneSpan = document.createElement('span');
  noneSpan.textContent = '— Nenhum —';
  noneLabel.appendChild(noneRadio);
  noneLabel.appendChild(noneSpan);
  container.appendChild(noneLabel);

  for (const other of options) {
    const label = document.createElement('label');
    label.className = 'rel-option';
    const rb = document.createElement('input');
    rb.type = 'radio';
    rb.name = 'parentChoice';
    rb.value = String(other.id);
    rb.checked = item.parentId === other.id;
    const span = document.createElement('span');
    span.textContent = other.demanda || '(sem título)';
    label.appendChild(rb);
    label.appendChild(span);
    container.appendChild(label);
  }
}

function updateParentDropdownLabel(buttonEl, item) {
  const label = (() => {
    if (!item || item.parentId == null) return 'Selecionar pai';
    const p = state.items.find(x => x.id === item.parentId);
    return p?.demanda || 'Selecionar pai';
  })();
  buttonEl.textContent = label;
  buttonEl.setAttribute('title', label);
}

function buildParentDropdownList(item, container, query = '') {
  clearChildren(container);
  const q = normalizeString(query || '');
  // opção Nenhum
  const none = document.createElement('div');
  none.className = 'dropdown-option';
  none.setAttribute('data-parent-id', '');
  none.textContent = '— Nenhum —';
  container.appendChild(none);
  for (const other of state.items) {
    if (other.id === item.id) continue;
    const name = other.demanda || '';
    if (q && !normalizeString(name).includes(q) && !normalizeString(other.demandaDescricao || '').includes(q)) continue;
    const row = document.createElement('div');
    row.className = 'dropdown-option';
    row.setAttribute('data-parent-id', String(other.id));
    row.textContent = name || '(sem título)';
    container.appendChild(row);
  }
}

function closeDetailSheet() {
  try { const item = state.items.find(it=> it.id===state.ui.selectedId); if (item) { persistState(); if (window.demands && typeof window.demands.triggerSheetsUpsert==='function') window.demands.triggerSheetsUpsert(item); else triggerSheetsUpsert(item); } } catch(_){}
  document.getElementById('detailSheet').addEventListener;
  document.getElementById('detailSheet').classList.add('hidden');
  const backdrop = document.getElementById('sheetBackdrop');
  if (backdrop) backdrop.classList.add('hidden');
  const drawer = document.getElementById('modalidadesDrawer');
  if (drawer) {
    drawer.classList.remove('open');
    drawer.classList.add('hidden');
  }
  render();
}


