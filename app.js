/* ===========================================================
   VELHA GUARDA — Ledger de Mercado
   Vanilla JS, sem dependências. Dados: Albion Online Data Project.
   =========================================================== */

const API_BASE = 'https://europe.albion-online-data.com/api/v2/stats';
const CITIES = ['Martlock', 'Bridgewatch', 'Lymhurst', 'Fort Sterling', 'Thetford', 'Caerleon', 'Brecilien'];
const TIERS = ['T4', 'T5', 'T6', 'T7', 'T8'];
const QUALITIES = [1, 2, 3, 4, 5];
const QUALITY_INFO = {
  1: { nome: 'Normal',      estrelas: 0 },
  2: { nome: 'Boa',         estrelas: 1 },
  3: { nome: 'Notável',     estrelas: 2 },
  4: { nome: 'Excelente',   estrelas: 3 },
  5: { nome: 'Obra-prima',  estrelas: 4 },
};

const els = {
  status: document.getElementById('status'),
  tbody: document.getElementById('tbody'),
  cidade: document.getElementById('cidade'),
  categoria: document.getElementById('categoria'),
  qualidade: document.getElementById('qualidade'),
  ordenar: document.getElementById('ordenar'),
  premium: document.getElementById('premium'),
  btn: document.getElementById('btnAtualizar'),
  tiers: document.getElementById('tiers'),
};

let RECIPES = null;
let PRICE_INDEX = {};   // itemId -> city -> quality -> {sell_price_min, buy_price_min}
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

  [els.cidade, els.categoria, els.qualidade, els.ordenar].forEach(el =>
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

/* ---------- construir lista de item ids necessários ---------- */
function idsNecessarios(tiers) {
  const finished = [];
  const materials = new Set();

  for (const item of RECIPES.itens) {
    for (const t of tiers) {
      finished.push({ ...item, tier: t, id: `${t}_${item.base}` });
      const matTierIds = RECIPES.materials[item.material].tiers;
      const tierIdx = TIERS.indexOf(t);
      materials.add(matTierIds[tierIdx]);
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

    // preços atuais
    setStatus(`A obter preços de ${allIds.length} itens em ${CITIES.length} cidades…`);
    PRICE_INDEX = await fetchPrices(allIds, citiesParam);

    // histórico (proxy de volume — "mais vendidos"), tolera falha
    setStatus('A obter histórico de transações (mais vendidos)…');
    try {
      VOLUME_INDEX = await fetchVolume(finished.map(f => f.id), citiesParam);
    } catch (e) {
      VOLUME_INDEX = {};
      console.warn('Histórico indisponível:', e);
    }

    calcularLinhas(finished);
    setStatus(`Atualizado — ${ROWS.length} combinações item/cidade/qualidade prontas. Fonte: Albion Online Data Project.`);
    renderTabela();
  } catch (err) {
    console.error(err);
    setStatus('Não foi possível obter dados do mercado agora. Tenta novamente dentro de momentos.', true);
  } finally {
    els.btn.disabled = false;
  }
}

async function fetchPrices(ids, citiesParam) {
  // a API aceita muitos ids numa só chamada, separados por vírgula
  const chunks = chunk(ids, 150); // margem de segurança para o comprimento do URL (mais qualidades = resposta maior)
  const index = {};
  const qualitiesParam = QUALITIES.join(',');

  for (const c of chunks) {
    const url = `${API_BASE}/prices/${c.join(',')}.json?locations=${citiesParam}&qualities=${qualitiesParam}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Falha ao obter preços (${res.status})`);
    const data = await res.json();
    for (const row of data) {
      index[row.item_id] ??= {};
      index[row.item_id][row.city] ??= {};
      index[row.item_id][row.city][row.quality] = {
        sell_price_min: row.sell_price_min || 0,
        buy_price_min: row.buy_price_min || 0,
      };
    }
  }
  return index;
}

async function fetchVolume(ids, citiesParam) {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - 6);
  const fmt = d => `${d.getMonth() + 1}-${d.getDate()}-${d.getFullYear()}`;

  const chunks = chunk(ids, 120);
  const index = {};

  for (const c of chunks) {
    const url = `${API_BASE}/history/${c.join(',')}.json?date=${fmt(start)}&end_date=${fmt(end)}&locations=${citiesParam}&time-scale=24`;
    const res = await fetch(url);
    if (!res.ok) continue;
    const data = await res.json();
    for (const entry of data) {
      const total = (entry.data || []).reduce((s, p) => s + (p.item_count || 0), 0);
      index[entry.item_id] ??= {};
      index[entry.item_id][entry.location] = total;
    }
  }
  return index;
}

