/* SFM — menu.html */

(async function () {
  const usuario = Auth.exigirLogin();
  if (!usuario) return;
  Auth.garantirSetorOperador(usuario);

  DB.carregarAutoLoad();
  Auth.atualizarUsuarioDoBanco(usuario);
  if (Auth.aplicarGatePassagemObrigatoria(usuario)) return;
  if (Auth.aplicarGateRecebimento(usuario)) return;

  montarTopbar(document.getElementById("topbar"), usuario, "Menu");

  const alerta = document.getElementById("alerta");
  const cardSetor = document.getElementById("cardSetor");
  const seletorSetor = document.getElementById("seletorSetor");
  const linkPassarTurno = document.getElementById("linkPassarTurno");
  const linkReceberTurno = document.getElementById("linkReceberTurno");
  const linkFazerSfm = document.getElementById("linkFazerSfm");
  const linkQuadroSfm = document.getElementById("linkQuadroSfm");
  const cardGestao = document.getElementById("cardGestao");
  const linkRelatorios = document.getElementById("linkRelatorios");
  const linkAdmin = document.getElementById("linkAdmin");

  if (usuario.papel === "gestor" || usuario.papel === "admin") {
    cardGestao.hidden = false;
    if (usuario.papel === "gestor" || usuario.papel === "admin") linkRelatorios.hidden = false;
    if (usuario.papel === "admin") linkAdmin.hidden = false;
  }

  function setorEspecificoValido() {
    return !!Auth.getSetorAtivo();
  }

  function interceptarLinksQueExigemSetor() {
    for (const link of [linkPassarTurno, linkReceberTurno, linkQuadroSfm]) {
      link.addEventListener("click", (ev) => {
        if (!setorEspecificoValido()) {
          ev.preventDefault();
          mostrarAlerta(alerta, "aviso", "Selecione um setor específico (não \"Todos\") para essa opção.");
        }
      });
    }
  }

  if (usuario.papel === "operador") {
    // Operador tem setor fixo — não escolhe, e o card fica escondido.
    Auth.setSetorAtivo(usuario.setor);
    cardSetor.hidden = true;
  } else {
    cardSetor.hidden = false;
    seletorSetor.innerHTML =
      `<option value="">Todos (somente para o Painel da Reunião, que compara os setores)</option>` +
      SETORES.map((s) => `<option value="${s}">${s}</option>`).join("");

    const atual = Auth.getSetorAtivo();
    seletorSetor.value = atual || "";
    if (!Array.from(seletorSetor.options).some(o => o.value === seletorSetor.value)) {
      seletorSetor.value = "";
    }
    Auth.setSetorAtivo(seletorSetor.value || null);

    seletorSetor.addEventListener("change", () => {
      Auth.setSetorAtivo(seletorSetor.value || null);
      limparAlerta(alerta);
      montarTopbar(document.getElementById("topbar"), usuario, "Menu");
    });

    interceptarLinksQueExigemSetor();
  }

  await DbUI.iniciar(document.getElementById("dbStatus"));
})();
