import { estado, api, qs, ehRede, papel } from '../estado.js';
import { html, render, $, $$, estrelas, badgeComercial, data, moeda } from '../ui.js';

// Agrupa os quartos em abas: pelo andar cadastrado; sem andar, pelo número (401 → 4º andar);
// numeração provisória (1, 2, 3…) em faixas de 20.
const TAMANHO_FAIXA = 20;
function grupoDe(q) {
  if (q.andar) return { chave: `a${q.andar}`, rotulo: /^\d+$/.test(q.andar) ? `${q.andar}º andar` : q.andar, ordem: [0, Number(q.andar) || 0, q.andar] };
  const n = parseInt(q.numero, 10);
  if (Number.isNaN(n)) return { chave: 'outros', rotulo: 'Outros', ordem: [2, 0, ''] };
  // Numeração provisória (1, 2, 3…) não indica andar: sempre em faixas.
  if (n >= 100 && !q.numeracao_provisoria) {
    const andar = Math.floor(n / 100);
    return { chave: `a${andar}`, rotulo: `${andar}º andar`, ordem: [0, andar, ''] };
  }
  const ini = Math.floor((n - 1) / TAMANHO_FAIXA) * TAMANHO_FAIXA + 1;
  return { chave: `f${ini}`, rotulo: `${ini}–${ini + TAMANHO_FAIXA - 1}`, ordem: [1, ini, ''] };
}

function agrupar(lista) {
  const grupos = new Map();
  for (const q of lista) {
    const g = grupoDe(q);
    if (!grupos.has(g.chave)) grupos.set(g.chave, { ...g, quartos: [] });
    grupos.get(g.chave).quartos.push(q);
  }
  // Faixas mostram o intervalo real (ex.: 41–48 em vez de 41–60).
  for (const g of grupos.values()) {
    if (g.chave.startsWith('f')) {
      const nums = g.quartos.map((q) => parseInt(q.numero, 10));
      g.rotulo = `${Math.min(...nums)}–${Math.max(...nums)}`;
    }
  }
  return [...grupos.values()].sort((a, b) => a.ordem[0] - b.ordem[0] || a.ordem[1] - b.ordem[1] || String(a.ordem[2]).localeCompare(String(b.ordem[2])));
}

const temAlerta = (qs_) => qs_.some((q) => q.status_comercial === 'bloqueado' || q.os_atrasadas || q.os_emergenciais || q.inspecao_vencida);

