/* SFM — autenticação e sessão.
 *
 * AVISO IMPORTANTE: esta aplicação roda 100% no navegador, sem servidor.
 * Isso significa que NÃO existe segurança de verdade aqui: qualquer pessoa
 * com acesso à pasta de rede e algum conhecimento técnico pode ler o
 * "dados.json" (que guarda apenas hash+salt da senha, nunca a senha em
 * texto puro) ou alterar o código JavaScript das páginas para burlar as
 * checagens de papel/permissão feitas em auth.js. Este login serve para
 * organizar o uso normal do sistema (evitar erro operacional, saber quem
 * registrou o quê) — NÃO para proteger informação sensível. Não reutilize
 * estas senhas em outros sistemas.
 */

const AUTH_CHAVE_SESSAO = "sfm_sessao";
const PBKDF2_ITERACOES = 150000;

async function gerarSaltBase64() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return arrayBufferParaBase64(bytes);
}

async function derivarHash(senha, saltBase64, iteracoes = PBKDF2_ITERACOES) {
  const enc = new TextEncoder();
  const saltBytes = base64ParaArrayBuffer(saltBase64);
  const material = await crypto.subtle.importKey(
    "raw", enc.encode(senha), { name: "PBKDF2" }, false, ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: saltBytes, iterations: iteracoes, hash: "SHA-256" },
    material,
    256
  );
  return arrayBufferParaBase64(new Uint8Array(bits));
}

async function gerarHashSenha(senha) {
  const senhaSalt = await gerarSaltBase64();
  const senhaHash = await derivarHash(senha, senhaSalt);
  return { senhaHash, senhaSalt };
}

async function verificarSenha(senha, senhaHash, senhaSalt) {
  const teste = await derivarHash(senha, senhaSalt);
  return teste === senhaHash;
}

function arrayBufferParaBase64(bytes) {
  let binario = "";
  for (const b of bytes) binario += String.fromCharCode(b);
  return btoa(binario);
}

function base64ParaArrayBuffer(base64) {
  const binario = atob(base64);
  const bytes = new Uint8Array(binario.length);
  for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i);
  return bytes;
}

