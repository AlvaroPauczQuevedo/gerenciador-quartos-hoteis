import { estado } from '../estado.js';
import { recarregar } from '../app.js';
import { html, render, $, $$, toast, dataHora } from '../ui.js';
import { listarFila, removerDaFila, reabrirItem, sincronizar, estaSemRede } from '../offline.js';

export async function mostrar(el) {
  const fila = await listarFila();
  render(el, html`
    <div class="cabecalho"><div><h1>Envios pendentes</h1>
      <p class="sub">Ações feitas sem internet ficam guardadas neste aparelho e são enviadas sozinhas quando a conexão voltar, na ordem em que foram feitas.</p></div>
      <div class="acoes-topo"><button class="btn primario" id="enviar-agora" ${fila.length ? '' : 'disabled'}>Enviar agora</button></div></div>
    ${estaSemRede() ? html`<div class="aviso warn" style="margin-bottom:1rem"><span class="icone">!</span><div>Sem conexão no momento. O envio acontece automaticamente quando a internet voltar.</div></div>` : ''}
    <section class="card">${fila.length ? html`<div class="tabela-wrap"><table><thead><tr><th>Quando</th><th>Ação</th><th>OS</th><th>Situação</th><th></th></tr></thead><tbody>
      ${fila.map((i) => html`<tr><td class="nowrap">${dataHora(i.criado_em)}</td>
        <td><strong>${i.rotulo}</strong>${i.corpo?.texto ? html`<br><span class="muted small">${String(i.corpo.texto).slice(0, 120)}</span>` : ''}${i.fotos ? html`<br><span class="muted small">${i.fotos} foto(s)</span>` : ''}</td>
        <td>${i.os_id ? html`<a href="#/os/${i.os_id}">#${i.os_id}</a>` : '—'}</td>
        <td>${i.erro ? html`<span class="badge danger">Recusada pelo servidor</span><br><span class="small">${i.erro}</span>` : html`<span class="badge warn">Aguardando envio</span>`}</td>
        <td class="nowrap">${i.erro ? html`<button class="btn pequeno" data-refazer="${i.id}">Tentar de novo</button> ` : ''}<button class="btn pequeno perigo" data-descartar="${i.id}">Descartar</button></td></tr>`)}
      </tbody></table></div>
      <p class="small muted">"Recusada pelo servidor" quer dizer que a situação da OS mudou enquanto você estava sem internet (por exemplo, o gerente já tratou a demanda). Confira a OS e descarte a ação se ela não faz mais sentido.</p>`
      : html`<p class="vazio">Nada pendente. Tudo o que você fez já foi enviado.</p>`}</section>`);

  $('#enviar-agora', el).addEventListener('click', async (e) => {
    e.target.disabled = true;
    const n = await sincronizar(estado.usuario.id);
    toast(n ? `${n} ação(ões) enviada(s).` : 'Nada foi enviado agora (sem conexão ou ações recusadas).', n ? undefined : 'erro');
    recarregar();
  });
  for (const b of $$('[data-refazer]', el)) b.addEventListener('click', async () => { await reabrirItem(Number(b.dataset.refazer)); await sincronizar(estado.usuario.id); recarregar(); });
  for (const b of $$('[data-descartar]', el)) {
    b.addEventListener('click', async () => { await removerDaFila(Number(b.dataset.descartar)); toast('Ação descartada.'); recarregar(); });
  }
}
