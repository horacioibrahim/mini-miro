// Data state
const state = {
  items: [], // { id, demanda, effortRaw, impactRaw, abordagemRaw, escopoRaw, effortClass, impactClass, abordagemClass, escopoClass }
  filters: { abordagem: 'all', escopo: 'all' },
};

// Column header names (exact CSV headers expected)
const HEADERS = {
  DEMANDA: 'Demanda',
  ESFORCO: 'Esforço técnico para entregar em produção',
  IMPACTO: 'Qual o impacto econômico que poderá trazer?',
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
    const abordagemOk = abordagemFilter === 'all' || a === abordagemFilter;
    const escopoOk = escopoFilter === 'all' || e === escopoFilter;
    return abordagemOk && escopoOk;
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
  const title = el('div', 'card-title');
  title.textContent = item.demanda || '(sem título)';
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
  const impactPill = el('span', 'pill');
  impactPill.textContent = `Impacto: ${item.impactClass || '—'}`;
  const abordagemPill = el('span', 'pill');
  abordagemPill.textContent = `Abordagem: ${item.abordagemClass || 'Outros'}`;
  const escopoPill = el('span', 'pill');
  escopoPill.textContent = `Escopo: ${item.escopoClass || 'Outros'}`;

  meta.appendChild(effortPill);
  meta.appendChild(impactPill);
  meta.appendChild(abordagemPill);
  meta.appendChild(escopoPill);

  card.appendChild(title);
  card.appendChild(meta);

  // DnD events
  card.addEventListener('dragstart', (ev) => {
    ev.dataTransfer.setData('text/plain', String(item.id));
    ev.dataTransfer.effectAllowed = 'move';
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
    const effortClass = classifyEffort(effortRaw);
    const impactClass = classifyImpact(impactRaw);
    const abordagemClass = classifyAbordagem(abordagemRaw);
    const escopoClass = classifyEscopo(escopoRaw);
    return {
      id: idx + 1,
      demanda,
      effortRaw,
      impactRaw,
      abordagemRaw,
      escopoRaw,
      effortClass,
      impactClass,
      abordagemClass,
      escopoClass,
      _original: o,
    };
  });

  state.items = items;
  render();
}

// Export with classification columns appended (does not overwrite originals)
function exportCsv() {
  if (!state.items.length) return;
  const originalHeaders = Object.keys(state.items[0]._original);
  const extraHeaders = ['Esforco_Class', 'Impacto_Class', 'Abordagem_Class', 'Escopo_Class'];
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
    const extras = [it.effortClass, it.impactClass, it.abordagemClass, it.escopoClass].map(esc);
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
  abordagemSel.addEventListener('change', () => {
    state.filters.abordagem = abordagemSel.value;
    render();
  });
  escopoSel.addEventListener('change', () => {
    state.filters.escopo = escopoSel.value;
    render();
  });
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
});


