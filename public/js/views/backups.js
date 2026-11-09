import { api, post } from '../estado.js';
import { recarregar } from '../app.js';
import { html, render, $, toast, dataHora } from '../ui.js';

const tamanho = (b) => (b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

export async function mostrar(el) {
  const { retencao, itens } = await api('/api/backups');
  render(el, html`
    <div class="cabecalho"><div><h1>Backups</h1>
      <p class="sub">O sistema faz uma cópia completa do banco de dados todo dia e guarda as últimas ${retencao}. As cópias ficam na pasta de dados do servidor, fora do aplicativo, e não se perdem com os deploys.</p></div>
      <div class="acoes-topo"><button class="btn primario" id="gerar">Gerar backup agora</button></div></div>
    <div class="aviso info" style="margin-bottom:1rem"><span class="icone">i</span><div class="small">Recomendado: baixe um backup por semana e guarde fora da hospedagem (ex.: Google Drive da empresa).
      As fotos ficam na pasta <code>uploads</code> e entram no backup geral da Hostinger. O arquivo baixado contém dados internos: guarde com cuidado.</div></div>
    <section class="card">${itens.length ? html`<div class="tabela-wrap"><table><thead><tr><th>Arquivo</th><th>Criado em</th><th class="num">Tamanho</th><th></th></tr></thead><tbody>
      ${itens.map((b) => html`<tr><td><strong>${b.nome}</strong>${b.manual ? html` <span class="badge sem-ponto">manual</span>` : ''}</td><td>${dataHora(b.criado_em)}</td><td class="num">${tamanho(b.tamanho)}</td>
        <td><a class="btn pequeno" href="/api/backups/${encodeURIComponent(b.nome)}/baixar" download>Baixar</a></td></tr>`)}</tbody></table></div>`
      : html`<p class="vazio">Nenhum backup ainda. O primeiro é feito automaticamente em até 5 minutos, ou clique em "Gerar backup agora".</p>`}</section>`);
  $('#gerar', el).addEventListener('click', async (e) => {
    e.target.disabled = true;
    try { const r = await post('/api/backups'); toast(`Backup gerado: ${r.nome}`); recarregar(); } catch (err) { toast(err.message, 'erro'); e.target.disabled = false; }
  });
}
