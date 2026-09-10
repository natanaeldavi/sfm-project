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
  const corpoTabelaPT = document.getElementById("corpoTabelaPT");
  const contagemPT = document.getElementById("contagemPT");

  for (const sel of [filtroSetor, filtroSetorPT]) {
    sel.innerHTML += SETORES.map((s) => `<option value="${s}">${s}</option>`).join("");
  }

  DB.carregarAutoLoad();
  conteudo.hidden = false;
  renderNotas();
  renderPassagens();
  DbUI.definirCallbackRecarregar(() => { renderNotas(); renderPassagens(); });
  DbUI.iniciar(document.getElementById("dbStatus"));

  [filtroSetor, filtroDataDe, filtroDataAte, filtroTexto].forEach((el) => el.addEventListener("input", renderNotas));
  [filtroSetorPT, filtroStatusPT].forEach((el) => el.addEventListener("change", renderPassagens));

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

    let lista = DB.dados.passagensTurno.slice();
    if (setor) lista = lista.filter((p) => p.setor === setor);
    if (status) lista = lista.filter((p) => p.status === status);
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
        <td>${p.finalizadaEm ? new Date(p.finalizadaEm).toLocaleString("pt-BR") : "—"}</td>
        <td>${formatarDuracaoMinutos(p.tempoParadoMinutos)}</td>
      </tr>`).join("") || `<tr><td colspan="9" style="text-align:center;color:var(--texto-suave);">Nenhuma passagem encontrada.</td></tr>`;
  }
})();
