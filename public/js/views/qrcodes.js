// Etiquetas de QR Code para a porta de cada quarto: ao escanear, o app abre direto no quarto
// (histórico, "Solicitar manutenção" e "Inspecionar"). Impressão em A4 pelo próprio navegador.
import { estado, api, qs, ehRede } from '../estado.js';
import { html, render, raw, $, seletorHotel } from '../ui.js';
import { qrSVG } from '../qr.js';

const andarDe = (q) => q.andar || (parseInt(q.numero, 10) >= 100 && !q.numeracao_provisoria ? String(Math.floor(parseInt(q.numero, 10) / 100)) : '');
const TAMANHOS = { pequeno: '5cm', medio: '7cm', grande: '9cm' };

export async function mostrar(el, _p, query) {
  const hotelId = query.hotel_id || estado.usuario.hotel_id || estado.hoteis[0]?.id;
  const quartos = await api(`/api/quartos${qs({ hotel_id: hotelId })}`);
  const hotel = estado.hoteis.find((h) => String(h.id) === String(hotelId));
  const andares = [...new Set(quartos.map(andarDe).filter(Boolean))].sort((a, b) => Number(a) - Number(b));
  const selecionados = query.andar ? quartos.filter((q) => andarDe(q) === query.andar) : quartos;
  const tamanho = TAMANHOS[query.tamanho] ? query.tamanho : 'medio';
  const ir = (f) => { location.hash = `#/qrcodes${qs({ ...query, ...f })}`; };
  const logo = hotel?.logo ? `/img/hoteis/${hotel.logo}/horizontal.svg` : '/img/rede/horizontal.svg';

  render(el, html`
    <div class="cabecalho nao-imprimir"><div><h1>QR codes dos quartos</h1>
      <p class="sub">Cole cada etiqueta na porta (lado de dentro ou batente). Ao escanear com a câmera do celular, o app abre direto no quarto.</p></div>
      <div class="acoes-topo"><button class="btn primario" id="imprimir">🖨️ Imprimir ${selecionados.length} etiqueta(s)</button></div></div>
    <form class="filtros nao-imprimir" id="filtros">
      ${ehRede() ? html`<label>Hotel ${seletorHotel(hotelId, { todos: false })}</label>` : ''}
      <label>Andar <select name="andar"><option value="">Todos</option>${andares.map((a) => html`<option value="${a}" ${query.andar === a ? raw('selected') : ''}>${a}º andar</option>`)}</select></label>
      <label>Tamanho <select name="tamanho">${Object.keys(TAMANHOS).map((t) => html`<option value="${t}" ${t === tamanho ? raw('selected') : ''}>${{ pequeno: 'Pequeno (5 cm)', medio: 'Médio (7 cm)', grande: 'Grande (9 cm)' }[t]}</option>`)}</select></label>
    </form>
    ${quartos.some((q) => q.numeracao_provisoria) ? html`<div class="aviso warn nao-imprimir" style="margin-bottom:1rem"><span class="icone">!</span><div>Este hotel ainda tem quartos com <strong>numeração provisória</strong>. Cadastre a numeração real antes de imprimir, para as etiquetas saírem com o número certo.</div></div>` : ''}
    <div class="etiquetas" style="--tam-etiqueta:${TAMANHOS[tamanho]}">
      ${selecionados.map((q) => html`<div class="etiqueta">
        <img class="etiqueta-logo" src="${logo}" alt="">
        <div class="etiqueta-qr">${raw(qrSVG(`${location.origin}/q/${q.id}`))}</div>
        <div class="etiqueta-num">Quarto ${q.numero}</div>
        <div class="etiqueta-dica">Manutenção: aponte a câmera</div>
      </div>`)}
    </div>`);

  $('#imprimir', el).addEventListener('click', () => window.print());
  $('#filtros', el).addEventListener('change', (e) => {
    const f = Object.fromEntries(new FormData(e.currentTarget));
    if (e.target.name === 'hotel_id') f.andar = '';
    ir(f);
  });
}
