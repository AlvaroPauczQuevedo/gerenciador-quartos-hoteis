// Tela de troca obrigatória de senha (primeiro acesso ou senha redefinida por outra pessoa).
import { estado, post } from '../estado.js';
import { html, render, $, dadosForm } from '../ui.js';

export function mostrar(el, aoConcluir, aoSair) {
  render(el, html`<div class="login"><div class="card">
    <img class="logo-login claro" src="/img/rede/horizontal.svg" alt="Tri Hotéis">
    <img class="logo-login escuro" src="/img/rede/horizontal-branco.svg" alt="Tri Hotéis">
    <h1 style="font-size:1.15rem">Crie a sua senha</h1>
    <p class="muted">Olá, ${estado.usuario.nome.split(' ')[0]}. Você está usando uma senha provisória. Para continuar, defina uma senha pessoal que só você saiba.</p>
    <form class="form" id="f-trocar">
      <label class="campo"><span class="obrig">Senha provisória (atual)</span><input type="password" name="atual" autocomplete="current-password" required></label>
      <label class="campo"><span class="obrig">Nova senha</span><input type="password" name="nova" minlength="8" autocomplete="new-password" required><small>Mínimo de 8 caracteres, diferente da provisória.</small></label>
      <label class="campo"><span class="obrig">Confirme a nova senha</span><input type="password" name="confirmacao" minlength="8" autocomplete="new-password" required></label>
      <p class="aviso danger" id="erro" hidden></p>
      <button class="btn primario" type="submit">Salvar e entrar</button>
      <button class="btn" type="button" id="sair">Sair</button>
    </form>
  </div></div>`);
  const erro = $('#erro', el);
  $('#f-trocar', el).addEventListener('submit', async (e) => {
    e.preventDefault();
    erro.hidden = true;
    const d = dadosForm(e.target);
    if (d.nova !== d.confirmacao) { erro.textContent = 'As senhas não conferem.'; erro.hidden = false; return; }
    const b = e.target.querySelector('[type=submit]');
    b.disabled = true;
    try { await post('/api/eu/senha', d); aoConcluir(); } catch (err) { erro.textContent = err.message; erro.hidden = false; b.disabled = false; }
  });
  $('#sair', el).addEventListener('click', aoSair);
}
