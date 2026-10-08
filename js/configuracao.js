/* SFM — configuracao.html (página escondida, não linkada em nenhum menu)
 *
 * Deixa trocar o caminho da pasta "bd" que este PC usa — pensada pra rodar o SFM.exe
 * copiado localmente em cada PC (mais rápido/estável que rodar direto da rede) e só
 * apontar pra pasta "bd" compartilhada na rede, em vez do .exe inteiro morar lá.
 *
 * O login/senha (CONFIG_LOGIN_ESCONDIDO/CONFIG_SENHA_ESCONDIDA, ver js/util.js) são fixos —
 * não vêm de bd/usuarios.json, essa tela existe justamente pra configurar onde esse arquivo
 * fica. O jeito normal de entrar aqui é pela tela de login comum (js/login.js), digitando o
 * "número pessoal" escondido — chegando direto nesta página (via sessionStorage, checado
 * abaixo) sem passar pelo formulário de login desta própria página. Esse formulário só entra
 * em cena se alguém abrir configuracao.html direto pela URL, sem vir do login.html.
 */

(function () {
  const formLogin = document.getElementById("formLoginConfig");
  const campoLogin = document.getElementById("campoLoginConfig");
  const campoSenha = document.getElementById("campoSenhaConfig");
  const alertaConfig = document.getElementById("alertaConfig");
  const painelConfig = document.getElementById("painelConfig");

  const caminhoAtual = document.getElementById("caminhoAtual");
  const statusCaminho = document.getElementById("statusCaminho");
  const campoNovoCaminho = document.getElementById("campoNovoCaminho");
  const btnSalvarCaminho = document.getElementById("btnSalvarCaminho");

  let senhaValidada = null; // guardada em memória só pra reenviar na troca de caminho, nunca persistida

  // Já veio autenticado pela tela de login normal (ver js/login.js)? Pula direto pro painel.
  if (sessionStorage.getItem(CONFIG_SESSAO_CHAVE) === "1") {
    senhaValidada = CONFIG_SENHA_ESCONDIDA;
    formLogin.hidden = true;
    painelConfig.hidden = false;
    carregarConfigAtual();
  }

  formLogin.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    limparAlerta(alertaConfig);

    if (campoLogin.value.trim() !== CONFIG_LOGIN_ESCONDIDO || campoSenha.value !== CONFIG_SENHA_ESCONDIDA) {
      mostrarAlerta(alertaConfig, "erro", "Login ou senha incorretos.");
      return;
    }

    senhaValidada = campoSenha.value;
    sessionStorage.setItem(CONFIG_SESSAO_CHAVE, "1");
    formLogin.hidden = true;
    painelConfig.hidden = false;
    await carregarConfigAtual();
  });

  async function carregarConfigAtual() {
    statusCaminho.textContent = "Carregando...";
    try {
      const resp = await fetch("/api/config");
      if (!resp.ok) throw new Error("Falha ao consultar configuração atual.");
      const dados = await resp.json();
      exibirConfig(dados);
    } catch (e) {
      statusCaminho.textContent = "";
      mostrarAlerta(alertaConfig, "erro", "Não foi possível carregar a configuração atual: " + e.message);
    }
  }

  function exibirConfig(dados) {
    caminhoAtual.textContent = dados.bd_dir;
    if (!dados.existe) {
      statusCaminho.textContent = "Esta pasta ainda não existe no disco.";
      statusCaminho.style.color = "var(--vermelho-alerta)";
    } else if (dados.arquivos.length === 0) {
      statusCaminho.textContent = "A pasta existe, mas está vazia (nenhum arquivo .json encontrado).";
      statusCaminho.style.color = "var(--amarelo-aviso)";
    } else {
      statusCaminho.textContent = `Arquivos encontrados: ${dados.arquivos.join(", ")}`;
      statusCaminho.style.color = "var(--verde-ok)";
    }
  }

  btnSalvarCaminho.addEventListener("click", async () => {
    limparAlerta(alertaConfig);
    const novoCaminho = campoNovoCaminho.value.trim();
    if (!novoCaminho) {
      mostrarAlerta(alertaConfig, "erro", "Informe o novo caminho da pasta \"bd\".");
      return;
    }

    btnSalvarCaminho.disabled = true;
    try {
      const resp = await fetch("/api/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bd_dir: novoCaminho, senha: senhaValidada }),
      });
      const dados = await resp.json();
      if (!resp.ok) throw new Error(dados.erro || "Falha ao salvar.");

      exibirConfig(dados);
      campoNovoCaminho.value = "";
      mostrarAlerta(alertaConfig, "ok",
        dados.criada
          ? "Caminho salvo — a pasta não existia e foi criada vazia. Confira se é o caminho certo (se não for, a pasta certa já deve ter os arquivos .json dela)."
          : "Caminho salvo e já em uso neste PC, sem precisar reiniciar o SFM.exe."
      );
    } catch (e) {
      mostrarAlerta(alertaConfig, "erro", "Não foi possível salvar: " + e.message);
    } finally {
      btnSalvarCaminho.disabled = false;
    }
  });
})();
