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
  maisVendidos: document.getElementById('maisVendidos'),
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

// Bónus de fabrico da imagem da Velha Guarda: +15% de RRR na cidade indicada.
// Sem bónus de cidade, o RRR base considerado é 15,2%; com o bónus de cidade é 24,8%.
const CRAFT_BONUS_CATEGORIES = {
  'Martlock': ['Arma - Machado','Arma - Bordão','Arma - Cajado de Gelo','Placas - Pés','Mão Secundária - Escudo','Mão Secundária - Tocha','Mão Secundária - Tomo'],
  'Lymhurst': ['Arma - Espada','Arma - Arco','Arma - Cajado Arcano','Couro - Cabeça','Couro - Pés'],
  'Bridgewatch': ['Arma - Adaga','Arma - Besta','Arma - Cajado Amaldiçoado','Placas - Peito','Tecido - Pés'],
  'Fort Sterling': ['Arma - Martelo','Arma - Lança','Arma - Cajado Sagrado','Placas - Cabeça','Tecido - Peito'],
  'Thetford': ['Arma - Maça','Arma - Cajado da Natureza','Arma - Cajado de Fogo','Tecido - Cabeça','Couro - Peito'],
};
const BASE_RRR = 0.152;
const BONUS_RRR = 0.248;

function craftRRR(city, categoria) {
  return (CRAFT_BONUS_CATEGORIES[city] || []).includes(categoria) ? BONUS_RRR : BASE_RRR;
}

function itemId(tier, base, enchant) {
  return enchant > 0 ? `${tier}_${base}@${enchant}` : `${tier}_${base}`;
}

function matIdFor(tier, resourceKey, enchant) {
  return enchant > 0 ? `${tier}_${resourceKey}_LEVEL${enchant}@${enchant}` : `${tier}_${resourceKey}`;
}

function qtyFor(materialEntry, tier) {
  return materialEntry.qtd ?? materialEntry.qtdPorTier?.[tier] ?? RECIPES.quantidades_por_tier?.[materialEntry.peso]?.[tier] ?? 1;
}

// Cada material passa a ser uma lista de opções de compra. Isto é importante
// para artefactos: muitas receitas aceitam o artefacto normal OU o artefacto cristalizado.
function resolverMaterialOptions(entry, tier, enchant) {
  const qty = qtyFor(entry, tier);
  const options = [];

  if (entry.idFixo) {
    options.push({ matId: entry.idFixo, nome: entry.nome, qty, retornavel: false });
  } else if (entry.idTemplate) {
    options.push({ matId: entry.idTemplate.replace('{tier}', tier), nome: entry.nome, qty, retornavel: false });
  } else if (entry.itemRef) {
    const enchantMat = entry.semEncantamento ? 0 : enchant;
    options.push({ matId: itemId(tier, entry.itemRef, enchantMat), nome: entry.nome, qty, retornavel: false });
  } else if (entry.material) {
    options.push({
      matId: matIdFor(tier, entry.material, enchant),
      nome: `${RARIDADE_MATERIAL[enchant]} ${RECIPES.materials[entry.material]?.nome || entry.material}`.trim(),
      qty,
      retornavel: true,
    });
  }

  // Ingrediente de artefacto específico do item.
  if (entry.artefacto) {
    options.push({
      matId: entry.artefacto.replace('{tier}', tier),
      nome: 'Artefacto',
      qty,
      retornavel: false,
    });
  }
  return options;
}

function resolverMaterial(entry, tier, enchant) {
  const options = resolverMaterialOptions(entry, tier, enchant);
  return options[0] || { matId: '', nome: entry.nome || 'Material', qty: qtyFor(entry, tier), retornavel: false };
}

