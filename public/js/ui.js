// Utilitários de interface: template seguro (escape automático), formatação, modal, toast, fotos.
import { estado } from './estado.js';

class Raw { constructor(s) { this.s = s; } toString() { return this.s; } }
export const raw = (s) => new Raw(s);
export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (v) => (v == null || v === false ? '' : v instanceof Raw ? v.s : Array.isArray(v) ? v.map(fmt).join('') : esc(v));
export function html(strings, ...vals) {
  let out = '';
  strings.forEach((s, i) => { out += s + (i < vals.length ? fmt(vals[i]) : ''); });
  return raw(out);
}
export function render(el, conteudo) { el.innerHTML = conteudo instanceof Raw ? conteudo.s : esc(conteudo); }
export const $ = (sel, el = document) => el.querySelector(sel);
export const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];

// ---- formatação ----
export const dataHora = (iso) => (iso ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—');
export const data = (iso) => (iso ? new Date(iso).toLocaleDateString('pt-BR') : '—');
export const moeda = (v) => (v == null ? '—' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));
export const numero = (v, casas = 0) => (v == null ? '—' : Number(v).toLocaleString('pt-BR', { maximumFractionDigits: casas, minimumFractionDigits: casas }));
export const pct = (v) => (v == null ? '—' : `${numero(v, 0)}%`);
export function horas(h) {
  if (h == null) return '—';
  if (h < 1) return `${Math.round(h * 60)} min`;
  if (h < 48) return `${numero(h, 1)} h`;
  return `${numero(h / 24, 1)} dias`;
}
export function relativo(iso) {
  if (!iso) return '';
  const diff = (new Date(iso) - Date.now()) / 1000;
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat('pt-BR', { numeric: 'auto' });
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour');
  return rtf.format(Math.round(diff / 86400), 'day');
}
export const paraInputData = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
};

// ---- badges ----
const M = () => estado.meta;
export const badgePrioridade = (p) => html`<span class="badge p-${p}">${M().PRIORIDADES[p] || p}</span>`;
const CLASSE_STATUS = {
  nova: 'info', em_avaliacao: 'info', devolvida_complementacao: 'warn', aguardando_orcamento: 'warn', aguardando_autorizacao: 'warn',
  aprovada: 'info', em_execucao: 'serious', aguardando_materiais: 'warn', concluida: 'ok', em_correcao: 'danger',
  encerrada: 'ok', recusada: '', cancelada: '',
};
export const badgeStatus = (s) => html`<span class="badge ${CLASSE_STATUS[s] || ''}">${M().STATUS[s] || s}</span>`;
export const badgeAtraso = (o) => (o.atrasada ? html`<span class="badge danger">Atrasada</span>` : '');
export const badgeComercial = (s) => (s === 'bloqueado' ? html`<span class="badge danger">Bloqueado</span>` : html`<span class="badge ok">Liberado</span>`);
export function estrelas(n) {
  if (!n) return html`<span class="muted small">sem avaliação</span>`;
  const r = Math.round(n);
  return html`<span class="estrelas" title="${numero(n, 1)} de 5 estrelas" aria-label="${numero(n, 1)} de 5 estrelas">${'★'.repeat(r)}<span class="vazia">${'★'.repeat(5 - r)}</span></span>`;
}

// ---- barras horizontais (série única: uma cor, rótulos em texto) ----
export function barras(itens, { valor = (i) => i.valor, rotulo = (i) => i.rotulo, formato = (v) => numero(v), link } = {}) {
  if (!itens.length) return html`<p class="vazio">Sem dados no período.</p>`;
  const max = Math.max(...itens.map(valor), 0) || 1;
  return html`<div class="barras">${itens.map((i) => {
    const v = valor(i);
    const nome = link ? html`<a href="${link(i)}">${rotulo(i)}</a>` : rotulo(i);
    return html`<div class="barra" title="${rotulo(i)}: ${formato(v)}"><span class="nome">${nome}</span>
      <span class="trilho"><span class="preenchido" style="width:${((v / max) * 100).toFixed(1)}%"></span></span>
      <span class="valor">${formato(v)}</span></div>`;
  })}</div>`;
}

// ---- toast & modal ----
export function toast(msg, tipo = '') {
  const el = document.createElement('div');
  el.className = `toast ${tipo}`;
  el.textContent = msg;
  $('#toasts').append(el);
  setTimeout(() => el.remove(), tipo === 'erro' ? 6000 : 3500);
}

export function modal(conteudo, { grande = false, aoAbrir } = {}) {
  const raiz = $('#modal-raiz');
  raiz.innerHTML = `<div class="modal-fundo"><div class="modal ${grande ? 'grande' : ''}" role="dialog" aria-modal="true">${conteudo}</div></div>`;
  const fundo = raiz.firstElementChild;
  const fechar = () => { raiz.innerHTML = ''; document.removeEventListener('keydown', esc_); };
  const esc_ = (e) => { if (e.key === 'Escape') fechar(); };
  document.addEventListener('keydown', esc_);
  fundo.addEventListener('click', (e) => { if (e.target === fundo || e.target.closest('[data-fechar]')) fechar(); });
  const el = fundo.firstElementChild;
  aoAbrir?.(el, fechar);
  el.querySelector('input, select, textarea, button:not([data-fechar])')?.focus();
  return { el, fechar };
}

export function verMidia(url, mime) {
  modal(html`<div class="visualizador">${mime?.startsWith('video') ? html`<video src="${url}" controls autoplay></video>` : html`<img src="${url}" alt="">`}</div>
    <div class="rodape-modal"><a class="btn" href="${url}" target="_blank" rel="noopener">Abrir original</a><button class="btn" data-fechar>Fechar</button></div>`.s, { grande: true });
}

