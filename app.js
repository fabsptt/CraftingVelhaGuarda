/* ===========================================================
   VELHA GUARDA — Ledger de Mercado
   Vanilla JS, sem dependências. Dados: Albion Online Data Project.
   =========================================================== */

const API_BASE = 'https://europe.albion-online-data.com/api/v2/stats';
const CITIES = ['Martlock', 'Bridgewatch', 'Lymhurst', 'Fort Sterling', 'Thetford', 'Caerleon', 'Brecilien'];
const TIERS = ['T4', 'T5', 'T6', 'T7', 'T8'];
const ENCHANTS = [0, 1, 2, 3, 4]; // encantamento do item: base (.0) até .4
const RARIDADE_MATERIAL = { 0: '', 1: 'Incomum', 2: 'Raro', 3: 'Excecional', 4: 'Pristino' };

const els = {
  status: document.getElementById('status'),
  tbody: document.getElementById('tbody'),
  cidade: document.getElementById('cidade'),
  categoria: document.getElementById('categoria'),
  encantamento: document.getElementById('encantamento'),
  ordenar: document.getElementById('ordenar'),
  premium: document.getElementById('premium'),
  btn: document.getElementById('btnAtualizar'),
  tiers: document.getElementById('tiers'),
};

let RECIPES = null;
let PRICE_INDEX = {};   // itemId (com @N incluído) -> city -> {sell_price_min, buy_price_min}
let VOLUME_INDEX = {};  // itemId -> city -> total item_count (últimos dias)
let ROWS = [];           // linhas calculadas prontas a renderizar
let sortState = { key: 'lucro', dir: -1 };

init();

async function init() {
  RECIPES = await fetch('recipes.json').then(r => r.json());
  populateCategorias();
  bindEvents();
}

function populateCategorias() {
  const cats = [...new Set(RECIPES.itens.map(i => i.categoria))].sort();
  for (const c of cats) {
    const opt = document.createElement('option');
    opt.value = c;
    opt.textContent = c;
    els.categoria.appendChild(opt);
  }
}

function bindEvents() {
  els.btn.addEventListener('click', atualizar);

  els.tiers.querySelectorAll('.tier-chip').forEach(btn => {
    btn.addEventListener('click', () => {
      btn.setAttribute('aria-pressed', btn.getAttribute('aria-pressed') === 'true' ? 'false' : 'true');
    });
  });

  [els.cidade, els.categoria, els.encantamento, els.ordenar].forEach(el =>
    el.addEventListener('change', () => { if (ROWS.length) renderTabela(); })
  );

  document.querySelectorAll('#tabela thead th[data-sort]').forEach(th => {
    th.addEventListener('click', () => {
      const key = th.dataset.sort;
      sortState.dir = (sortState.key === key) ? -sortState.dir : -1;
      sortState.key = key;
      document.querySelectorAll('#tabela thead th').forEach(x => x.classList.remove('sorted'));
      th.classList.add('sorted');
      renderTabela();
    });
  });
}

function tiersAtivos() {
  return [...els.tiers.querySelectorAll('.tier-chip[aria-pressed="true"]')].map(b => b.dataset.tier);
}

function itemId(tier, base, enchant) {
  return enchant > 0 ? `${tier}_${base}@${enchant}` : `${tier}_${base}`;
}

// materiais refinados (barra/tábua/tecido/couro) seguem uma nomenclatura diferente do equipamento quando encantados
function matIdFor(tier, resourceKey, enchant) {
  return enchant > 0 ? `${tier}_${resourceKey}_LEVEL${enchant}@${enchant}` : `${tier}_${resourceKey}`;
}

function qtyFor(materialEntry, tier) {
  return materialEntry.qtd ?? RECIPES.quantidades_por_tier[materialEntry.peso][tier];
}

/* ---------- construir lista de item ids necessários ---------- */
function idsNecessarios(tiers) {
  const finished = [];
  const materials = new Set();

  for (const item of RECIPES.itens) {
    const enchants = item.semEncantamento ? [0] : ENCHANTS;
    for (const t of tiers) {
      for (const e of enchants) {
        finished.push({ ...item, tier: t, enchant: e, id: itemId(t, item.base, e) });
        for (const m of item.materiais) {
          materials.add(matIdFor(t, m.material, e));
        }
      }
    }
  }
  return { finished, materialIds: [...materials] };
}