function materialOptions(item, tier, enchant) {
  const out = [];
  for (const m of item.materiais) {
    const opts = resolverMaterialOptions(m, tier, enchant);
    if (m.artefacto) {
      // A entrada de artefacto no próprio item é adicionada como opção separada.
      out.push([{ matId: m.artefacto.replace('{tier}', tier), nome: 'Artefacto', qty: qtyFor(m, tier), retornavel: false }]);
    } else {
      out.push(opts);
    }
  }
  if (item.artefacto) {
    out.push([
      { matId: item.artefacto.replace('{tier}', tier), nome: 'Artefacto', qty: 1, retornavel: false },
      ...artifactAlternativeIds(item, tier),
    ]);
  }
  return out;
}

function artifactAlternativeIds(item, tier) {
  const b = item.base;
  let token = null;
  if (b.includes('_MORGANA') || b.includes('_KEEPER')) token = `${tier}_ARTEFACT_TOKEN_FAVOR_1`;
  else if (b.includes('_HELL')) token = `${tier}_ARTEFACT_TOKEN_FAVOR_2`;
  else if (b.includes('_UNDEAD')) token = `${tier}_ARTEFACT_TOKEN_FAVOR_3`;
  else if (b.includes('_AVALON')) token = `${tier}_ARTEFACT_TOKEN_FAVOR_4`;
  if (!token) return [];
  return [{ matId: token, nome: 'Artefacto Cristalizado', qty: 1, retornavel: false }];
}

/* ---------- construir lista de item ids necessários ---------- */
function idsNecessarios(tiers) {
  const finished = [];
  const materials = new Set();

  for (const item of RECIPES.itens) {
    const enchants = item.semEncantamento ? [0] : ENCHANTS;
    for (const t of tiers) {
      for (const e of enchants) {
        const finishedItem = { ...item, tier: t, enchant: e, id: itemId(t, item.base, e) };
        finished.push(finishedItem);
        for (const m of materialOptions(finishedItem, t, e)) {
          for (const option of m) materials.add(option.matId);
        }
      }
    }
  }
  return { finished, materialIds: [...materials].filter(Boolean) };
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

    if (finished.length === 0) {
      setStatus('O recipes.json não tem nenhum item — verifica se o ficheiro no repositório está completo (deve ter mais de 200 itens).', true);
      return;
    }

    const citiesParam = CITIES.map(encodeURIComponent).join(',');

    setStatus(`A obter preços de ${allIds.length} itens em ${CITIES.length} cidades…`);

    // preços e histórico correm em paralelo (não um a seguir ao outro) para não duplicar o tempo de espera
    const querVolume = els.maisVendidos.checked;
    const [precos, volume] = await Promise.all([
      fetchPrices(allIds, citiesParam),
      querVolume ? fetchVolume(finished.map(f => f.id), citiesParam).catch(e => { console.warn('Histórico indisponível:', e); return {}; }) : Promise.resolve({}),
    ]);
    PRICE_INDEX = precos;
    VOLUME_INDEX = volume;

    const idsComPreco = Object.keys(PRICE_INDEX).length;
    if (idsComPreco === 0) {
      setStatus(`O servidor respondeu, mas devolveu preços para 0 de ${allIds.length} itens — provavelmente o Albion Online Data Project está em baixo ou a bloquear pedidos deste site agora. Tenta de novo daqui a uns minutos.`, true);
      return;
    }

    calcularLinhas(finished);

    if (ROWS.length === 0) {
      const falhasInfo = fetchPrices.ultimasFalhas > 0
        ? ` ${fetchPrices.ultimasFalhas} de ${fetchPrices.ultimoTotal} lotes de preços falharam mesmo depois de repetir — é provável que faltem exatamente os materiais destes itens por causa disso.`
        : ' Os preços dos materiais e dos itens finais podem estar espalhados por cidades diferentes, sem nenhuma cidade a ter os dois ao mesmo tempo.';
      setStatus(`Preços obtidos para ${idsComPreco} itens, mas nenhum combina em receita completa (item + todos os materiais na mesma cidade).${falhasInfo} Tenta com menos tiers/encantamentos de uma vez.`, true);
      return;
    }

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
  const chunks = chunkByUrl(ids, citiesParam, 3600);
  const index = {};
  let falhas = 0;
  let feitos = 0;
  const falhados = [];
  let apanhadoLimite = false;

  async function tentarLote(c) {
    const url = `${API_BASE}/prices/${c.join(',')}.json?locations=${citiesParam}&qualities=1`;
    const res = await fetch(url);
    if (res.status === 429) { apanhadoLimite = true; throw new Error('HTTP 429 (limite de pedidos excedido)'); }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    for (const row of data) {
      index[row.item_id] ??= {};
      index[row.item_id][row.city] = {
        sell_price_min: row.sell_price_min || 0,
        buy_price_min: row.buy_price_min || 0,
      };
    }
  }

  // no máximo 3 pedidos em simultâneo — a API só aceita 180/min, 300/5min no total
  await executarEmParalelo(chunks, 3, async (c) => {
    try {
      await tentarLote(c);
    } catch (e) {
      falhados.push(c);
      console.warn('Lote de preços falhou (1ª tentativa):', e);
    } finally {
      feitos++;
      setStatus(`A obter preços… (${feitos}/${chunks.length} lotes)`);
    }
  });

  // 2ª tentativa só para os lotes que falharam — espera mais tempo se foi mesmo o limite de pedidos
  if (falhados.length) {
    const espera = apanhadoLimite ? 15000 : 2000;
    setStatus(`A repetir ${falhados.length} lote(s) que falharam — a aguardar ${Math.round(espera / 1000)}s (limite de pedidos do servidor)…`);
    await new Promise(r => setTimeout(r, espera));
    const aindaFalhados = [];
    await executarEmParalelo(falhados, 2, async (c) => {
      try {
        await tentarLote(c);
      } catch (e) {
        aindaFalhados.push(c);
        console.warn('Lote de preços falhou (2ª tentativa):', e);
      }
    });
    falhas = aindaFalhados.length;
  }

  if (falhas === chunks.length) throw new Error(apanhadoLimite
    ? 'O servidor recusou os pedidos por excesso de pedidos (limite: 180/minuto). Espera 1-2 minutos sem clicar em "Atualizar" antes de tentar de novo.'
    : 'Todos os pedidos de preços falharam.');
  if (falhas > 0) {
    console.warn(`${falhas} de ${chunks.length} lotes de preços continuam em falta depois de repetir.`);
  }
  fetchPrices.ultimasFalhas = falhas;
  fetchPrices.ultimoTotal = chunks.length;
  return index;
}

