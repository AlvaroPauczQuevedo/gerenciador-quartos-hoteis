// Página pública aberta pelo QR code da porta (sem login): relato de problema no quarto.
import { html, render, $, raw } from '../ui.js';

const publico = async (url, opcoes) => {
  const r = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...opcoes });
  const corpo = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(corpo.erro || 'Não foi possível concluir. Tente novamente.');
  return corpo;
};

// Reduz a foto no próprio aparelho (lado maior 1280 px, JPEG) para o envio ser rápido e leve.
function reduzirFoto(arquivo) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const f = Math.min(1, 1280 / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * f); c.height = Math.round(img.height * f);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(img.src);
      resolve(c.toDataURL('image/jpeg', 0.8));
    };
    img.onerror = () => reject(new Error('Não foi possível ler a foto. Escolha uma imagem JPG ou PNG.'));
    img.src = URL.createObjectURL(arquivo);
  });
}

const cabecalho = html`<img class="logo-login claro" src="/img/rede/horizontal.svg" alt="Tri Hotéis"><img class="logo-login escuro" src="/img/rede/horizontal-branco.svg" alt="Tri Hotéis">`;

export async function mostrar(el, quartoId, aoEntrarEquipe) {
  const equipe = html`<p class="small muted" style="margin-top:1rem">Sou da equipe do hotel: <a href="#/quartos/${quartoId}" id="sou-equipe">entrar no sistema</a></p>`;
  const ligarEquipe = () => $('#sou-equipe', el)?.addEventListener('click', () => setTimeout(aoEntrarEquipe, 0));
  let q;
  try { q = await publico(`/api/publico/quartos/${quartoId}`); } catch (e) {
    render(el, html`<div class="login"><div class="card">${cabecalho}<h1 style="font-size:1.15rem">Quarto não encontrado</h1><p class="muted">${e.message}</p>${equipe}</div></div>`);
    return ligarEquipe();
  }
  if (!q.ativo) {
    render(el, html`<div class="login"><div class="card">${cabecalho}<h1 style="font-size:1.15rem">${q.hotel} — quarto ${q.numero}</h1>
      <p class="muted">O relato de problemas por esta página não está ativo neste hotel. Avise a recepção.</p>${equipe}</div></div>`);
    return ligarEquipe();
  }

  render(el, html`<div class="login"><div class="card">${cabecalho}
    <h1 style="font-size:1.15rem">${q.hotel} — quarto ${q.numero}</h1>
    <p class="muted">Algo não está funcionando? Conte aqui e a manutenção será avisada. <strong>Se for urgente (vazamento, cheiro de gás, risco), ligue para a recepção.</strong></p>
    <form class="form" id="f-relato" novalidate>
      <label class="campo"><span>O que é?</span><select name="categoria">${Object.entries(q.categorias).map(([k, v]) => html`<option value="${k}" ${k === 'outros' ? raw('selected') : ''}>${v}</option>`)}</select></label>
      <label class="campo"><span class="obrig">O que está acontecendo?</span><textarea name="descricao" rows="4" maxlength="1000" required placeholder="Ex.: a luz do banheiro não acende"></textarea></label>
      <label class="campo"><span>Foto (opcional)</span><input type="file" name="foto" accept="image/*" capture="environment"></label>
      <label class="campo"><span>Seu nome (opcional)</span><input name="nome" maxlength="60" autocomplete="name"></label>
      <div style="position:absolute;left:-9999px" aria-hidden="true"><label>Não preencha <input name="site" tabindex="-1" autocomplete="off"></label></div>
      <p class="aviso danger" id="erro" hidden></p>
      <button class="btn primario" type="submit">Enviar relato</button>
    </form>${equipe}</div></div>`);
  ligarEquipe();

  const form = $('#f-relato', el);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const erro = $('#erro', el); erro.hidden = true;
    const botao = form.querySelector('[type=submit]'); botao.disabled = true; botao.textContent = 'Enviando…';
    try {
      const f = form.elements;
      const foto = f.foto.files[0] ? await reduzirFoto(f.foto.files[0]) : null;
      const r = await publico('/api/publico/relato', { method: 'POST', body: JSON.stringify({
        quarto_id: q.quarto_id, categoria: f.categoria.value, descricao: f.descricao.value, nome: f.nome.value, site: f.site.value, foto }) });
      render(el, html`<div class="login"><div class="card">${cabecalho}<h1 style="font-size:1.15rem">Relato enviado ✔</h1>
        <p>A manutenção foi avisada. Protocolo <strong>${r.protocolo}</strong>.</p><p class="muted small">Obrigado por avisar!</p>${equipe}</div></div>`);
      ligarEquipe();
    } catch (err) {
      erro.textContent = err.message; erro.hidden = false;
      botao.disabled = false; botao.textContent = 'Enviar relato';
    }
  });
}
