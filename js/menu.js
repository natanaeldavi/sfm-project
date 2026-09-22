/* SFM — menu.html */

(async function () {
  const usuario = Auth.exigirLogin();
  if (!usuario) return;
  Auth.garantirSetorOperador(usuario);

  await DB.carregarAutoLoad();
  Auth.atualizarUsuarioDoBanco(usuario);
  if (Auth.aplicarGatePassagemObrigatoria(usuario)) return;
  if (Auth.aplicarGateRecebimento(usuario)) return;

  montarTopbar(document.getElementById("topbar"), usuario, "Menu");

  const alerta = document.getElementById("alerta");
  const cardSetor = document.getElementById("cardSetor");
  const seletorSetor = document.getElementById("seletorSetor");
  const cardGestao = document.getElementById("cardGestao");
  const linkRelatorios = document.getElementById("linkRelatorios");
  const linkAdmin = document.getElementById("linkAdmin");

  if (usuario.papel === "gestor" || usuario.papel === "admin") {
    cardGestao.hidden = false;
    if (usuario.papel === "gestor" || usuario.papel === "admin") linkRelatorios.hidden = false;
    if (usuario.papel === "admin") linkAdmin.hidden = false;
  }

  if (usuario.papel === "operador") {
    // Operador tem setor fixo — não escolhe, e o card fica escondido.
    Auth.setSetorAtivo(usuario.setor);
    cardSetor.hidden = true;
  } else {
    cardSetor.hidden = false;
    seletorSetor.innerHTML = SETORES.map((s) => `<option value="${s}">${s}</option>`).join("");

    const atual = Auth.getSetorAtivo();
    seletorSetor.value = SETORES.includes(atual) ? atual : SETORES[0];
    Auth.setSetorAtivo(seletorSetor.value);

    seletorSetor.addEventListener("change", () => {
      Auth.setSetorAtivo(seletorSetor.value);
      limparAlerta(alerta);
      montarTopbar(document.getElementById("topbar"), usuario, "Menu");
    });
  }

  await DbUI.iniciar(document.getElementById("dbStatus"));
})();