// corre várias tarefas em paralelo, no máximo `limite` em simultâneo, para não sobrecarregar o servidor nem bloquear à vez
async function executarEmParalelo(items, limite, tarefa) {
  let indice = 0;
  async function worker() {
    while (indice < items.length) {
      const meu = indice++;
      await tarefa(items[meu]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limite, items.length) }, worker));
}

async function fetchVolume(ids, citiesParam) {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - 6);
  const fmt = d => `${d.getMonth() + 1}-${d.getDate()}-${d.getFullYear()}`;

  const chunks = chunk(ids, 60);
  const index = {};

  await executarEmParalelo(chunks, 6, async (c) => {
    const url = `${API_BASE}/history/${c.join(',')}.json?date=${fmt(start)}&end_date=${fmt(end)}&locations=${citiesParam}&time-scale=24`;
    try {
      const res = await fetch(url);
      if (!res.ok) return;
      const data = await res.json();
      for (const entry of data) {
        const total = (entry.data || []).reduce((s, p) => s + (p.item_count || 0), 0);
        index[entry.item_id] ??= {};
        index[entry.item_id][entry.location] = total;
      }
    } catch (e) {
      console.warn('Lote de histórico falhou:', e);
    }
  });
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

function chunkByUrl(ids, citiesParam, maxChars = 3600) {
  const out = []; let current = [];
  for (const id of ids) {
    const candidate = [...current, id];
    const test = `${API_BASE}/prices/${candidate.join(',')}.json?locations=${citiesParam}&qualities=1`;
    if (current.length && test.length > maxChars) { out.push(current); current = [id]; }
    else current = candidate;
  }
  if (current.length) out.push(current);
  return out;
}