export async function mostrar(el, _p, query) {
  const rede = ehRede();
  const lista = await api(`/api/quartos${qs({ ...query, aba: '' })}`);
  const ir = (f) => { location.hash = `#/quartos${qs(f)}`; };
  const lib = lista.filter((q) => q.status_comercial === 'liberado').length;

  // Nível 1 (somente visão da rede): um hotel por aba.
  const hoteis = rede && !query.hotel_id
    ? estado.hoteis.map((h) => ({ ...h, quartos: lista.filter((q) => q.hotel_id === h.id) }))
    : null;

  // Nível 2: abas numeradas por andar (ou faixa) do hotel em vista.
  const grupos = hoteis ? [] : agrupar(lista);
  const abaAtual = grupos.find((g) => g.chave === query.aba) || (query.aba === 'todos' ? null : grupos[0]);
  const visiveis = hoteis ? [] : abaAtual ? abaAtual.quartos : lista;
  const hotelAtual = rede && query.hotel_id ? estado.hoteis.find((h) => String(h.id) === String(query.hotel_id)) : null;
  const provisorios = lista.filter((q) => q.numeracao_provisoria).length;

  render(el, html`
    <div class="cabecalho"><div><h1>Quartos${hotelAtual ? html` <span class="muted" style="font-weight:400">· ${hotelAtual.nome}</span>` : ''}</h1>
      <p class="sub">${lista.length} quarto(s) · ${lib} liberado(s) para comercialização · ${lista.length - lib} bloqueado(s)</p></div>
      <div class="acoes-topo">${hotelAtual ? html`<button class="btn" id="voltar-rede">← Todos os hotéis</button>` : ''}
        ${papel('admin', 'gerente', 'governanta') && (!rede || query.hotel_id) ? html`<a class="btn" href="#/qrcodes${qs({ hotel_id: query.hotel_id })}">▦ QR codes</a>` : ''}
        <a class="btn" href="/api/exportar/quartos.csv${qs({ ...query, aba: '' })}" download>⬇ Excel</a></div></div>
    ${provisorios && !hoteis ? html`<div class="aviso warn" style="margin-bottom:1rem"><span class="icone">!</span><div>
      <strong>${provisorios} quarto(s) com numeração provisória</strong> (criados só pela quantidade: 1, 2, 3…).
      ${papel('gerente', 'admin') ? html`Cadastre a numeração real em <a href="#/cadastros">${papel('admin') ? 'Cadastros' : 'Equipe e cadastros'} → Numeração real dos quartos</a>.` : 'A gerência vai cadastrar a numeração real.'}</div></div>` : ''}
    <form class="filtros" id="filtros">
      <label>Comercialização <select name="status_comercial"><option value="">Todos</option>
        <option value="liberado" ${query.status_comercial === 'liberado' ? 'selected' : ''}>Liberados</option>
        <option value="bloqueado" ${query.status_comercial === 'bloqueado' ? 'selected' : ''}>Bloqueados</option></select></label>
      <label class="check"><input type="checkbox" name="com_problemas" value="1" ${query.com_problemas ? 'checked' : ''}> Com problemas</label>
      <label class="check"><input type="checkbox" name="inspecao_vencida" value="1" ${query.inspecao_vencida ? 'checked' : ''}> Inspeção vencida</label>
    </form>
    ${hoteis ? html`
      <p class="muted small">Escolha o hotel:</p>
      <nav class="abas" aria-label="Hotéis">${hoteis.map((h) => html`<button class="aba ${temAlerta(h.quartos) ? 'alerta' : ''}" data-hotel="${h.id}" title="${h.cidade || ''}">${h.nome.replace(/^Tri Hotel\s*/, '')} <span class="n">${h.quartos.length}</span></button>`)}</nav>`
    : html`
      ${grupos.length > 1 ? html`<nav class="abas" aria-label="Andares">
        ${grupos.map((g) => html`<button class="aba ${abaAtual?.chave === g.chave ? 'ativa' : ''} ${temAlerta(g.quartos) ? 'alerta' : ''}" data-aba="${g.chave}"
          title="${temAlerta(g.quartos) ? 'Há quartos bloqueados, com atraso, emergência ou inspeção vencida' : ''}">${g.rotulo} <span class="n">${g.quartos.length}</span></button>`)}
        <button class="aba ${abaAtual ? '' : 'ativa'}" data-aba="todos">Todos <span class="n">${lista.length}</span></button>
      </nav>` : ''}
      <section class="card"><div class="tabela-wrap"><table>
        <thead><tr><th>Quarto</th><th>Conservação</th><th>Comercialização</th><th>Problemas</th><th>Inspeção</th><th class="num">Custo 12m</th></tr></thead>
        <tbody>${visiveis.map((q) => html`<tr class="clicavel" data-href="#/quartos/${q.id}">
          <td><a href="#/quartos/${q.id}"><strong>${q.numero}</strong></a>${q.numeracao_provisoria ? html` <span class="badge warn sem-ponto" title="Numeração provisória">provisório</span>` : ''}<br><span class="muted small">${q.tipo || ''}${q.andar ? ` · ${q.andar}º andar` : ''}</span></td>
          <td>${estrelas(q.estrelas)}</td>
          <td>${badgeComercial(q.status_comercial)}</td>
          <td>${q.os_abertas ? html`<span class="badge info">${q.os_abertas} OS aberta(s)</span> ` : ''}${q.os_emergenciais ? html`<span class="badge p-emergencial">${q.os_emergenciais} emergencial</span> ` : ''}${q.os_atrasadas ? html`<span class="badge danger">${q.os_atrasadas} atrasada(s)</span> ` : ''}${q.cronicos ? html`<span class="badge warn">${q.cronicos} crônico(s)</span>` : ''}${!q.os_abertas && !q.cronicos ? html`<span class="muted small">Nenhum</span>` : ''}</td>
          <td>${q.inspecao_vencida ? html`<span class="badge danger">Vencida</span><br>` : ''}<span class="small muted">Última: ${data(q.ultima_inspecao_em)}<br>Próxima: ${data(q.proxima_inspecao_em)}</span></td>
          <td class="num">${moeda(q.custo_12m)}</td></tr>`)}</tbody></table></div>
        ${visiveis.length ? '' : html`<p class="vazio">Nenhum quarto encontrado.</p>`}</section>`}`);

  const form = $('#filtros', el);
  form.addEventListener('change', () => {
    const f = { hotel_id: query.hotel_id || '' };
    for (const i of form.elements) if (i.name) f[i.name] = i.type === 'checkbox' ? (i.checked ? '1' : '') : i.value;
    ir(f);
  });
  for (const b of $$('[data-aba]', el)) b.addEventListener('click', () => ir({ ...query, aba: b.dataset.aba }));
  for (const b of $$('[data-hotel]', el)) b.addEventListener('click', () => ir({ ...query, hotel_id: b.dataset.hotel, aba: '' }));
  $('#voltar-rede', el)?.addEventListener('click', () => ir({ ...query, hotel_id: '', aba: '' }));
}