const Auth = {
  login(usuario) {
    const sessao = {
      id: usuario.id,
      nome: usuario.nome,
      papel: usuario.papel,
      setor: usuario.setor || null,
    };
    sessionStorage.setItem(AUTH_CHAVE_SESSAO, JSON.stringify(sessao));
  },

  logout() {
    sessionStorage.removeItem(AUTH_CHAVE_SESSAO);
    sessionStorage.removeItem("sfm_setorAtivo");
    window.location.href = "login.html";
  },

  getUsuario() {
    const raw = sessionStorage.getItem(AUTH_CHAVE_SESSAO);
    if (!raw) return null;
    try { return JSON.parse(raw); } catch { return null; }
  },

  /** Redireciona para login se não houver sessão ativa. Retorna o usuário logado. */
  exigirLogin() {
    const usuario = this.getUsuario();
    if (!usuario) {
      window.location.href = "login.html";
      return null;
    }
    return usuario;
  },

  /** Garante que o usuário logado tenha um dos papéis permitidos; senão volta ao menu. */
  exigirPapel(papeisPermitidos) {
    const usuario = this.exigirLogin();
    if (!usuario) return null;
    if (!papeisPermitidos.includes(usuario.papel)) {
      window.location.href = "menu.html";
      return null;
    }
    return usuario;
  },

  getSetorAtivo() {
    return sessionStorage.getItem("sfm_setorAtivo") || null;
  },

  setSetorAtivo(setor) {
    if (setor) sessionStorage.setItem("sfm_setorAtivo", setor);
    else sessionStorage.removeItem("sfm_setorAtivo");
  },

  /**
   * A sessão salva no login (ver Auth.login) só guarda id/nome/papel/setor,
   * capturados uma única vez — turno e responsavelSfm (e qualquer mudança
   * de setor feita depois pelo admin) ficariam presos no valor de quando o
   * usuário logou. Esta função busca o registro atual em DB.dados.usuarios
   * e atualiza esses campos no objeto `usuario` em memória, sem precisar de
   * logout/login. Chamar em toda página logo depois de DB.carregarAutoLoad()
   * e antes de qualquer gate ou checagem que dependa de turno/responsavelSfm.
   */
  atualizarUsuarioDoBanco(usuario) {
    if (!usuario) return usuario;
    const atual = DB.dados.usuarios.find((u) => u.id === usuario.id);
    if (atual) {
      usuario.turno = atual.turno || null;
      usuario.responsavelSfm = atual.responsavelSfm === true;
      usuario.setor = atual.setor || null;
    }
    return usuario;
  },

  /**
   * Operador tem setor fixo (o próprio) — garante que o setor ativo esteja
   * sempre correto, independente de qual página foi a primeira acessada
   * após o login (ex.: redirecionado direto pra receber-turno.html sem
   * passar pelo menu.html). Chamar logo após Auth.exigirLogin() em toda
   * página que usa Auth.getSetorAtivo(). Não faz nada para admin/gestor
   * (eles escolhem o setor no menu).
   */
  garantirSetorOperador(usuario) {
    if (usuario && usuario.papel === "operador" && this.getSetorAtivo() !== usuario.setor) {
      this.setSetorAtivo(usuario.setor);
    }
  },

  /**
   * Existe passagem de turno "aberta" (ainda não recebida) no próprio setor
   * do operador? Só indica que há pendência — não diz se é obrigatório
   * receber agora (ver dentroJanelaRecebimentoObrigatorio). Precisa que
   * DB.carregarAutoLoad() já tenha sido chamado antes.
   */
  temPendenciaRecebimento(usuario) {
    if (!usuario || usuario.papel !== "operador") return false;
    return DB.dados.passagensTurno.some((p) => p.setor === usuario.setor && p.status === "aberta");
  },

  /**
   * O operador está dentro da janela obrigatória de recebimento (os
   * primeiros 40 min do início do próprio turno) E há pendência real pra
   * receber? Fora dessa janela, mesmo com pendência, o operador não é
   * forçado a receber agora — pode fazer isso quando quiser em "Receber
   * Turno".
   */
  dentroJanelaRecebimentoObrigatorio(usuario) {
    if (!usuario || usuario.papel !== "operador" || !usuario.turno) return false;
    if (!estaNaJanelaReceber(usuario.turno)) return false;
    return this.temPendenciaRecebimento(usuario);
  },

  /**
   * Chamar em toda página protegida (exceto a própria receber-turno.html):
   * se estiver na janela obrigatória de recebimento, redireciona pra lá e
   * retorna true.
   */
  aplicarGateRecebimento(usuario) {
    if (this.dentroJanelaRecebimentoObrigatorio(usuario)) {
      window.location.href = "receber-turno.html";
      return true;
    }
    return false;
  },

  /**
   * O operador está dentro da janela obrigatória de passagem (os últimos 40
   * min do fim do próprio turno) E ainda não concluiu a passagem desse
   * turno hoje (ver DB.confirmarPassagemTurno, botão "Concluir passagem de
   * turno" em passar-turno.html)? Precisa que DB.carregarAutoLoad() já
   * tenha sido chamado antes.
   */
  dentroJanelaPassagemObrigatoria(usuario) {
    if (!usuario || usuario.papel !== "operador" || !usuario.turno) return false;
    if (!estaNaJanelaPassar(usuario.turno)) return false;
    const data = dataDoTurnoAtual(usuario.turno);
    return !DB.passagemTurnoConcluida(usuario.setor, usuario.turno, data);
  },

  /**
   * Chamar em toda página protegida (exceto a própria passar-turno.html):
   * se estiver na janela obrigatória de passagem, redireciona pra lá e
   * retorna true.
   */
  aplicarGatePassagemObrigatoria(usuario) {
    if (this.dentroJanelaPassagemObrigatoria(usuario)) {
      window.location.href = "passar-turno.html";
      return true;
    }
    return false;
  },
};

/** Monta a barra superior padrão em qualquer página logada. */
function montarTopbar(elemento, usuario, tituloPagina) {
  const setorAtivo = Auth.getSetorAtivo();
  elemento.innerHTML = `
    <div class="marca">SFM <small>${escaparHtml(tituloPagina || "")}</small></div>
    <div class="usuario-info">
      <span>${escaparHtml(usuario.nome)} <em style="opacity:.75">(${escaparHtml(usuario.papel)})</em></span>
      ${setorAtivo ? `<span class="setor-pill">${escaparHtml(setorAtivo)}</span>` : ""}
      <button class="sair" id="btnSair" type="button">Sair</button>
    </div>
  `;
  elemento.querySelector("#btnSair").addEventListener("click", () => Auth.logout());
}
