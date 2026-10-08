/* SFM — relatorios.html (papéis gestor, admin e mestre) */

(async function () {
  const usuario = Auth.exigirPapel(["gestor", "admin", "mestre"]);
  if (!usuario) return;
  montarTopbar(document.getElementById("topbar"), usuario, "Relatórios");

  if (usuario.papel === "admin" || usuario.papel === "mestre") document.getElementById("linkAdminSub").hidden = false;

  const conteudo = document.getElementById("conteudo");

  const filtroSetor = document.getElementById("filtroSetor");
  const filtroTipoManutencao = document.getElementById("filtroTipoManutencao");
  const filtroDataDe = document.getElementById("filtroDataDe");
  const filtroDataAte = document.getElementById("filtroDataAte");
  const filtroTexto = document.getElementById("filtroTexto");
  const filtroSomenteAbertas = document.getElementById("filtroSomenteAbertas");
  const msgNotasPadrao = document.getElementById("msgNotasPadrao");
  const corpoTabelaNotas = document.getElementById("corpoTabelaNotas");
  const contagemNotas = document.getElementById("contagemNotas");

  const filtroSetorPT = document.getElementById("filtroSetorPT");
  const filtroStatusPT = document.getElementById("filtroStatusPT");
  const filtroDataDePT = document.getElementById("filtroDataDePT");
  const filtroDataAtePT = document.getElementById("filtroDataAtePT");
  const corpoTabelaPT = document.getElementById("corpoTabelaPT");
  const contagemPT = document.getElementById("contagemPT");

  for (const sel of [filtroSetor, filtroSetorPT]) {
    sel.innerHTML += SETORES.map((s) => `<option value="${s}">${s}</option>`).join("");
  }

  // Mestre só vê os dados do próprio setor (ver papelTemSetorFixo) — o filtro de Setor nem
  // aparece (não há o que escolher) e tanto o carregamento quanto a filtragem abaixo já ficam
  // travados nele.
  const setorTravado = papelTemSetorFixo(usuario.papel) ? usuario.setor : null;
  if (setorTravado) {
    document.getElementById("campoFiltroSetorWrap").hidden = true;
    document.getElementById("campoFiltroSetorPTWrap").hidden = true;
  }

  // ---------- Ordenação por cabeçalho clicável (ver tornarOrdenavel/ordenarPorEstado em
  // js/util.js, compartilhadas com Passar Turno e Receber Turno) — estados e getters de cada
  // tabela ficam definidos ANTES de qualquer chamada a renderNotas/renderPassagens (inclusive a
  // primeira, mais abaixo): como são `const`, usá-los antes da linha que os declara é um
  // ReferenceError (temporal dead zone) mesmo a função que os usa sendo hoisted.

  const estadoOrdemNotas = { campo: "horaEntrada", dir: "desc" };
  const gettersNotas = {
    equipamento: (n) => n.nomeEquipamento || n.equipamento || "",
    status: (n) => n.statusUsuario || n.statusSistema || "",
    tipoManutencao: (n) => tipoManutencaoPorCentrab(n.centrab) || "",
  };
  tornarOrdenavel(document.querySelector("#corpoTabelaNotas").closest("table").querySelector("thead"), estadoOrdemNotas, () => renderNotas());

  const estadoOrdemPT = { campo: "dataHora", dir: "desc" };
  tornarOrdenavel(document.querySelector("#corpoTabelaPT").closest("table").querySelector("thead"), estadoOrdemPT, () => renderPassagens());

  // Sem `setor`: carrega os 4 setores de uma vez (ver DB._escopoSetores) — Relatórios normalmente
  // precisa ver todos ao mesmo tempo (o filtro de setor acima é só visual, em cima do que já
  // carregou); Mestre é a exceção, carrega só o próprio.
  await DB.carregarAutoLoad({ notas: true, setor: setorTravado || undefined });
  conteudo.hidden = false;

  // Por padrão (antes de o usuário mexer em qualquer filtro), "Ordens / notas" mostra só as
  // ordens ainda abertas (sem Data fim) do dia mais recente importado — não a lista inteira.
  // Qualquer filtro mexido pelo usuário (datas, setor, texto ou o checkbox) vale a partir daí,
  // sem mais forçar isso.
  const ultimoDia = DB.notas.reduce((max, n) => (n.dataEntrada && n.dataEntrada > max ? n.dataEntrada : max), "");
  if (ultimoDia) {
    filtroDataDe.value = ultimoDia;
    filtroDataAte.value = ultimoDia;
    filtroSomenteAbertas.checked = true;
    msgNotasPadrao.textContent = `Mostrando por padrão só as ordens abertas de ${formatarDataBR(ultimoDia)} (o dia mais recente importado) — ajuste os filtros acima para ver outras.`;
  }

  renderNotas();
  renderPassagens();
  DbUI.definirCallbackRecarregar(() => { renderNotas(); renderPassagens(); });
  DbUI.iniciar(document.getElementById("dbStatus"));

  // Relatórios é sobre o que TODO MUNDO registrou (outros setores, outros operadores,
  // possivelmente noutro PC) — sem atualização automática, esta tela ficaria presa no que
  // existia no instante em que foi aberta. Em vez de um botão pra lembrar de atualizar, recarrega
  // sozinho em segundo plano (sem spinner, sem travar a tela) a cada 30s e também sempre que a
  // janela volta a ficar em primeiro plano (o caso mais comum: a pessoa estava noutra tela do
  // sistema e volta pra conferir o que mudou).
  let recarregandoEmSegundoPlano = false;
  async function atualizarEmSegundoPlano() {
    if (recarregandoEmSegundoPlano || document.hidden) return;
    recarregandoEmSegundoPlano = true;
    try {
      await DB.recarregarDoDisco();
      if (DB.autoLoadOk) { renderNotas(); renderPassagens(); }
    } finally {
      recarregandoEmSegundoPlano = false;
    }
  }
  setInterval(atualizarEmSegundoPlano, 30000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) atualizarEmSegundoPlano(); });
  window.addEventListener("focus", atualizarEmSegundoPlano);

  [filtroSetor, filtroTipoManutencao, filtroDataDe, filtroDataAte, filtroTexto, filtroSomenteAbertas].forEach((el) => el.addEventListener("input", renderNotas));
  [filtroSetorPT, filtroStatusPT, filtroDataDePT, filtroDataAtePT].forEach((el) => el.addEventListener("input", renderPassagens));

  function renderNotas() {
    const setor = setorTravado || filtroSetor.value;
    const de = filtroDataDe.value;
    const ate = filtroDataAte.value;
    const termo = filtroTexto.value.trim().toLowerCase();
    const tipo = filtroTipoManutencao.value;

    let notas = DB.notas.slice();
    if (setor) notas = notas.filter((n) => n.setor === setor);
    if (tipo) notas = notas.filter((n) => tipoManutencaoPorCentrab(n.centrab) === tipo);
    if (de) notas = notas.filter((n) => n.dataEntrada && n.dataEntrada >= de);
    if (ate) notas = notas.filter((n) => n.dataEntrada && n.dataEntrada <= ate);
    if (filtroSomenteAbertas.checked) notas = notas.filter((n) => !n.dataFim);
    if (termo) {
      notas = notas.filter((n) =>
        [n.nota, n.ordem, n.textoBreve, n.equipamento, n.nomeEquipamento].some((v) => (v || "").toString().toLowerCase().includes(termo))
      );
    }
    ordenarPorEstado(notas, estadoOrdemNotas, gettersNotas);

    contagemNotas.textContent = `${notas.length} nota(s)`;
    notas = notas.slice(0, 1000);

    corpoTabelaNotas.innerHTML = notas.map((n) => `
      <tr>
        <td>${escaparHtml(n.nota)}</td>
        <td>${escaparHtml(n.ordem || "—")}</td>
        <td><span class="tag setor-${n.setor}">${n.setor}</span></td>
        <td>${tagTipoManutencaoHtml(n.centrab)}</td>
        <td>${n.nomeEquipamento ? `${escaparHtml(n.nomeEquipamento)}<br><small style="color:var(--texto-suave);">${escaparHtml(n.equipamento || "—")}</small>` : escaparHtml(n.equipamento || "—")}</td>
        <td>${escaparHtml(n.loc || "—")}</td>
        <td>${escaparHtml(n.textoBreve || "—")}</td>
        <td>${escaparHtml(n.statusUsuario || n.statusSistema || "—")}</td>
        <td>${formatarDataBR(n.dataEntrada)}</td>
        <td>${escaparHtml(n.horaEntrada || "—")}</td>
        <td>${formatarDataBR(n.dataFim)}</td>
      </tr>`).join("") || `<tr><td colspan="11" style="text-align:center;color:var(--texto-suave);">Nenhuma nota encontrada.</td></tr>`;
  }

  // ---------- Passagens de turno ----------
  // Uma linha por ordem (não por evento de passagem) — o botão Detalhes abre o histórico de
  // descrições de cada vez que essa ordem foi passada (ver historicoDescricoesPassagem), que
  // antes vivia numa tabela "Eventos de passagem de turno" à parte — removida por ser
  // redundante: toda a mesma informação (quem passou, quando, pra qual turno, cada ordem) já
  // aparece aqui, só que uma linha por ordem em vez de uma linha por evento.

  /**
   * Histórico de descrições de uma passagem (pelo `passagemId`, que é o `id` da própria
   * passagem em DB.dados.passagensTurno) através de todos os eventos de passagem de turno em
   * que ela apareceu, da mais antiga pra mais nova — toda vez que a ordem é passada de novo
   * ("Continuar parada") sem ser finalizada, gera um evento novo com sua própria descrição.
   * Eventos registrados antes dessa amarração existir não têm `passagemId` e não entram aqui.
   */
  function historicoDescricoesPassagem(passagemId) {
    if (!passagemId) return [];
    const historico = [];
    for (const ev of DB.dados.eventosPassagem) {
      for (const o of ev.ordens) {
        if (o.passagemId === passagemId) {
          historico.push({ passadoEm: ev.passadoEm, passadoPor: ev.passadoPor, turnoDestino: ev.turnoDestino, descricao: o.descricao });
        }
      }
    }
    historico.sort((a, b) => (a.passadoEm || "").localeCompare(b.passadoEm || ""));
    return historico;
  }

  function renderPassagens() {
    const setor = setorTravado || filtroSetorPT.value;
    const status = filtroStatusPT.value;
    const de = filtroDataDePT.value;
    const ate = filtroDataAtePT.value;

    let lista = DB.dados.passagensTurno.slice();
    if (setor) lista = lista.filter((p) => p.setor === setor);
    if (status) lista = lista.filter((p) => p.status === status);
    if (de) lista = lista.filter((p) => p.dataHora && formatarDataISO(new Date(p.dataHora)) >= de);
    if (ate) lista = lista.filter((p) => p.dataHora && formatarDataISO(new Date(p.dataHora)) <= ate);
    ordenarPorEstado(lista, estadoOrdemPT, {});

    contagemPT.textContent = `${lista.length} passagem(ns)`;
    lista = lista.slice(0, 1000);

    corpoTabelaPT.innerHTML = lista.map((p) => `
      <tr data-id="${escaparHtml(p.id)}">
        <td>${escaparHtml(p.defeito || "—")}</td>
        <td>${escaparHtml(p.maquina || "—")}</td>
        <td>${escaparHtml(p.celula || "—")}</td>
        <td><span class="tag setor-${p.setor}">${p.setor}</span></td>
        <td>${escaparHtml(p.turno)}</td>
        <td>${escaparHtml(p.descricao)}</td>
        <td><span class="tag status-${p.status}">${p.status}</span></td>
        <td>${escaparHtml(p.registradoPor)}</td>
        <td>${p.dataHora ? new Date(p.dataHora).toLocaleString("pt-BR") : "—"}</td>
        <td><button type="button" class="secundario btnDetalhesPassagem">Detalhes</button></td>
      </tr>`).join("") || `<tr><td colspan="10" style="text-align:center;color:var(--texto-suave);">Nenhuma passagem encontrada.</td></tr>`;

    corpoTabelaPT.querySelectorAll(".btnDetalhesPassagem").forEach((btn) => {
      btn.addEventListener("click", () => {
        const tr = btn.closest("tr");
        const passagem = DB.dados.passagensTurno.find((p) => p.id === tr.dataset.id);
        if (!passagem) return;
        abrirModalDetalhePassagem(passagem);
      });
    });
  }

  /** Menu flutuante com o detalhe completo de uma ordem passada: tudo que não cabe mais na
   * tabela (setor/máquina/loc./status, recebimento, finalização, tempo parado) + o histórico de
   * descrições de cada vez que ela foi passada (uma linha por evento de passagem de turno, da
   * mais antiga pra mais nova), quando passada mais de uma vez. */
  function abrirModalDetalhePassagem(passagem) {
    const historico = historicoDescricoesPassagem(passagem.id);
    const corpo = `
      <div style="margin-bottom:14px;display:flex;flex-wrap:wrap;gap:16px;font-size:13px;">
        <div><strong>Setor:</strong> <span class="tag setor-${passagem.setor}">${passagem.setor}</span></div>
        <div><strong>Máquina:</strong> ${escaparHtml(passagem.maquina || "—")}</div>
        <div><strong>Loc. de Instalação:</strong> ${escaparHtml(passagem.celula || "—")}</div>
        <div><strong>Status:</strong> <span class="tag status-${passagem.status}">${passagem.status}</span></div>
        <div><strong>Tempo parado:</strong> ${formatarDuracaoMinutos(passagem.tempoParadoMinutos)}</div>
        <div><strong>Passado por:</strong> ${escaparHtml(passagem.registradoPor)}, em ${passagem.dataHora ? new Date(passagem.dataHora).toLocaleString("pt-BR") : "—"}</div>
        <div><strong>Recebido por:</strong> ${escaparHtml(passagem.recebidoPor || "—")}${passagem.recebidoEm ? `, em ${new Date(passagem.recebidoEm).toLocaleString("pt-BR")}` : ""}</div>
        <div><strong>Finalizada em:</strong> ${passagem.finalizadaEm ? new Date(passagem.finalizadaEm).toLocaleString("pt-BR") : "—"}</div>
      </div>
      <p class="subtitulo" style="margin:0 0 8px;">Descrição em cada passagem de turno</p>
      ${historico.length
        ? `<ol style="margin:0;padding-left:18px;">${historico.map((h) => `
            <li style="margin-bottom:8px;">
              <small style="color:var(--texto-suave);">${h.passadoEm ? new Date(h.passadoEm).toLocaleString("pt-BR") : "—"} — ${escaparHtml(h.passadoPor || "—")} (para o turno ${escaparHtml(h.turnoDestino || "—")})</small><br>
              ${escaparHtml(h.descricao || "—")}
            </li>`).join("")}</ol>`
        : `<p>${escaparHtml(passagem.descricao || "—")}</p>`}`;
    abrirModal(`${passagem.defeito || "Ordem"} — ${passagem.maquina || ""}`, corpo);
  }
})();
