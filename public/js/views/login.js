import { api, post } from '../estado.js';
import { html, render, $, $$ } from '../ui.js';

// Atalhos exibidos apenas quando o banco foi criado com `npm run seed:demo`.
const DEMO = [
  ['gerente.atlantico', 'Gerente', 'Hotel Atlântico'],
  ['tecnico1.atlantico', 'Técnico', 'Hotel Atlântico'],
  ['governanta.atlantico', 'Governanta', 'Hotel Atlântico'],
  ['diretoria', 'Diretoria', 'Rede'],
  ['admin', 'Administrador', 'Rede'],
];

export async function mostrar(el, aoEntrar) {
  const config = await api('/api/config').catch(() => ({ modo: 'piloto' }));
  const demo = config.modo === 'demo';
  render(el, html`<div class="login"><div class="card">
    <img class="logo-login claro" src="/img/rede/horizontal.svg" alt="Tri Hotéis">
    <img class="logo-login escuro" src="/img/rede/horizontal-branco.svg" alt="Tri Hotéis">
    <h1 style="font-size:1.15rem">Manutenção & Conservação</h1>
    <p class="muted">Solicitações de manutenção, inspeções e acompanhamento dos quartos.${config.modo === 'piloto' ? ' Versão piloto.' : ''}</p>
    <form class="form" id="f-login">
      <label class="campo"><span>Usuário</span><input name="usuario" autocomplete="username" autocapitalize="none" autocorrect="off" spellcheck="false" required></label>
      <label class="campo"><span>Senha</span><input name="senha" type="password" autocomplete="current-password" required></label>
      <p class="aviso danger" id="erro" hidden></p>
      <button class="btn primario" type="submit">Entrar</button>
    </form>
    ${demo ? html`<div class="demo">
      <p class="small muted">Acesso de demonstração (senha <strong>demo123</strong>):</p>
      <div class="demo-lista">${DEMO.map(([usuario, papel, hotel]) => html`<button type="button" class="btn pequeno" data-usuario="${usuario}">${papel}<small>${hotel}</small></button>`)}</div>
    </div>` : ''}
  </div></div>`);
  const form = $('#f-login');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const erro = $('#erro');
    erro.hidden = true;
    try {
      await post('/api/login', { usuario: form.usuario.value, senha: form.senha.value });
      aoEntrar();
    } catch (err) {
      erro.textContent = err.message;
      erro.hidden = false;
    }
  });
  for (const b of $$('[data-usuario]')) {
    b.addEventListener('click', () => { form.usuario.value = b.dataset.usuario; form.senha.value = 'demo123'; form.requestSubmit(); });
  }
}
