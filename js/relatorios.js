/* SFM — relatorios.html (papéis gestor e admin) */

(function () {
  const usuario = Auth.exigirPapel(["gestor", "admin"]);
  if (!usuario) return;
  montarTopbar(document.getElementById("topbar"), usuario, "Relatórios");

  if (usuario.papel === "admin") document.getElementById("linkAdminSub").hidden = false;

  const conteudo = document.getElementById("conteudo");

  const filtroSetor = document.getElementById("filtroSetor");
  const filtroDataDe = document.getElementById("filtroDataDe");
  const filtroDataAte = document.getElementById("filtroDataAte");
  const filtroTexto = document.getElementById("filtroTexto");
  const corpoTabelaNotas = document.getElementById("corpoTabelaNotas");
  const contagemNotas = document.getElementById("contagemNotas");

  const filtroSetorPT = document.getElementById("filtroSetorPT");
  const filtroStatusPT = document.getElementById("filtroStatusPT");
  const filtroDataDePT = document.getElementById("filtroDataDePT");
  const filtroDataAtePT = document.getElementById("filtroDataAtePT");
  const corpoTabelaPT = document.getElementById("corpoTabelaPT");
  const contagemPT = document.getElementById("contagemPT");

  const filtroSetorEP = document.getElementById("filtroSetorEP");
  const filtroDataDeEP = document.getElementById("filtroDataDeEP");
  const filtroDataAteEP = document.getElementById("filtroDataAteEP");
  const corpoTabelaEP = document.getElementById("corpoTabelaEP");
  const contagemEP = document.getElementById("contagemEP");

  for (const sel of [filtroSetor, filtroSetorPT, filtroSetorEP]) {
    sel.innerHTML += SETORES.map((s) => `<option value="${s}">${s}</option>`).join("");
  }

  DB.carregarAutoLoad();
  conteudo.hidden = false;
  renderNotas();
  renderPassagens();
  renderEventosPassagem();
  DbUI.definirCallbackRecarregar(() => { renderNotas(); renderPassagens(); renderEventosPassagem(); });
  DbUI.iniciar(document.getElementById("dbStatus"));

  [filtroSetor, filtroDataDe, filtroDataAte, filtroTexto].forEach((el) => el.addEventListener("input", renderNotas));
  [filtroSetorPT, filtroStatusPT, filtroDataDePT, filtroDataAtePT].forEach((el) => el.addEventListener("input", renderPassagens));
  [filtroSetorEP, filtroDataDeEP, filtroDataAteEP].forEach((el) => el.addEventListener("input", renderEventosPassagem));

  function renderNotas() {
    const setor = filtroSetor.value;
    const de = filtroDataDe.value;
    const ate = filtroDataAte.value;
    const termo = filtroTexto.value.trim().toLowerCase();

    let notas = DB.notas.slice();
    if (setor) notas = notas.filter((n) => n.setor === setor);
    if (de) notas = notas.filter((n) => n.dataEntrada && n.dataEntrada >= de);
    if (ate) notas = notas.filter((n) => n.dataEntrada && n.dataEntrada <= ate);
    if (termo) {
      notas = notas.filter((n) =>
        [n.nota, n.ordem, n.textoBreve, n.equipamento].some((v) => (v || "").toString().toLowerCase().includes(termo))
      );
    }
    notas.sort((a, b) => (b.dataEntrada || "").localeCompare(a.dataEntrada || ""));

    contagemNotas.textContent = `${notas.length} nota(s)`;
    notas = notas.slice(0, 1000);

    corpoTabelaNotas.innerHTML = notas.map((n) => `
      <tr>
        <td>${escaparHtml(n.nota)}</td>
        <td>${escaparHtml(n.ordem || "—")}</td>
        <td><span class="tag setor-${n.setor}">${n.setor}</span></td>
        <td><span class="tag area-${n.area}">${n.area}</span></td>
        <td>${escaparHtml(n.equipamento || "—")}</td>
        <td>${escaparHtml(n.textoBreve || "—")}</td>
        <td>${escaparHtml(n.statusUsuario || n.statusSistema || "—")}</td>
        <td>${formatarDataBR(n.dataEntrada)}</td>
        <td>${escaparHtml(n.horaEntrada || "—")}</td>
        <td>${formatarDataBR(n.dataFim)}</td>
      </tr>`).join("") || `<tr><td colspan="10" style="text-align:center;color:var(--texto-suave);">Nenhuma nota encontrada.</td></tr>`;
  }

  function renderPassagens() {
    const setor = filtroSetorPT.value;
    const status = filtroStatusPT.value;
    const de = filtroDataDePT.value;
    const ate = filtroDataAtePT.value;

    let lista = DB.dados.passagensTurno.slice();
    if (setor) lista = lista.filter((p) => p.setor === setor);
    if (status) lista = lista.filter((p) => p.status === status);
    if (de) lista = lista.filter((p) => p.dataHora && formatarDataISO(new Date(p.dataHora)) >= de);
    if (ate) lista = lista.filter((p) => p.dataHora && formatarDataISO(new Date(p.dataHora)) <= ate);
    lista.sort((a, b) => (b.dataHora || "").localeCompare(a.dataHora || ""));

    contagemPT.textContent = `${lista.length} passagem(ns)`;
    lista = lista.slice(0, 1000);

    corpoTabelaPT.innerHTML = lista.map((p) => `
      <tr>
        <td>${escaparHtml(p.nota)}</td>
        <td><span class="tag setor-${p.setor}">${p.setor}</span></td>
        <td>${escaparHtml(p.turno)}</td>
        <td>${escaparHtml(p.descricao)}</td>
        <td><span class="tag status-${p.status}">${p.status}</span></td>
        <td>${escaparHtml(p.registradoPor)}</td>
        <td>${p.dataHora ? new Date(p.dataHora).toLocaleString("pt-BR") : "—"}</td>
        <td>${escaparHtml(p.recebidoPor || "—")}</td>
        <td>${p.recebidoEm ? new Date(p.recebidoEm).toLocaleString("pt-BR") : "—"}</td>
        <td>${p.finalizadaEm ? new Date(p.finalizadaEm).toLocaleString("pt-BR") : "—"}</td>
        <td>${formatarDuracaoMinutos(p.tempoParadoMinutos)}</td>
      </tr>`).join("") || `<tr><td colspan="11" style="text-align:center;color:var(--texto-suave);">Nenhuma passagem encontrada.</td></tr>`;
  }

  // ---------- Eventos de passagem de turno (log permanente — ver DB.registrarEventoPassagem) ----------

  function renderEventosPassagem() {
    const setor = filtroSetorEP.value;
    const de = filtroDataDeEP.value;
    const ate = filtroDataAteEP.value;

    let eventos = DB.dados.eventosPassagem.slice();
    if (setor) eventos = eventos.filter((e) => e.setor === setor);
    if (de) eventos = eventos.filter((e) => e.passadoEm && formatarDataISO(new Date(e.passadoEm)) >= de);
    if (ate) eventos = eventos.filter((e) => e.passadoEm && formatarDataISO(new Date(e.passadoEm)) <= ate);
    eventos.sort((a, b) => (b.passadoEm || "").localeCompare(a.passadoEm || ""));

    contagemEP.textContent = `${eventos.length} evento(s)`;
    eventos = eventos.slice(0, 1000);

    corpoTabelaEP.innerHTML = eventos.map((e) => `
      <tr data-id="${escaparHtml(e.id)}">
        <td>#${e.numero}</td>
        <td><span class="tag setor-${e.setor}">${e.setor}</span></td>
        <td>${escaparHtml(e.turnoOrigem || "—")} &rarr; ${escaparHtml(e.turnoDestino || "—")}</td>
        <td>${escaparHtml(e.passadoPor)}</td>
        <td>${e.passadoEm ? new Date(e.passadoEm).toLocaleString("pt-BR") : "—"}</td>
        <td>${escaparHtml(e.recebidoPor || "—")}</td>
        <td>${e.recebidoEm ? new Date(e.recebidoEm).toLocaleString("pt-BR") : "—"}</td>
        <td>${e.ordens.length}</td>
        <td><button type="button" class="secundario btnVerOrdensEP">Ver ordens</button></td>
      </tr>`).join("") || `<tr><td colspan="9" style="text-align:center;color:var(--texto-suave);">Nenhum evento encontrado.</td></tr>`;

    corpoTabelaEP.querySelectorAll(".btnVerOrdensEP").forEach((btn) => {
      btn.addEventListener("click", () => {
        const tr = btn.closest("tr");
        const proximo = tr.nextElementSibling;
        if (proximo && proximo.classList.contains("linha-detalhe-ep")) {
          proximo.remove();
          return;
        }
        corpoTabelaEP.querySelectorAll(".linha-detalhe-ep").forEach((el) => el.remove());

        const evento = DB.dados.eventosPassagem.find((e) => e.id === tr.dataset.id);
        if (!evento) return;

        const detalhe = document.createElement("tr");
        detalhe.className = "linha-detalhe-ep";
        detalhe.innerHTML = `<td colspan="9">
          <table style="margin:4px 0;">
            <thead><tr><th>Nota</th><th>Ordem</th><th>Equipamento</th><th>Descrição</th><th>Parada até aquele momento</th></tr></thead>
            <tbody>
              ${evento.ordens.map((o) => `<tr>
                <td>${escaparHtml(o.nota)}</td>
                <td>${escaparHtml(o.ordem || "—")}</td>
                <td>${escaparHtml(o.equipamento || "—")}</td>
                <td>${escaparHtml(o.descricao || "—")}</td>
                <td>${formatarDuracaoMinutos(o.tempoParadoMinutos)}</td>
              </tr>`).join("")}
            </tbody>
          </table>
        </td>`;
        tr.after(detalhe);
      });
    });
  }
})();