// ---- fotos / vídeos ----
export const arquivoParaDataUrl = (f) => new Promise((ok, erro) => {
  const r = new FileReader();
  r.onload = () => ok(r.result);
  r.onerror = () => erro(new Error('Falha ao ler o arquivo.'));
  r.readAsDataURL(f);
});

// Reduz fotos grandes (câmera do celular) antes do envio; vídeos seguem como estão.
export async function prepararArquivo(f) {
  if (!f.type.startsWith('image/') || f.type === 'image/gif') return { arquivo: await arquivoParaDataUrl(f), nome: f.name, mime: f.type };
  const url = await arquivoParaDataUrl(f);
  const img = await new Promise((ok, erro) => { const i = new Image(); i.onload = () => ok(i); i.onerror = erro; i.src = url; });
  const escala = Math.min(1, 1600 / Math.max(img.width, img.height));
  if (escala === 1 && f.size < 1.5e6) return { arquivo: url, nome: f.name, mime: f.type };
  const c = document.createElement('canvas');
  c.width = Math.round(img.width * escala); c.height = Math.round(img.height * escala);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return { arquivo: c.toDataURL('image/jpeg', 0.85), nome: f.name, mime: 'image/jpeg' };
}

// Campo de upload reutilizável. Retorna função que devolve a lista de arquivos preparados.
export function campoUpload(container, { rotulo = 'Fotografias ou vídeos', multiplo = true } = {}) {
  const lista = [];
  container.innerHTML = html`<div class="upload">
      <label class="btn pequeno">📷 ${rotulo}<input type="file" accept="image/*,video/*" ${multiplo ? raw('multiple') : ''} capture="environment" hidden></label>
      <div class="miniaturas"></div><span class="muted small">JPG, PNG, WEBP, MP4 — até 15 MB cada</span></div>`.s;
  const input = $('input', container);
  const mini = $('.miniaturas', container);
  input.addEventListener('change', async () => {
    for (const f of input.files) {
      if (f.size > 15 * 1024 * 1024) { toast(`${f.name}: arquivo maior que 15 MB.`, 'erro'); continue; }
      try {
        const p = await prepararArquivo(f);
        lista.push(p);
        const el = document.createElement(p.mime.startsWith('video') ? 'div' : 'img');
        if (p.mime.startsWith('video')) { el.className = 'vid'; el.textContent = '🎬 vídeo'; } else el.src = p.arquivo;
        el.title = `${f.name} (clique para remover)`;
        el.style.cursor = 'pointer';
        el.addEventListener('click', () => { lista.splice(lista.indexOf(p), 1); el.remove(); });
        mini.append(el);
      } catch (e) { toast(e.message, 'erro'); }
    }
    input.value = '';
  });
  return () => lista.map(({ arquivo }) => ({ arquivo }));
}

export function galeria(fotos, { mostrarFase = true } = {}) {
  if (!fotos?.length) return html`<p class="muted small">Nenhuma imagem.</p>`;
  return html`<div class="galeria">${fotos.map((f) => html`<figure class="foto" style="margin:0">
    ${f.mime?.startsWith('video')
      ? html`<video src="/uploads/${f.arquivo}" preload="metadata" data-midia="/uploads/${f.arquivo}" data-mime="${f.mime}"></video>`
      : html`<img src="/uploads/${f.arquivo}" alt="${f.legenda || 'Fotografia'}" loading="lazy" data-midia="/uploads/${f.arquivo}" data-mime="${f.mime}">`}
    ${mostrarFase && f.fase ? html`<span class="fase">${M().FASES_FOTO[f.fase] || f.fase}</span>` : ''}
    <figcaption class="legenda">${f.legenda ? html`${f.legenda}<br>` : ''}<span class="muted">${dataHora(f.criado_em)}${f.enviado_por_nome ? html` · ${f.enviado_por_nome}` : ''}</span></figcaption>
  </figure>`)}</div>`;
}

// Delegação: qualquer [data-midia] abre o visualizador.
document.addEventListener('click', (e) => {
  const m = e.target.closest('[data-midia]');
  if (m) verMidia(m.dataset.midia, m.dataset.mime);
});

export function opcoes(mapa, selecionado, { vazio } = {}) {
  return html`${vazio != null ? html`<option value="">${vazio}</option>` : ''}${Object.entries(mapa).map(([k, v]) => html`<option value="${k}" ${String(k) === String(selecionado ?? '') ? raw('selected') : ''}>${v}</option>`)}`;
}

export function dadosForm(form) {
  const d = {};
  for (const el of form.elements) {
    if (!el.name || el.disabled) continue;
    if (el.type === 'checkbox') d[el.name] = el.checked;
    else if (el.type === 'radio') { if (el.checked) d[el.name] = el.value; }
    else if (el.type === 'datetime-local' || el.type === 'date') d[el.name] = el.value ? new Date(el.value).toISOString() : '';
    else d[el.name] = el.value;
  }
  return d;
}

export function seletorHotel(valor, { todos = true, nome = 'hotel_id' } = {}) {
  const hoteis = estado.hoteis;
  if (hoteis.length <= 1 && !todos) return html`<input type="hidden" name="${nome}" value="${hoteis[0]?.id ?? ''}">`;
  return html`<select name="${nome}">${todos ? html`<option value="">Todas as unidades</option>` : ''}
    ${hoteis.map((h) => html`<option value="${h.id}" ${String(h.id) === String(valor ?? '') ? raw('selected') : ''}>${h.nome}</option>`)}</select>`;
}
