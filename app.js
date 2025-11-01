// Data state
const state = {
  items: [], // { id, demanda, squad, observation, parentId, relatedIds: number[], effortRaw, impactRaw, abordagemRaw, escopoRaw, principalImpacto, principalImpactClass, tipoEsforco, progresso, andamento }
  filters: { abordagem: 'all', escopo: 'all', principal: 'all', squad: [], text: '', showRelations: false },
  ui: { isDragging: false, selectedId: null },
};

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
  const m = String(raw).match(/\d+/);
  const v = m ? Number(m[0]) : Number(raw);
  if (Number.isNaN(v)) return 0;
  return Math.min(100, Math.max(0, v));
}

function classifyTipoEsforco(raw) {
  const n = normalizeString(raw);
  if (!n) return null;
  if (n.includes('tarefa')) return 'Tarefa';
  if (n.includes('iniciat')) return 'Iniciativa';
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
    const abordagemOk = abordagemFilter === 'all' || a === abordagemFilter;
    const escopoOk = escopoFilter === 'all' || e === escopoFilter;
    const principalOk = principalFilter === 'all' || p === principalFilter;
    const squadOk = !Array.isArray(squadFilter) || squadFilter.length === 0
      ? true
      : squadFilter.includes(s);
    const textOk = !textFilter
      || normalizeString(item.demanda).includes(textFilter)
      || normalizeString(item.demandaDescricao || '').includes(textFilter);
    return abordagemOk && escopoOk && principalOk && squadOk && textOk;
  };

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
  if (item.tipoEsforco === 'Tarefa') tipoBadge.classList.add('badge--tarefa');
  else if (item.tipoEsforco === 'Iniciativa') tipoBadge.classList.add('badge--iniciativa');
  else if (item.tipoEsforco === 'Follow-up') tipoBadge.classList.add('badge--follow');
  tipoBadge.textContent = item.tipoEsforco || '—';
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
  bar.style.width = `${item.progresso ?? 0}%`;
  progress.appendChild(bar);
  const label = el('div', 'progress-label');
  label.textContent = `${item.progresso ?? 0}%`;
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
  }));

  attachDropEvents(backlog, (item) => {
    item.effortClass = null;
    item.impactClass = null;
  });
}

