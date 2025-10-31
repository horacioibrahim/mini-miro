// Data state
const state = {
  items: [], // { id, demanda, squad, observation, effortRaw, impactRaw, abordagemRaw, escopoRaw, effortClass, impactClass, abordagemClass, escopoClass }
  filters: { abordagem: 'all', escopo: 'all', squad: [], text: '' },
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
    const s = item.squad || 'Outros';
    const abordagemOk = abordagemFilter === 'all' || a === abordagemFilter;
    const escopoOk = escopoFilter === 'all' || e === escopoFilter;
    const squadOk = !Array.isArray(squadFilter) || squadFilter.length === 0
      ? true
      : squadFilter.includes(s);
    const textOk = !textFilter
      || normalizeString(item.demanda).includes(textFilter)
      || normalizeString(item.demandaDescricao || '').includes(textFilter);
    return abordagemOk && escopoOk && squadOk && textOk;
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

  card.appendChild(head);
  card.appendChild(meta);

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
    const effortClass = classifyEffort(effortRaw);
    const impactClass = classifyImpact(impactRaw);
    const abordagemClass = classifyAbordagem(abordagemRaw);
    const escopoClass = classifyEscopo(escopoRaw);
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
  const extraHeaders = ['Esforco_Class', 'Impacto_Class', 'Abordagem_Class', 'Escopo_Class', 'Observacao_Complementar'];
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
    const extras = [it.effortClass, it.impactClass, it.abordagemClass, it.escopoClass, it.observation].map(esc);
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
  const squadBtn = document.getElementById('squadDropdownBtn');
  const squadPanel = document.getElementById('squadDropdownPanel');
  const textInput = document.getElementById('textFilter');
  abordagemSel.addEventListener('change', () => {
    state.filters.abordagem = abordagemSel.value;
    render();
  });
  escopoSel.addEventListener('change', () => {
    state.filters.escopo = escopoSel.value;
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

  // Modal wiring
  const modal = document.getElementById('noteModal');
  const closeBtn = document.getElementById('noteCloseBtn');
  const cancelBtn = document.getElementById('noteCancelBtn');
  const saveBtn = document.getElementById('noteSaveBtn');
  closeBtn.addEventListener('click', closeNoteModal);
  cancelBtn.addEventListener('click', closeNoteModal);
  saveBtn.addEventListener('click', saveNoteModal);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeNoteModal();
  });

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
});

function openNoteModal(itemId) {
  state.ui.selectedId = itemId;
  const item = state.items.find(it => it.id === itemId);
  const modal = document.getElementById('noteModal');
  const title = document.getElementById('noteItemTitle');
  const textarea = document.getElementById('noteTextarea');
  title.textContent = item?.demanda || '(sem título)';
  textarea.value = item?.observation || '';
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
  document.getElementById('detailSheet').classList.remove('hidden');
}

function closeDetailSheet() {
  document.getElementById('detailSheet').classList.add('hidden');
  render();
}


