/* SFM — login.html */

(async function () {
  await DB.carregarAutoLoad();

  // Se já estiver logado, vai direto pro destino certo (menu ou recebimento pendente).
  const jaLogado = Auth.getUsuario();
  if (jaLogado) {
    Auth.garantirSetorOperador(jaLogado);
    window.location.href = Auth.temPendenciaRecebimento(jaLogado) ? "receber-turno.html" : "menu.html";
    return;
  }

  const btnEntrar = document.getElementById("btnEntrar");
  const btnTrocarCodigo = document.getElementById("btnTrocarCodigo");
  const alertaLogin = document.getElementById("alertaLogin");
  const form = document.getElementById("formLogin");

  const campoCodigoWrap = document.getElementById("campoCodigoWrap");
  const campoCodigo = document.getElementById("campoCodigo");
  const campoSenhaWrap = document.getElementById("campoSenhaWrap");
  const campoSenha = document.getElementById("campoSenha");
  const blocoPrimeiroAcesso = document.getElementById("blocoPrimeiroAcesso");
  const campoNovaSenha = document.getElementById("campoNovaSenha");
  const campoConfirmarSenha = document.getElementById("campoConfirmarSenha");

  if (!DB.autoLoadOk) {
    mostrarAlerta(alertaLogin, "erro",
      "Não foi possível carregar os dados do servidor local. Confirme que o SFM.exe está rodando.");
  }

  // "codigo" (pedindo o código) -> "senha" (usuário já tem senha) ou "criarSenha" (primeiro acesso)
  let etapa = "codigo";
  let usuarioEncontrado = null;

  function voltarParaCodigo() {
    etapa = "codigo";
    usuarioEncontrado = null;
    campoCodigoWrap.hidden = false;
    campoCodigo.disabled = false;
    campoSenhaWrap.hidden = true;
    campoSenha.required = false;
    campoSenha.value = "";
    blocoPrimeiroAcesso.hidden = true;
    campoNovaSenha.required = false;
    campoConfirmarSenha.required = false;
    campoNovaSenha.value = "";
    campoConfirmarSenha.value = "";
    btnTrocarCodigo.hidden = true;
    btnEntrar.textContent = "Entrar";
    campoCodigo.focus();
  }

  btnTrocarCodigo.addEventListener("click", () => {
    limparAlerta(alertaLogin);
    voltarParaCodigo();
  });

  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    limparAlerta(alertaLogin);

    if (etapa === "codigo") {
      const codigo = campoCodigo.value.trim();
      const usuario = DB.buscarUsuarioPorCodigo(codigo);
      if (!usuario) {
        mostrarAlerta(alertaLogin, "erro", "Número pessoal inválido.");
        return;
      }

      usuarioEncontrado = usuario;
      campoCodigo.disabled = true;
      btnTrocarCodigo.hidden = false;

      if (usuario.senhaHash) {
        etapa = "senha";
        campoSenhaWrap.hidden = false;
        campoSenha.required = true;
        campoSenha.focus();
      } else {
        etapa = "criarSenha";
        blocoPrimeiroAcesso.hidden = false;
        campoNovaSenha.required = true;
        campoConfirmarSenha.required = true;
        btnEntrar.textContent = "Criar senha e entrar";
        campoNovaSenha.focus();
      }
      return;
    }

    if (etapa === "senha") {
      const senha = campoSenha.value;
      btnEntrar.disabled = true;
      btnEntrar.textContent = "Verificando...";
      const ok = await verificarSenha(senha, usuarioEncontrado.senhaHash, usuarioEncontrado.senhaSalt);
      btnEntrar.disabled = false;
      btnEntrar.textContent = "Entrar";

      if (!ok) {
        mostrarAlerta(alertaLogin, "erro", "Número pessoal ou senha inválidos.");
        return;
      }

      Auth.login(usuarioEncontrado);
      Auth.garantirSetorOperador(usuarioEncontrado);
      window.location.href = Auth.temPendenciaRecebimento(usuarioEncontrado) ? "receber-turno.html" : "menu.html";
      return;
    }

    if (etapa === "criarSenha") {
      const novaSenha = campoNovaSenha.value;
      const confirmar = campoConfirmarSenha.value;

      if (novaSenha.length < 3) {
        mostrarAlerta(alertaLogin, "erro", "A senha deve ter ao menos 3 caracteres.");
        return;
      }
      if (novaSenha !== confirmar) {
        mostrarAlerta(alertaLogin, "erro", "As senhas não conferem.");
        return;
      }

      btnEntrar.disabled = true;
      btnEntrar.textContent = "Salvando...";
      const { senhaHash, senhaSalt } = await gerarHashSenha(novaSenha);
      usuarioEncontrado.senhaHash = senhaHash;
      usuarioEncontrado.senhaSalt = senhaSalt;

      try {
        await DB.salvarDados();
      } catch {
        btnEntrar.disabled = false;
        btnEntrar.textContent = "Criar senha e entrar";
        mostrarAlerta(alertaLogin, "erro", "Não foi possível salvar a nova senha. Tente novamente.");
        return;
      }

      Auth.login(usuarioEncontrado);
      Auth.garantirSetorOperador(usuarioEncontrado);
      window.location.href = Auth.temPendenciaRecebimento(usuarioEncontrado) ? "receber-turno.html" : "menu.html";
    }
  });
})();