/* ---------- cálculo de lucro por item/cidade/encantamento ---------- */
function calcularLinhas(finishedItems) {
  const tax = els.premium.checked ? 0.04 : 0.08;
  const rows = [];

  for (const item of finishedItems) {
    const materialGroups = materialOptions(item, item.tier, item.enchant);

    for (const city of CITIES) {
      const priceFinished = PRICE_INDEX[item.id]?.[city];
      if (!priceFinished || !priceFinished.sell_price_min) continue;

      let custoBruto = 0;
      let materiaisCompletos = true;
      const materiaisLinha = [];
      const rrr = craftRRR(city, item.categoria);

      for (const group of materialGroups) {
        // Escolhe a opção de ingrediente mais barata disponível nessa cidade.
        let best = null;
        for (const option of group) {
          const p = PRICE_INDEX[option.matId]?.[city];
          if (!p || !p.sell_price_min) continue;
          const subtotal = p.sell_price_min * option.qty;
          if (!best || subtotal < best.subtotal) best = { ...option, unit: p.sell_price_min, subtotal };
        }
        if (!best) { materiaisCompletos = false; break; }

        const depoisRetorno = best.retornavel ? best.subtotal * (1 - rrr) : best.subtotal;
        custoBruto += best.subtotal;
        materiaisLinha.push({ ...best, depoisRetorno });
      }
      if (!materiaisCompletos) continue;

      const custo = materiaisLinha.reduce((s, m) => s + m.depoisRetorno, 0);
      const venda = priceFinished.sell_price_min;
      const lucro = venda * (1 - tax) - custo;
      const margem = custo > 0 ? (lucro / custo) * 100 : 0;
      const volume = VOLUME_INDEX[item.id]?.[city] || 0;

      rows.push({
        id: item.id, nome: item.nome, en: item.en, tier: item.tier, enchant: item.enchant, categoria: item.categoria,
        cidade: city, venda, custo, custoBruto, lucro, margem, volume, rrr,
        materiais: materiaisLinha, custoIncompleto: false,
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

  renderDestaques(grouped.filter(r => !r.custoIncompleto).slice().sort((a, b) => b.lucro - a.lucro).slice(0, 3));

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
      <td class="num">${fmt(r.custo)}${r.custoIncompleto ? ' <span class="incompleto-badge" title="Falta um material desconhecido nesta receita — o custo real é maior que o mostrado">⚠ incompleto</span>' : ''}</td>
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

  const avisoIncompleto = r.custoIncompleto ? `
    <div class="recipe-title" style="color:var(--rust); margin-bottom:10px;">⚠ Receita incompleta — falta um material de artefacto que ainda não foi confirmado. O custo (e por isso o lucro) mostrado é mais baixo do que o real.</div>
  ` : '';
  const rrrInfo = `<div class="recipe-title" style="margin-top:12px;">Retorno de recursos: <strong>${(r.rrr * 100).toFixed(1)}%</strong> · custo bruto ${fmt(r.custoBruto)} → custo efetivo ${fmt(r.custo)}</div>`;

  return `
    ${avisoIncompleto}
    <div class="recipe-title">Receita — ${r.materiais.length > 1 ? 'vários materiais' : '1 material'} <span style="color:var(--muted)">(encantamento ${r.enchant} — igual ao do item)</span></div>
    <div class="recipe-grid">
      <div class="h">Material</div><div class="h">Qtd.</div><div class="h">Preço un.</div><div class="h">Subtotal</div>
      ${linhasMateriais}
      <div class="sum">Custo total</div><div class="sum"></div><div class="sum"></div><div class="sum">${fmt(r.custo)}</div>
    </div>
    ${rrrInfo}
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