function iconUrl(itemId, size = 80, quality = 1) {
  return `https://render.albiononline.com/v1/item/${itemId}.png?quality=${quality}&size=${size}`;
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/* ---------- cálculo de lucro por item/cidade/qualidade ---------- */
function calcularLinhas(finishedItems) {
  const tax = els.premium.checked ? 0.04 : 0.08;
  const rows = [];

  for (const item of finishedItems) {
    const qty = RECIPES.quantidades_por_tier[item.peso][item.tier];
    const matDef = RECIPES.materials[item.material];
    const matId = matDef.tiers[TIERS.indexOf(item.tier)];

    for (const city of CITIES) {
      // custo dos materiais é sempre calculado com qualidade Normal (a mais comum de comprar para craftar)
      const priceMat = PRICE_INDEX[matId]?.[city]?.[1];
      if (!priceMat || !priceMat.sell_price_min) continue;

      for (const q of QUALITIES) {
        const priceFinished = PRICE_INDEX[item.id]?.[city]?.[q];
        if (!priceFinished || !priceFinished.sell_price_min) continue;

        const venda = priceFinished.sell_price_min;
        const custo = priceMat.sell_price_min * qty;
        const lucro = venda * (1 - tax) - custo;
        const margem = custo > 0 ? (lucro / custo) * 100 : 0;
        const volume = VOLUME_INDEX[item.id]?.[city] || 0;

        rows.push({
          id: item.id, nome: item.nome, en: item.en, tier: item.tier, categoria: item.categoria,
          cidade: city, qualidade: q, venda, custo, lucro, margem, volume,
          material: matDef.nome, matId, qty, matUnit: priceMat.sell_price_min,
        });
      }
    }
  }
  ROWS = rows;
}

/* ---------- render ---------- */
function renderTabela() {
  const cidadeSel = els.cidade.value;
  const catSel = els.categoria.value;
  const qualSel = els.qualidade.value; // 'ALL' ou '1'..'5'

  let rows = ROWS.filter(r =>
    (cidadeSel === 'ALL' || r.cidade === cidadeSel) &&
    (catSel === 'ALL' || r.categoria === catSel) &&
    (qualSel === 'ALL' || r.qualidade === Number(qualSel))
  );

  // no modo "comparar todas" (cidade) mostramos só a melhor cidade por item+qualidade, com comparação no detalhe
  let grouped = rows;
  if (cidadeSel === 'ALL') {
    const byItem = {};
    for (const r of rows) {
      const key = `${r.id}__${r.qualidade}`;
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
    els.tbody.innerHTML = `<tr><td colspan="7" class="empty">Sem resultados para estes filtros — experimenta outra combinação de tier/cidade/categoria.</td></tr>`;
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

  grouped.forEach((r, idx) => {
    const tr = document.createElement('tr');
    tr.className = 'row';
    tr.innerHTML = `
      <td>
        <div class="item-cell">
          <img class="item-icon" src="${iconUrl(r.id, 80, r.qualidade)}" alt="" loading="lazy" width="40" height="40" onerror="this.style.opacity=0.15">
          <span class="item-name">${r.nome}
            <span class="item-cat"><span class="tier-sigil">${r.tier}</span><span class="quality-badge q${r.qualidade}">.${r.qualidade - 1}</span>${r.categoria} · <em>${r.en}</em></span>
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
          <img src="${iconUrl(r.id, 96, r.qualidade)}" alt="${r.nome}" loading="lazy" width="56" height="56" onerror="this.style.opacity=0.15">
          <div class="destaque-info">
            <div class="destaque-nome"><span class="tier-sigil">${r.tier}</span><span class="quality-badge q${r.qualidade}">.${r.qualidade - 1}</span>${r.nome}</div>
            <div class="destaque-onde"><em>${r.en}</em> (${QUALITY_INFO[r.qualidade].nome}) · vende em <strong>${r.cidade}</strong></div>
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
    comparacao = `<div class="recipe-title" style="margin-top:16px;">Lucro por cidade (qualidade ${QUALITY_INFO[r.qualidade].nome})</div><div class="city-compare">${pills}</div>`;
  }

  const outrasQualidades = ROWS.filter(x => x.id === r.id && x.cidade === r.cidade && x.qualidade !== r.qualidade);
  let qualidadesHtml = '';
  if (outrasQualidades.length) {
    const pills = [r, ...outrasQualidades]
      .slice().sort((a, b) => a.qualidade - b.qualidade)
      .map(x => `<span class="city-pill ${x.qualidade === r.qualidade ? 'best' : ''}">.${x.qualidade - 1} ${QUALITY_INFO[x.qualidade].nome}: ${fmt(x.venda)}</span>`)
      .join('');
    qualidadesHtml = `<div class="recipe-title" style="margin-top:16px;">Preço de venda por qualidade em ${r.cidade}</div><div class="city-compare">${pills}</div>`;
  }

  return `
    <div class="recipe-title">Receita — ${r.qty}× ${r.material} <span style="color:var(--muted)">(materiais em qualidade Normal)</span></div>
    <div class="recipe-grid">
      <div class="h">Material</div><div class="h">Qtd.</div><div class="h">Preço un.</div><div class="h">Subtotal</div>
      <div class="mat-cell"><img class="mat-icon" src="${iconUrl(r.matId, 48)}" alt="" loading="lazy" width="22" height="22" onerror="this.style.opacity=0.15">${r.material}</div>
      <div>${r.qty}</div><div>${fmt(r.matUnit)}</div><div>${fmt(r.qty * r.matUnit)}</div>
      <div class="sum">Custo total</div><div class="sum"></div><div class="sum"></div><div class="sum">${fmt(r.custo)}</div>
    </div>
    ${qualidadesHtml}
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
