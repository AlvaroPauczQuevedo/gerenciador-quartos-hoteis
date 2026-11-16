import { estado, api, post } from '../estado.js';
import { recarregar } from '../app.js';
import { html, render, raw, $, $$, toast, dataHora, modal } from '../ui.js';
import { qrSVG } from '../qr.js';

export async function mostrar(el) {
  const { doisFatores, sessoes } = await api('/api/eu/seguranca');
  const u = estado.usuario;
  const recomendado = ['admin', 'diretoria'].includes(u.papel) && !doisFatores.ativo;

  render(el, html`
    <div class="cabecalho"><div><h1>Minha conta</h1><p class="sub">${u.nome} · ${u.login} · ${estado.meta.PAPEIS[u.papel]}${u.hotel_nome ? ` · ${u.hotel_nome}` : ''}</p></div>
      <div class="acoes-topo"><button class="btn" id="trocar-senha">Alterar senha</button></div></div>

    <section class="card" style="margin-bottom:1rem"><h2>Verificação em duas etapas</h2>
      ${doisFatores.ativo ? html`<p><span class="badge ok">Ativa</span> Ao entrar, além da senha, você digita o código do aplicativo autenticador. Restam <strong>${doisFatores.recuperacao_restantes}</strong> códigos de recuperação.</p>
        <div class="acoes-topo"><button class="btn perigo" id="desativar-2fa">Desativar</button></div>`
      : html`${recomendado ? html`<div class="aviso warn" style="margin-bottom:.75rem"><span class="icone">!</span><div>Sua conta enxerga <strong>toda a rede</strong>. Recomendamos ativar a verificação em duas etapas: mesmo que alguém descubra a senha, não consegue entrar sem o seu celular.</div></div>` : ''}
        <p>Use um aplicativo autenticador (Google Authenticator, Microsoft Authenticator, Authy…) para gerar um código de 6 dígitos a cada 30 segundos.</p>
        <div class="acoes-topo"><button class="btn primario" id="ativar-2fa">Ativar verificação em duas etapas</button></div>`}
    </section>

    <section class="card"><h2>Aparelhos conectados</h2>
      <div class="tabela-wrap"><table><thead><tr><th>Aparelho</th><th>Endereço (IP)</th><th>Entrou em</th><th></th></tr></thead><tbody>
        ${sessoes.map((s) => html`<tr><td>${s.aparelho || '—'} ${s.atual ? html`<span class="badge ok sem-ponto">este aparelho</span>` : ''}</td><td>${s.ip || '—'}</td><td class="nowrap">${s.criado_em ? dataHora(s.criado_em) : '—'}</td>
          <td>${s.atual ? '' : html`<button class="btn pequeno" data-encerrar="${s.id}">Encerrar</button>`}</td></tr>`)}
      </tbody></table></div>
      ${sessoes.length > 1 ? html`<div class="acoes-topo" style="margin-top:.75rem"><button class="btn" id="encerrar-outras">Sair de todos os outros aparelhos</button></div>` : ''}
      <p class="small muted">Perdeu um celular ou entrou em um computador emprestado? Encerre a sessão dele aqui e troque a senha.</p>
    </section>`);

  $('#trocar-senha', el).addEventListener('click', () => $('#senha')?.click());

  for (const b of $$('[data-encerrar]', el)) {
    b.addEventListener('click', async () => { try { await post('/api/eu/sessoes/encerrar', { id: b.dataset.encerrar }); toast('Sessão encerrada.'); recarregar(); } catch (e) { toast(e.message, 'erro'); } });
  }
  $('#encerrar-outras', el)?.addEventListener('click', async () => {
    const r = await post('/api/eu/sessoes/encerrar-outras'); toast(`${r.encerradas} sessão(ões) encerrada(s).`); recarregar();
  });

  $('#ativar-2fa', el)?.addEventListener('click', () => {
    const { el: m } = modal(html`<h2>Ativar verificação em duas etapas</h2>
      <form class="form" id="f-passo1"><p class="small">Passo 1 de 2: confirme sua senha.</p>
        <label class="campo"><span class="obrig">Senha atual</span><input type="password" name="senha" autocomplete="current-password" required></label>
        <div class="aviso danger" id="erro-2fa" hidden></div>
        <div class="rodape-modal"><button type="button" class="btn" data-fechar>Cancelar</button><button class="btn primario" type="submit">Continuar</button></div></form>`.s);
    const erro = (err) => { const x = $('#erro-2fa', m); x.textContent = err.message; x.hidden = false; };
    $('#f-passo1', m).addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        const r = await post('/api/eu/2fa/iniciar', { senha: e.target.senha.value });
        m.innerHTML = html`<h2>Ativar verificação em duas etapas</h2>
          <p class="small">Passo 2 de 2: no aplicativo autenticador, escolha <strong>adicionar conta</strong> e leia o QR code abaixo. Depois digite o código de 6 dígitos que aparecer.</p>
          <div style="display:flex;justify-content:center;background:#fff;padding:.5rem;border-radius:8px;max-width:220px;margin:0 auto">${raw(qrSVG(r.uri))}</div>
          <p class="small muted" style="text-align:center;word-break:break-all">Sem câmera? Digite esta chave no aplicativo: <strong>${r.segredo}</strong></p>
          <form class="form" id="f-passo2"><label class="campo"><span class="obrig">Código do aplicativo</span><input name="codigo" inputmode="numeric" autocomplete="one-time-code" maxlength="7" required></label>
            <div class="aviso danger" id="erro-2fa" hidden></div>
            <div class="rodape-modal"><button type="button" class="btn" data-fechar>Cancelar</button><button class="btn primario" type="submit">Ativar</button></div></form>`.s;
        $('#f-passo2', m).addEventListener('submit', async (ev) => {
          ev.preventDefault();
          try {
            const a = await post('/api/eu/2fa/ativar', { codigo: ev.target.codigo.value });
            estado.usuario.totp_ativo = 1;
            m.innerHTML = html`<h2>Pronto: verificação ativada</h2>
              <div class="aviso warn"><span class="icone">!</span><div><strong>Guarde estes códigos de recuperação em lugar seguro.</strong> Cada um vale uma única vez e serve se você perder o celular. Eles não serão mostrados de novo.</div></div>
              <pre style="font-size:1.05rem;line-height:1.7;background:var(--fundo-suave,#f3f4f6);padding:.75rem;border-radius:8px;user-select:all">${a.codigos.join('\n')}</pre>
              <div class="rodape-modal"><button class="btn primario" id="fim-2fa">Guardei os códigos</button></div>`.s;
            $('#fim-2fa', m).addEventListener('click', () => { $('#modal-raiz').innerHTML = ''; recarregar(); });
          } catch (err) { erro(err); }
        });
      } catch (err) { erro(err); }
    });
  });

  $('#desativar-2fa', el)?.addEventListener('click', () => {
    const { el: m, fechar } = modal(html`<h2>Desativar verificação em duas etapas</h2>
      <form class="form" id="f-desativar">
        <label class="campo"><span class="obrig">Senha atual</span><input type="password" name="senha" autocomplete="current-password" required></label>
        <label class="campo"><span class="obrig">Código do aplicativo (ou de recuperação)</span><input name="codigo" autocomplete="one-time-code" required></label>
        <div class="aviso danger" id="erro-2fa" hidden></div>
        <div class="rodape-modal"><button type="button" class="btn" data-fechar>Cancelar</button><button class="btn perigo" type="submit">Desativar</button></div></form>`.s);
    $('#f-desativar', m).addEventListener('submit', async (e) => {
      e.preventDefault();
      try { await post('/api/eu/2fa/desativar', { senha: e.target.senha.value, codigo: e.target.codigo.value }); estado.usuario.totp_ativo = 0; fechar(); toast('Verificação em duas etapas desativada.'); recarregar(); }
      catch (err) { const x = $('#erro-2fa', m); x.textContent = err.message; x.hidden = false; }
    });
  });
}