/* ---------- fetch preços + histórico ---------- */
async function atualizar() {
  const tiers = tiersAtivos();
  if (!tiers.length) {
    setStatus('Seleciona pelo menos um tier.', true);
    return;
  }

  els.btn.disabled = true;
  setStatus('A contactar o Albion Online Data Project…');

  try {
    const { finished, materialIds } = idsNecessarios(tiers);
    const allIds = [...new Set([...finished.map(f => f.id), ...materialIds])];

    const citiesParam = CITIES.map(encodeURIComponent).join(',');

    setStatus(`A obter preços de ${allIds.length} itens (todos os tiers × encantamentos) em ${CITIES.length} cidades…`);
    PRICE_INDEX = await fetchPrices(allIds, citiesParam);

    setStatus('A obter histórico de transações (mais vendidos)…');
    try {
      VOLUME_INDEX = await fetchVolume(finished.map(f => f.id), citiesParam);
    } catch (e) {
      VOLUME_INDEX = {};
      console.warn('Histórico indisponível:', e);
    }

    calcularLinhas(finished);
    setStatus(`Atualizado — ${ROWS.length} combinações item/cidade/encantamento prontas. Fonte: Albion Online Data Project.`);
    renderTabela();
  } catch (err) {
    console.error(err);
    setStatus(`Erro ao processar dados: ${err.message}. Abre a consola do browser (F12) para mais detalhe.`, true);
  } finally {
    els.btn.disabled = false;
  }
}

async function fetchPrices(ids, citiesParam) {
  const chunks = chunk(ids, 45);
  const index = {};
  let falhas = 0;

  for (let i = 0; i < chunks.length; i++) {
    const c = chunks[i];
    const url = `${API_BASE}/prices/${c.join(',')}.json?locations=${citiesParam}&qualities=1`;
    try {
      setStatus(`A obter preços… (lote ${i + 1}/${chunks.length})`);
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      for (const row of data) {
        index[row.item_id] ??= {};
        index[row.item_id][row.city] = {
          sell_price_min: row.sell_price_min || 0,
          buy_price_min: row.buy_price_min || 0,
        };
      }
    } catch (e) {
      falhas++;
      console.warn(`Lote de preços ${i + 1}/${chunks.length} falhou:`, e);
    }
  }

  if (falhas === chunks.length) throw new Error('Todos os pedidos de preços falharam.');
  return index;
}

async function fetchVolume(ids, citiesParam) {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - 6);
  const fmt = d => `${d.getMonth() + 1}-${d.getDate()}-${d.getFullYear()}`;

  const chunks = chunk(ids, 60);
  const index = {};

  for (let i = 0; i < chunks.length; i++) {
    const c = chunks[i];
    const url = `${API_BASE}/history/${c.join(',')}.json?date=${fmt(start)}&end_date=${fmt(end)}&locations=${citiesParam}&time-scale=24`;
    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      const data = await res.json();
      for (const entry of data) {
        const total = (entry.data || []).reduce((s, p) => s + (p.item_count || 0), 0);
        index[entry.item_id] ??= {};
        index[entry.item_id][entry.location] = total;
      }
    } catch (e) {
      console.warn(`Lote de histórico ${i + 1}/${chunks.length} falhou:`, e);
    }
  }
  return index;
}

