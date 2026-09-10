/* SFM — sfm.html (painel da reunião diária)
 *
 * Por padrão mostra o período automático da reunião de hoje (terça a sexta
 * cobre só o dia anterior; segunda cobre sexta+sábado+domingo — ver
 * calcularJanelaSfm() em util.js), mas o período é livremente selecionável
 * acima do painel (campos De/Até), para rever ou corrigir reuniões
 * passadas. Aos sábados/domingos não há reunião automática, mas o painel
 * continua acessível com um período escolhido manualmente.
 */

const CORES_SETOR = { Gasolina: "#B9863B", Diesel: "#2E5A82", Controle: "#5B4A8A", Biela: "#2E7D4F" };
const COR_MECANICA = "#8A6B3E";
const COR_ELETRICA = "#A13A2A";
const COR_OUTROS = "#8A97A3";
const COR_ATENDIDA = "#2E7D4F";
const COR_NAO_ATENDIDA = "#B3402A";

(function () {
  const usuario = Auth.exigirLogin();
  if (!usuario) return;
  Auth.garantirSetorOperador(usuario);

  DB.carregarAutoLoad();
  Auth.atualizarUsuarioDoBanco(usuario);
  if (Auth.aplicarGatePassagemObrigatoria(usuario)) return;
  if (Auth.aplicarGateRecebimento(usuario)) return;

  montarTopbar(document.getElementById("topbar"), usuario, "Painel da Reunião");

  const alerta = document.getElementById("alerta");
  const conteudo = document.getElementById("conteudo");
  const semReuniao = document.getElementById("semReuniao");
  const inputDe = document.getElementById("inputDe");
  const inputAte = document.getElementById("inputAte");
  const btnAtualizarPeriodo = document.getElementById("btnAtualizarPeriodo");
  const btnPeriodoHoje = document.getElementById("btnPeriodoHoje");

  let janela = []; // datas ISO do período atualmente exibido
  let graficoSetores = null, graficoAreas = null, graficoEficiencia = null;
  let pizzaSetores = null, pizzaAreas = null, pizzaAtendimento = null;

  function periodoPadrao() {
    return calcularJanelaSfm() || [ontemISO()];
  }

  const janelaHoje = calcularJanelaSfm();
  if (!janelaHoje) {
    const proxima = proximaSegundaISO();
    mostrarAlerta(semReuniao, "info",
      `Hoje não há reunião de SFM agendada (sábado/domingo) — a próxima reunião automática será segunda-feira (${formatarDataBR(proxima)}) e vai reunir sexta, sábado e domingo. Você ainda pode escolher outro período abaixo.`);
  }

  const padrao = periodoPadrao();
  inputDe.value = padrao[0];
  inputAte.value = padrao[padrao.length - 1];

  function aplicarPeriodo(de, ate) {
    if (!de || !ate || de > ate) {
      mostrarAlerta(alerta, "erro", 'Selecione um período válido ("De" deve ser antes ou igual a "Até").');
      return;
    }
    if (diasEntreISO(de, ate) > 366) {
      mostrarAlerta(alerta, "erro", "Período muito longo (máximo 366 dias).");
      return;
    }
    limparAlerta(alerta);
    janela = expandirIntervaloISO(de, ate);

    document.getElementById("subtituloData").textContent = de === ate
      ? `Dados de ${formatarDataBR(de)}`
      : `Dados de ${formatarDataBR(de)} a ${formatarDataBR(ate)}`;

    conteudo.hidden = false;
    renderTudo();
  }

  btnAtualizarPeriodo.addEventListener("click", () => aplicarPeriodo(inputDe.value, inputAte.value));
  btnPeriodoHoje.addEventListener("click", () => {
    const p = periodoPadrao();
    inputDe.value = p[0];
    inputAte.value = p[p.length - 1];
    aplicarPeriodo(inputDe.value, inputAte.value);
  });

  DbUI.definirCallbackRecarregar(() => aplicarPeriodo(inputDe.value, inputAte.value));
  DbUI.iniciar(document.getElementById("dbStatus"));

  aplicarPeriodo(inputDe.value, inputAte.value);

  /** "Status sistema" com "MSPN" = nota ainda não atendida (sem ordem gerada no SAP); qualquer outro status = atendida. */
  function notaNaoAtendida(nota) {
    return (nota.statusSistema || "").toUpperCase().includes("MSPN");
  }

  /** Conta notas dos dias da janela por setor/área/atendimento (automático, via Status sistema). */
  function calcularResumoJanela(datas) {
    const resumo = {};
    for (const s of SETORES) resumo[s] = { mecanica: 0, eletrica: 0, outros: 0, total: 0, atendidas: 0, naoAtendidas: 0 };
    const datasSet = new Set(datas);
    for (const n of DB.notas) {
      if (!datasSet.has(n.dataEntrada)) continue;
      const r = resumo[n.setor];
      if (!r) continue;
      r.total++;
      if (n.area === "Mecânica") r.mecanica++;
      else if (n.area === "Elétrica") r.eletrica++;
      else r.outros++;
      if (notaNaoAtendida(n)) r.naoAtendidas++;
      else r.atendidas++;
    }
    return resumo;
  }

  function renderTudo() {
    const resumo = calcularResumoJanela(janela);
    renderCards(resumo);
    renderTabela(resumo);
    renderGraficoSetores(resumo);
    renderGraficoAreas(resumo);
    renderGraficoEficiencia();
    renderTopProblemas();
    renderRanking();
    renderPizzaSetores(resumo);
    renderPizzaAreas(resumo);
    renderPizzaAtendimento(resumo);
  }

  function renderCards(resumo) {
    let totalGeral = 0, mecGeral = 0, eleGeral = 0;
    for (const s of SETORES) { totalGeral += resumo[s].total; mecGeral += resumo[s].mecanica; eleGeral += resumo[s].eletrica; }
    document.getElementById("cardsResumo").innerHTML = `
      <div class="stat-card"><div class="valor">${totalGeral}</div><div class="rotulo">Total de ordens</div></div>
      <div class="stat-card"><div class="valor">${mecGeral}</div><div class="rotulo">Mecânica</div></div>
      <div class="stat-card"><div class="valor">${eleGeral}</div><div class="rotulo">Elétrica</div></div>
    `;
  }

  function renderTabela(resumo) {
    const corpo = document.getElementById("corpoTabelaSetores");
    corpo.innerHTML = SETORES.map((s) => {
      const r = resumo[s];
      const eficiencia = r.total > 0 ? Math.round((r.atendidas / r.total) * 100) : null;
      return `
        <tr data-setor="${s}">
          <td><span class="tag setor-${s}">${s}</span></td>
          <td>${r.mecanica}</td>
          <td>${r.eletrica}</td>
          <td>${r.outros}</td>
          <td>${r.total}</td>
          <td>${r.atendidas}</td>
          <td>${r.naoAtendidas}</td>
          <td>${eficiencia !== null ? eficiencia + "%" : "—"}</td>
        </tr>`;
    }).join("");
  }

  function renderGraficoSetores(resumo) {
    const ctx = document.getElementById("graficoSetores");
    const dados = SETORES.map((s) => resumo[s].total);
    if (graficoSetores) graficoSetores.destroy();
    graficoSetores = new Chart(ctx, {
      type: "bar",
      data: {
        labels: SETORES,
        datasets: [{ label: "Ordens", data: dados, backgroundColor: SETORES.map((s) => CORES_SETOR[s]) }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: { y: { beginAtZero: true, ticks: { precision: 0 } } },
      },
    });
  }

  function renderGraficoAreas(resumo) {
    const ctx = document.getElementById("graficoAreas");
    if (graficoAreas) graficoAreas.destroy();
    graficoAreas = new Chart(ctx, {
      type: "bar",
      data: {
        labels: SETORES,
        datasets: [
          { label: "Mecânica", data: SETORES.map((s) => resumo[s].mecanica), backgroundColor: COR_MECANICA },
          { label: "Elétrica", data: SETORES.map((s) => resumo[s].eletrica), backgroundColor: COR_ELETRICA },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        scales: { y: { beginAtZero: true, ticks: { precision: 0 } } },
      },
    });
  }

  /** Eficiência automática por dia (últimos 14 dias com nota registrada), direto do Status sistema — sem lançamento manual. */
  function renderGraficoEficiencia() {
    const ctx = document.getElementById("graficoEficiencia");
    const dias = Array.from(new Set(DB.notas.map((n) => n.dataEntrada).filter(Boolean))).sort().slice(-14);

    const datasets = SETORES.map((s) => ({
      label: s,
      borderColor: CORES_SETOR[s],
      backgroundColor: CORES_SETOR[s],
      fill: false,
      spanGaps: true,
      data: dias.map((dia) => {
        const r = calcularResumoJanela([dia])[s];
        return r.total > 0 ? Math.round((r.atendidas / r.total) * 100) : null;
      }),
    }));

    if (graficoEficiencia) graficoEficiencia.destroy();
    graficoEficiencia = new Chart(ctx, {
      type: "line",
      data: { labels: dias.map(formatarDataBR), datasets },
      options: {
        responsive: true, maintainAspectRatio: false,
        scales: { y: { beginAtZero: true, max: 100, ticks: { callback: (v) => v + "%" } } },
      },
    });
  }

  /** Opções comuns dos gráficos de pizza: legenda sempre visível e tooltip com percentual (identidade nunca só por cor). */
  function opcoesPizza() {
    return {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { position: "bottom" },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const total = ctx.dataset.data.reduce((a, b) => a + b, 0);
              const pct = total > 0 ? Math.round((ctx.parsed / total) * 100) : 0;
              return ` ${ctx.label}: ${ctx.parsed} (${pct}%)`;
            },
          },
        },
      },
    };
  }

  function renderPizzaSetores(resumo) {
    const ctx = document.getElementById("pizzaSetores");
    if (pizzaSetores) pizzaSetores.destroy();
    pizzaSetores = new Chart(ctx, {
      type: "pie",
      data: {
        labels: SETORES,
        datasets: [{ data: SETORES.map((s) => resumo[s].total), backgroundColor: SETORES.map((s) => CORES_SETOR[s]) }],
      },
      options: opcoesPizza(),
    });
  }

  function renderPizzaAreas(resumo) {
    const ctx = document.getElementById("pizzaAreas");
    let mecanica = 0, eletrica = 0, outros = 0;
    for (const s of SETORES) { mecanica += resumo[s].mecanica; eletrica += resumo[s].eletrica; outros += resumo[s].outros; }
    if (pizzaAreas) pizzaAreas.destroy();
    pizzaAreas = new Chart(ctx, {
      type: "pie",
      data: {
        labels: ["Mecânica", "Elétrica", "Outros"],
        datasets: [{ data: [mecanica, eletrica, outros], backgroundColor: [COR_MECANICA, COR_ELETRICA, COR_OUTROS] }],
      },
      options: opcoesPizza(),
    });
  }

  function renderPizzaAtendimento(resumo) {
    const ctx = document.getElementById("pizzaAtendimento");
    let atendidas = 0, naoAtendidas = 0;
    for (const s of SETORES) {
      atendidas += resumo[s].atendidas;
      naoAtendidas += resumo[s].naoAtendidas;
    }
    if (pizzaAtendimento) pizzaAtendimento.destroy();
    pizzaAtendimento = new Chart(ctx, {
      type: "pie",
      data: {
        labels: ["Atendidas", "Não atendidas"],
        datasets: [{ data: [atendidas, naoAtendidas], backgroundColor: [COR_ATENDIDA, COR_NAO_ATENDIDA] }],
      },
      options: opcoesPizza(),
    });
  }

  /** Máquinas finalizadas com mais de 10h de parada, dentro do período selecionado. */
  function renderTopProblemas() {
    const datasSet = new Set(janela);
    const problemas = DB.dados.passagensTurno.filter((p) =>
      p.status === "finalizada" &&
      p.tempoParadoMinutos >= LIMITE_PARADA_MINUTOS &&
      p.finalizadaEm && datasSet.has(formatarDataISO(new Date(p.finalizadaEm)))
    ).sort((a, b) => b.tempoParadoMinutos - a.tempoParadoMinutos);

    const corpo = document.getElementById("corpoTopProblemas");
    corpo.innerHTML = problemas.length
      ? problemas.map((p) => {
          const nota = DB.buscarNota(p.nota);
          return `<tr>
            <td>${escaparHtml(nota?.equipamento || "—")}</td>
            <td><span class="tag setor-${p.setor}">${p.setor}</span></td>
            <td>${escaparHtml(p.descricao)}</td>
            <td><strong>${formatarDuracaoMinutos(p.tempoParadoMinutos)}</strong></td>
            <td>${new Date(p.finalizadaEm).toLocaleString("pt-BR")}</td>
          </tr>`;
        }).join("")
      : `<tr><td colspan="5" style="text-align:center;color:var(--texto-suave);">Nenhuma máquina passou de 10h parada neste período.</td></tr>`;
  }

  function renderRanking() {
    const contagem = new Map(); // equipamento|setor -> {equipamento, setor, count}
    for (const p of DB.dados.passagensTurno) {
      const nota = DB.buscarNota(p.nota);
      const equipamento = nota?.equipamento || "Não informado";
      const setor = nota?.setor || p.setor || "—";
      const chave = equipamento + "|" + setor;
      const item = contagem.get(chave) || { equipamento, setor, count: 0 };
      item.count++;
      contagem.set(chave, item);
    }
    const ranking = Array.from(contagem.values()).sort((a, b) => b.count - a.count).slice(0, 10);
    const corpo = document.getElementById("corpoRanking");
    corpo.innerHTML = ranking.length
      ? ranking.map((r) => `<tr><td>${escaparHtml(r.equipamento)}</td><td><span class="tag setor-${r.setor}">${escaparHtml(r.setor)}</span></td><td>${r.count}</td></tr>`).join("")
      : `<tr><td colspan="3" style="text-align:center;color:var(--texto-suave);">Sem passagens de turno registradas ainda.</td></tr>`;
  }
})();
