/* SFM — login.html */

(function () {
  DB.carregarAutoLoad();

  // Se já estiver logado, vai direto pro destino certo (menu ou recebimento pendente).
  const jaLogado = Auth.getUsuario();
  if (jaLogado) {
    Auth.garantirSetorOperador(jaLogado);
    window.location.href = Auth.temPendenciaRecebimento(jaLogado) ? "receber-turno.html" : "menu.html";
    return;
  }

  const btnEntrar = document.getElementById("btnEntrar");
  const alertaLogin = document.getElementById("alertaLogin");
  const form = document.getElementById("formLogin");

  if (!DB.autoLoadOk) {
    mostrarAlerta(alertaLogin, "erro",
      'Não encontrei "bd/dados.js". Confirme que a pasta "bd" está na mesma pasta que o login.html.');
  }
  // Login não salva nada (a sessão fica só no navegador) — não checa nem
  // pede permissão da pasta "bd" aqui. Isso evita confirmar acesso à pasta
  // de rede antes mesmo de entrar no sistema; a checagem/pedido de permissão
  // só acontece nas telas que realmente salvam algo.

  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    limparAlerta(alertaLogin);

    const nome = document.getElementById("campoNome").value.trim();
    const senha = document.getElementById("campoSenha").value;

    const usuario = DB.buscarUsuarioPorNome(nome);
    if (!usuario) {
      mostrarAlerta(alertaLogin, "erro", "Usuário ou senha inválidos.");
      return;
    }

    btnEntrar.disabled = true;
    btnEntrar.textContent = "Verificando...";
    const ok = await verificarSenha(senha, usuario.senhaHash, usuario.senhaSalt);
    btnEntrar.disabled = false;
    btnEntrar.textContent = "Entrar";

    if (!ok) {
      mostrarAlerta(alertaLogin, "erro", "Usuário ou senha inválidos.");
      return;
    }

    Auth.login(usuario);
    Auth.garantirSetorOperador(usuario);
    window.location.href = Auth.temPendenciaRecebimento(usuario) ? "receber-turno.html" : "menu.html";
  });
})();
