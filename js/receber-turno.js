/* SFM — receber-turno.html
 *
 * Recebimento é uma ação em lote: se houver passagens "aberta" no setor,
 * o usuário precisa clicar em "Receber turno" antes de poder navegar pro
 * resto do sistema (ver Auth.aplicarGateRecebimento, chamado nas outras
 * páginas). A decisão de continuar parada ou finalizar (com cálculo do
 * tempo parado) acontece depois, na tela de Passar Turno.
 */

(function () {
  const usuario = Auth.exigirLogin();
  if (!usuario) return;
  Auth.garantirSetorOperador(usuario);
  montarTopbar(document.getElementById("topbar"), usuario, "Receber Turno");

  const setorAtivo = Auth.getSetorAtivo();
  const alerta = document.getElementById("alerta");
  if (!setorAtivo) {
    mostrarAlerta(alerta, "aviso", "Nenhum setor selecionado. Volte ao menu e escolha um setor.");
  }

  const cardLista = document.getElementById("cardLista");
  const corpoTabela = document.getElementById("corpoTabela");
  const contagemAbertas = document.getElementById("contagemAbertas");
  const btnReceberTudo = document.getElementById("btnReceberTudo");
  const msgReceber = document.getElementById("msgReceber");

  const cardAndamento = document.getElementById("cardAndamento");
  const corpoAndamento = document.getElementById("corpoAndamento");
  const contagemAndamento = document.getElementById("contagemAndamento");

  DB.carregarAutoLoad();
  Auth.atualizarUsuarioDoBanco(usuario);
  if (Auth.aplicarGatePassagemObrigatoria(usuario)) return;
  cardLista.hidden = false;
  cardAndamento.hidden = false;
  renderTudo();
  DbUI.definirCallbackRecarregar(renderTudo);
  DbUI.iniciar(document.getElementById("dbStatus"));

  function renderTudo() {
    renderAbertas();
    renderAndamento();
  }

  function renderAbertas() {
    if (!setorAtivo) return;

    const abertas = DB.dados.passagensTurno
      .filter((p) => p.setor === setorAtivo && p.status === "aberta")
      .sort((a, b) => (a.dataHora || "").localeCompare(b.dataHora || ""));

    contagemAbertas.textContent = `${abertas.length} em aberto`;
    btnReceberTudo.hidden = abertas.length === 0;

    if (abertas.length === 0) {
      corpoTabela.innerHTML = `<tr><td colspan="8" style="text-align:center;color:var(--texto-suave);">Nenhuma passagem de turno aguardando recebimento.</td></tr>`;
      mostrarAlerta(alerta, "ok", `Não há nenhuma ordem aguardando recebimento no setor ${setorAtivo} no momento.`);
      return;
    }

    if (Auth.dentroJanelaRecebimentoObrigatorio(usuario)) {
      mostrarAlerta(alerta, "aviso", `Horário obrigatório de recebimento do turno (${usuario.turno}) — receba as ordens abaixo antes de acessar o resto do sistema.`);
    } else {
      limparAlerta(alerta);
    }

    corpoTabela.innerHTML = abertas.map((p) => {
      const nota = DB.buscarNota(p.nota);
      const quando = p.dataHora ? new Date(p.dataHora).toLocaleString("pt-BR") : "—";
      return `
        <tr>
          <td>${escaparHtml(p.nota)}</td>
          <td>${escaparHtml(nota?.ordem || "—")}</td>
          <td>${escaparHtml(nota?.equipamento || "—")}</td>
          <td>${escaparHtml(nota?.textoBreve || "—")}</td>
          <td>${escaparHtml(p.descricao)}</td>
          <td>${escaparHtml(p.turno)}</td>
          <td>${escaparHtml(p.registradoPor)}</td>
          <td>${quando}</td>
        </tr>`;
    }).join("");
  }

  function renderAndamento() {
    if (!setorAtivo) return;

    const emAndamento = DB.dados.passagensTurno
      .filter((p) => p.setor === setorAtivo && p.status === "recebida")
      .sort((a, b) => (b.recebidoEm || "").localeCompare(a.recebidoEm || ""));

    contagemAndamento.textContent = `${emAndamento.length} em acompanhamento`;

    corpoAndamento.innerHTML = emAndamento.length
      ? emAndamento.map((p) => {
          const nota = DB.buscarNota(p.nota);
          const quando = p.recebidoEm ? new Date(p.recebidoEm).toLocaleString("pt-BR") : "—";
          return `
            <tr>
              <td>${escaparHtml(p.nota)}</td>
              <td>${escaparHtml(nota?.ordem || "—")}</td>
              <td>${escaparHtml(nota?.equipamento || "—")}</td>
              <td>${escaparHtml(nota?.textoBreve || "—")}</td>
              <td>${escaparHtml(p.descricao)}</td>
              <td>${escaparHtml(p.recebidoPor || "—")}</td>
              <td>${quando}</td>
            </tr>`;
        }).join("")
      : `<tr><td colspan="7" style="text-align:center;color:var(--texto-suave);">Nada em acompanhamento no momento.</td></tr>`;
  }

  btnReceberTudo.addEventListener("click", async () => {
    const agora = new Date().toISOString();
    const abertas = DB.dados.passagensTurno.filter((p) => p.setor === setorAtivo && p.status === "aberta");
    if (abertas.length === 0) return;

    for (const p of abertas) {
      p.status = "recebida";
      p.recebidoPor = usuario.nome;
      p.recebidoEm = agora;
      if (!p.inicioParadaEm) p.inicioParadaEm = p.dataHora || agora; // registros antigos sem esse campo
    }
    DB.marcarEventosPassagemRecebidos(setorAtivo, usuario.nome);

    btnReceberTudo.disabled = true;
    const ok = await DbUI.salvarDados(alerta);
    btnReceberTudo.disabled = false;

    if (ok) {
      msgReceber.textContent = `${abertas.length} ordem(ns) recebida(s).`;
      msgReceber.style.color = "var(--verde-ok)";
      renderTudo();
    }
  });
})();