// File handling
async function handleFile(file) {
  const text = await file.text();
  const rows = parseCsv(text);
  const objs = rowsToObjects(rows);

  const items = objs.map((o, idx) => {
    const effortRaw = valueByPossibleKeys(o, [HEADERS.ESFORCO]);
    const impactRaw = valueByPossibleKeys(o, [HEADERS.IMPACTO]);
    const abordagemRaw = valueByPossibleKeys(o, [HEADERS.ABORDAGEM]);
    const escopoRaw = valueByPossibleKeys(o, [HEADERS.ESCOPO]);
    const demanda = valueByPossibleKeys(o, [HEADERS.DEMANDA, 'demanda']);
    const squad = valueByPossibleKeys(o, [HEADERS.SQUAD, 'squad', 'Squad']);
    const obsAdicionais = valueByPossibleKeys(o, [HEADERS.OBS_ADICIONAIS, 'Observações adicionais']);
    const demandaDescricao = valueByPossibleKeys(o, [HEADERS.DEMANDA_DESC, 'Demanda descrição']);
    const principalImpacto = valueByPossibleKeys(o, [HEADERS.PRINCIPAL_IMPACTO]);
    const andamentoRaw = valueByPossibleKeys(o, [HEADERS.ANDAMENTO, 'Andamento']);
    const progressoRaw = valueByPossibleKeys(o, [HEADERS.PROGRESSO, 'Progresso']);
    const tipoEsforcoRaw = valueByPossibleKeys(o, [HEADERS.TIPO_ESFORCO, 'Tipo esforço', 'Tipo']);
    const effortClass = classifyEffort(effortRaw);
    const impactClass = classifyImpact(impactRaw);
    const abordagemClass = classifyAbordagem(abordagemRaw);
    const escopoClass = classifyEscopo(escopoRaw);
    const principalImpactClass = classifyPrincipalImpact(principalImpacto);
    const andamento = parseAndamento(andamentoRaw);
    const progresso = parseProgresso(progressoRaw);
    const tipoEsforco = classifyTipoEsforco(tipoEsforcoRaw);
    return {
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
      parentId: null,
      relatedIds: [],
      observation: '',
      _original: o,
    };
  });

  state.items = items;
  populateSquadFilter();
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
  const originalHeaders = Object.keys(state.items[0]._original);
  const extraHeaders = ['Esforco_Class', 'Impacto_Class', 'Abordagem_Class', 'Escopo_Class', 'PrincipalImpacto_Class', 'Andamento', 'Progresso', 'TipoEsforco', 'Pai', 'Relacionamentos', 'Observacao_Complementar'];
  const headers = [...originalHeaders, ...extraHeaders];

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
    const base = originalHeaders.map(h => esc(it._original[h] ?? ''));
    const relatedNames = (it.relatedIds || []).map(id => {
      const other = state.items.find(x => x.id === id);
      return other?.demanda || `#${id}`;
    }).join('; ');
    const parentName = (() => { const p = state.items.find(x => x.id === it.parentId); return p?.demanda || ''; })();
    const extras = [
      it.effortClass,
      it.impactClass,
      it.abordagemClass,
      it.escopoClass,
      it.principalImpactClass,
      it.andamento ? 'Sim' : 'Não',
      `${it.progresso ?? 0}%`,
      it.tipoEsforco || '',
      parentName,
      relatedNames,
      it.observation,
    ].map(esc);
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
  const squadBtn = document.getElementById('squadDropdownBtn');
  const squadPanel = document.getElementById('squadDropdownPanel');
  const textInput = document.getElementById('textFilter');
  const relationsToggle = document.getElementById('relationsToggle');
  abordagemSel.addEventListener('change', () => {
    state.filters.abordagem = abordagemSel.value;
    render();
  });
  escopoSel.addEventListener('change', () => {
    state.filters.escopo = escopoSel.value;
    render();
  });
  principalSel.addEventListener('change', () => {
    state.filters.principal = principalSel.value;
    render();
  });
  if (textInput) {
    textInput.addEventListener('input', () => {
      state.filters.text = textInput.value;
      render();
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
      render();
    });
  }
  if (relationsToggle) {
    relationsToggle.addEventListener('change', () => {
      state.filters.showRelations = relationsToggle.checked;
      drawRelations();
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
  fileInput.addEventListener('change', (ev) => {
    const f = ev.target.files?.[0];
    if (f) handleFile(f);
  });

  // Export button
  const exportBtn = document.getElementById('exportCsvBtn');
  exportBtn.addEventListener('click', exportCsv);

  // keep relation lines updated on viewport changes
  window.addEventListener('resize', drawRelations);
  window.addEventListener('scroll', drawRelations, true);

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

  // Obs adicionais modal
  const obsModal = document.getElementById('obsModal');
  const obsClose = document.getElementById('obsCloseBtn');
  const obsOk = document.getElementById('obsOkBtn');
  obsClose.addEventListener('click', closeObsModal);
  obsOk.addEventListener('click', closeObsModal);
  obsModal.addEventListener('click', (e) => { if (e.target === obsModal) closeObsModal(); });

  // Sheet
  const sheet = document.getElementById('detailSheet');
  const sheetCloseBtn = document.getElementById('sheetCloseBtn');
  sheetCloseBtn.addEventListener('click', closeDetailSheet);
  const sheetEscopoSel = document.getElementById('sheetEscopoSel');
  const sheetAbordagemSel = document.getElementById('sheetAbordagemSel');
  const sheetImpactoSel = document.getElementById('sheetImpactoSel');
  const sheetEsforcoSel = document.getElementById('sheetEsforcoSel');
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
    applyToSelected((it) => { it.effortClass = sheetEsforcoSel.value; it.effortRaw = sheetEsforcoSel.value; });
    render();
  });
  sheetObservation.addEventListener('input', () => {
    applyToSelected((it) => { it.observation = sheetObservation.value; });
  });
  sheetAndamentoSel.addEventListener('change', () => {
    applyToSelected((it) => { it.andamento = sheetAndamentoSel.value === 'Sim'; });
    render();
  });
  sheetProgressoInput.addEventListener('input', () => {
    let v = parseInt(sheetProgressoInput.value || '0', 10);
    if (Number.isNaN(v)) v = 0;
    v = Math.min(100, Math.max(0, v));
    applyToSelected((it) => { it.progresso = v; });
    render();
  });
  sheetTipoSel.addEventListener('change', () => {
    applyToSelected((it) => { it.tipoEsforco = sheetTipoSel.value; });
    render();
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
  title.textContent = item?.demanda || '(sem título)';
  textarea.value = item?.observation || '';
  if (noteTipoSel && item) noteTipoSel.value = item.tipoEsforco || 'Tarefa';
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
  const sheetAndamentoSel = document.getElementById('sheetAndamentoSel');
  const sheetProgressoInput = document.getElementById('sheetProgressoInput');
  const sheetTipoSel = document.getElementById('sheetTipoSel');
  if (sheetAndamentoSel) sheetAndamentoSel.value = item.andamento ? 'Sim' : 'Não';
  if (sheetProgressoInput) sheetProgressoInput.value = String(item.progresso ?? 0);
  if (sheetTipoSel) sheetTipoSel.value = item.tipoEsforco || 'Tarefa';
  const relList = document.getElementById('relList');
  const relSearch = document.getElementById('relSearch');
  if (relList) buildRelationsList(item, relList, relSearch?.value || '');
  document.getElementById('detailSheet').classList.remove('hidden');
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
  document.getElementById('detailSheet').classList.add('hidden');
  render();
}