function iconUrl(itemId, size = 80) {
  return `https://render.albiononline.com/v1/item/${itemId}.png?quality=1&size=${size}`;
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/* ---------- cálculo de lucro por item/cidade/encantamento ---------- */
function calcularLinhas(finishedItems) {
  const tax = els.premium.checked ? 0.04 : 0.08;
  const rows = [];

  for (const item of finishedItems) {
    // resolve cada material da receita (pode ser 1 ou vários) para este tier/encantamento
    const materiaisResolvidos = item.materiais.map(m => ({
      matId: matIdFor(item.tier, m.material, item.enchant),
      nome: `${RARIDADE_MATERIAL[item.enchant]} ${RECIPES.materials[m.material].nome}`.trim(),
      qty: qtyFor(m, item.tier),
    }));

    for (const city of CITIES) {
      const priceFinished = PRICE_INDEX[item.id]?.[city];
      if (!priceFinished || !priceFinished.sell_price_min) continue;

      let custo = 0;
      let materiaisCompletos = true;
      const materiaisLinha = [];
      for (const m of materiaisResolvidos) {
        const priceMat = PRICE_INDEX[m.matId]?.[city];
        if (!priceMat || !priceMat.sell_price_min) { materiaisCompletos = false; break; }
        const subtotal = priceMat.sell_price_min * m.qty;
        custo += subtotal;
        materiaisLinha.push({ ...m, unit: priceMat.sell_price_min, subtotal });
      }
      if (!materiaisCompletos) continue;

      const venda = priceFinished.sell_price_min;
      const lucro = venda * (1 - tax) - custo;
      const margem = custo > 0 ? (lucro / custo) * 100 : 0;
      const volume = VOLUME_INDEX[item.id]?.[city] || 0;

      rows.push({
        id: item.id, nome: item.nome, en: item.en, tier: item.tier, enchant: item.enchant, categoria: item.categoria,
        cidade: city, venda, custo, lucro, margem, volume, materiais: materiaisLinha,
      });
    }
  }
  ROWS = rows;
}

/* ---------- render ---------- */
function renderTabela() {
  const cidadeSel = els.cidade.value;
  const catSel = els.categoria.value;
  const enchSel = els.encantamento.value; // 'ALL' ou '0'..'4'

  let rows = ROWS.filter(r =>
    (cidadeSel === 'ALL' || r.cidade === cidadeSel) &&
    (catSel === 'ALL' || r.categoria === catSel) &&
    (enchSel === 'ALL' || r.enchant === Number(enchSel))
  );

  let grouped = rows;
  if (cidadeSel === 'ALL') {
    const byItem = {};
    for (const r of rows) {
      const key = `${r.id}`;
      byItem[key] ??= [];
      byItem[key].push(r);
    }
    grouped = Object.values(byItem).map(list => {
      const melhor = list.slice().sort((a, b) => b.lucro - a.lucro)[0];
      melhor._todas = list;
      return melhor;
    });
  }

  if (!grouped.length) {
    els.tbody.innerHTML = `<tr><td colspan="7" class="empty">Sem resultados para estes filtros — experimenta outra combinação de tier/cidade/categoria/encantamento.</td></tr>`;
    document.getElementById('destaques').innerHTML = '';
    return;
  }

  renderDestaques(grouped.slice().sort((a, b) => b.lucro - a.lucro).slice(0, 3));

  const sortKey = mapOrdenarToKey(els.ordenar.value, sortState.key);
  grouped.sort((a, b) => {
    if (sortKey === 'nome') return a.nome.localeCompare(b.nome);
    return (b[sortKey] - a[sortKey]) * (sortState.dir === 1 ? -1 : 1);
  });

  const maxVol = Math.max(1, ...grouped.map(r => r.volume));
  els.tbody.innerHTML = '';

  grouped.forEach((r) => {
    const tr = document.createElement('tr');
    tr.className = 'row';
    tr.innerHTML = `
      <td>
        <div class="item-cell">
          <img class="item-icon" src="${iconUrl(r.id)}" alt="" loading="lazy" width="40" height="40" onerror="this.style.opacity=0.15">
          <span class="item-name">${r.nome}
            <span class="item-cat"><span class="tier-sigil">${r.tier}</span><span class="enchant-badge e${r.enchant}">.${r.enchant}</span>${r.categoria} · <em>${r.en}</em></span>
          </span>
        </div>
      </td>
      <td class="city-cell">${r.cidade}${cidadeSel === 'ALL' ? ' <span style="color:var(--muted)">(melhor)</span>' : ''}</td>
      <td class="num">${fmt(r.venda)}</td>
      <td class="num">${fmt(r.custo)}</td>
      <td class="num ${r.lucro >= 0 ? 'profit-pos' : 'profit-neg'}">${fmt(r.lucro)}</td>
      <td class="num ${r.lucro >= 0 ? 'profit-pos' : 'profit-neg'}">${r.margem.toFixed(0)}%</td>
      <td class="num"><span class="vol-badge ${r.volume >= maxVol * 0.5 ? 'hot' : ''}">${r.volume}</span></td>
    `;

    const detail = document.createElement('tr');
    detail.className = 'detail';
    detail.innerHTML = `<td colspan="7">${renderDetalhe(r)}</td>`;

    tr.addEventListener('click', () => detail.classList.toggle('open'));

    els.tbody.appendChild(tr);
    els.tbody.appendChild(detail);
  });
}

function renderDestaques(top3) {
  const host = document.getElementById('destaques');
  if (!top3.length) { host.innerHTML = ''; return; }

  host.innerHTML = `
    <div class="destaques-title">🏆 Vale mais a pena craftar agora</div>
    <div class="destaques-grid">
      ${top3.map((r, i) => `
        <div class="destaque-card ${i === 0 ? 'first' : ''}">
          <img src="${iconUrl(r.id, 96)}" alt="${r.nome}" loading="lazy" width="56" height="56" onerror="this.style.opacity=0.15">
          <div class="destaque-info">
            <div class="destaque-nome"><span class="tier-sigil">${r.tier}</span><span class="enchant-badge e${r.enchant}">.${r.enchant}</span>${r.nome}</div>
            <div class="destaque-onde"><em>${r.en}</em> · vende em <strong>${r.cidade}</strong></div>
            <div class="destaque-lucro ${r.lucro >= 0 ? 'profit-pos' : 'profit-neg'}">
              +${fmt(r.lucro)} prata/un. <span class="destaque-margem">(${r.margem.toFixed(0)}% margem)</span>
            </div>
          </div>
        </div>
      `).join('')}
    </div>
  `;
}

function renderDetalhe(r) {
  let comparacao = '';
  if (r._todas && r._todas.length > 1) {
    const pills = r._todas
      .slice().sort((a, b) => b.lucro - a.lucro)
      .map(x => `<span class="city-pill ${x.cidade === r.cidade ? 'best' : ''}">${x.cidade}: ${fmt(x.lucro)}</span>`)
      .join('');
    comparacao = `<div class="recipe-title" style="margin-top:16px;">Lucro por cidade (${r.tier}.${r.enchant})</div><div class="city-compare">${pills}</div>`;
  }

  let enchantsHtml = '';
  if (r.enchant !== undefined) {
    const outrosEnchants = ROWS.filter(x => x.tier === r.tier && x.categoria === r.categoria && x.nome === r.nome && x.cidade === r.cidade && x.enchant !== r.enchant);
    if (outrosEnchants.length) {
      const pills = [r, ...outrosEnchants]
        .slice().sort((a, b) => a.enchant - b.enchant)
        .map(x => `<span class="city-pill ${x.enchant === r.enchant ? 'best' : ''}">${x.tier}.${x.enchant}: ${fmt(x.venda)}</span>`)
        .join('');
      enchantsHtml = `<div class="recipe-title" style="margin-top:16px;">Preço de venda por encantamento em ${r.cidade}</div><div class="city-compare">${pills}</div>`;
    }
  }

  const linhasMateriais = r.materiais.map(m => `
      <div class="mat-cell"><img class="mat-icon" src="${iconUrl(m.matId, 48)}" alt="" loading="lazy" width="22" height="22" onerror="this.style.opacity=0.15">${m.nome}</div>
      <div>${m.qty}</div><div>${fmt(m.unit)}</div><div>${fmt(m.subtotal)}</div>
  `).join('');

  return `
    <div class="recipe-title">Receita — ${r.materiais.length > 1 ? 'vários materiais' : '1 material'} <span style="color:var(--muted)">(encantamento ${r.enchant} — igual ao do item)</span></div>
    <div class="recipe-grid">
      <div class="h">Material</div><div class="h">Qtd.</div><div class="h">Preço un.</div><div class="h">Subtotal</div>
      ${linhasMateriais}
      <div class="sum">Custo total</div><div class="sum"></div><div class="sum"></div><div class="sum">${fmt(r.custo)}</div>
    </div>
    ${enchantsHtml}
    ${comparacao}
  `;
}

function mapOrdenarToKey(select, clicked) {
  if (clicked && ['nome', 'cidade', 'venda', 'custo', 'lucro', 'margem', 'volume'].includes(clicked)) return clicked;
  return { lucro: 'lucro', margem: 'margem', volume: 'volume', nome: 'nome' }[select] || 'lucro';
}

function fmt(n) {
  return Math.round(n).toLocaleString('pt-PT');
}

function setStatus(msg, isErr = false) {
  els.status.textContent = msg;
  els.status.classList.toggle('err', !!isErr);
}
