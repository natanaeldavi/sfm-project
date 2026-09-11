/* SFM — quadro-sfm.html
 *
 * Reproduz a folha física (S/Q/D/C) que fica exposta no quadro de cada
 * setor, válida pelo mês inteiro:
 *  - S (acidente / quase acidente) e Q (retrabalho / falha fornecedor):
 *    não existe fonte automática de dados ainda, então cada dia é marcado
 *    manualmente clicando na célula (cicla: em branco -> verde "sem
 *    ocorrência" -> vermelho "ocorrência" -> em branco de novo). Fica salvo
 *    em bd/quadro.json.
 *  - D (Controle de Corretivas Realizadas) e C (Controle de Quebra Graves):
 *    calculados automaticamente a partir de bd/notas.json e das passagens
 *    de turno finalizadas em bd/dados.json (ver README, seção "Atendidas/Não
 *    atendidas" e "Mais de 10h parada").
 *
 * O seletor é de DIA, não de mês — o mês exibido é o do dia escolhido (a
 * folha continua mostrando o mês inteiro), mas Status Geral, o corte de
 * "ainda não aconteceu" no acumulado de C, e a tabela/folha de Top
 * Problemas são todos relativos ao dia selecionado (`diaSelecionado`),
 * não ao dia real de hoje. Isso permite "voltar no tempo" e ver como o
 * quadro estava num dia específico. A permissão de EDITAR S/Q continua
 * amarrada ao dia real de hoje (`hojeReal`) e à janela da SFM — não dá
 * pra marcar ocorrência num dia passado só por estar "visualizando" ele.
 */

const QUADRO_META_EFICIENCIA = 70; // %, mesma meta impressa na folha física

(function () {
  const usuario = Auth.exigirLogin();
  if (!usuario) return;
  Auth.garantirSetorOperador(usuario);

  DB.carregarAutoLoad();
  Auth.atualizarUsuarioDoBanco(usuario);
  if (Auth.aplicarGatePassagemObrigatoria(usuario)) return;
  if (Auth.aplicarGateRecebimento(usuario)) return;

  montarTopbar(document.getElementById("topbar"), usuario, "SFM");

  const alerta = document.getElementById("alerta");
  const campoSetor = document.getElementById("campoSetor");
  const seletorSetor = document.getElementById("seletorSetor");
  const seletorDia = document.getElementById("seletorDia");
  const btnHoje = document.getElementById("btnHoje");
  const btnSalvar = document.getElementById("btnSalvar");
  const btnImprimir = document.getElementById("btnImprimir");
  const btnSetorAnterior = document.getElementById("btnSetorAnterior");
  const btnSetorProximo = document.getElementById("btnSetorProximo");
  const quadroEl = document.getElementById("quadro");

  let graficoD = null;
  let graficoC = null;
  let sujo = false; // há marcações de S/Q ainda não salvas

  // ---------- Setor ----------
  if (usuario.papel === "operador") {
    campoSetor.hidden = true;
  } else {
    seletorSetor.innerHTML = SETORES.map((s) => `<option value="${s}">${s}</option>`).join("");
    seletorSetor.value = SETORES.includes(Auth.getSetorAtivo()) ? Auth.getSetorAtivo() : SETORES[0];
    seletorSetor.addEventListener("change", () => { avisarSeSujo(); Auth.setSetorAtivo(seletorSetor.value); renderizar(); });

    const navegarSetor = (passo) => {
      const i = SETORES.indexOf(seletorSetor.value);
      const proximo = SETORES[(i + passo + SETORES.length) % SETORES.length];
      avisarSeSujo();
      seletorSetor.value = proximo;
      Auth.setSetorAtivo(proximo);
      renderizar();
    };
    btnSetorAnterior.addEventListener("click", () => navegarSetor(-1));
    btnSetorProximo.addEventListener("click", () => navegarSetor(1));
  }

  function setorAtual() {
    return usuario.papel === "operador" ? usuario.setor : seletorSetor.value;
  }

  seletorDia.value = hojeISO();
  seletorDia.addEventListener("change", () => { avisarSeSujo(); renderizar(); });
  btnHoje.addEventListener("click", () => { avisarSeSujo(); seletorDia.value = hojeISO(); renderizar(); });
  btnImprimir.addEventListener("click", () => window.print());

  // O tamanho do quadro na impressão é controlado só por CSS (mm fixos +
  // flexbox em css/quadro.css), sem cálculo de escala em JS — só falta
  // avisar os gráficos Chart.js para redesenharem no tamanho compacto do
  // papel (e de volta ao tamanho de tela depois de imprimir).
  function ajustarGraficosImpressao() {
    if (graficoD) graficoD.resize();
    if (graficoC) graficoC.resize();
  }
  window.addEventListener("beforeprint", ajustarGraficosImpressao);
  window.addEventListener("afterprint", ajustarGraficosImpressao);

  function avisarSeSujo() {
    if (sujo) mostrarAlerta(alerta, "aviso", "Havia marcações não salvas que foram descartadas ao trocar de setor/dia.");
    sujo = false;
  }

  btnSalvar.addEventListener("click", async () => {
    const ok = await DbUI.salvarQuadro(alerta);
    if (ok) {
      sujo = false;
      mostrarAlerta(alerta, "ok", "Marcações salvas.");
    }
  });

  DbUI.definirCallbackRecarregar(() => renderizar());
  DbUI.iniciar(document.getElementById("dbStatus"));

  // ---------- Cálculos automáticos (D e C) ----------

  function notaNaoAtendida(nota) {
    return (nota.statusSistema || "").toUpperCase().includes("MSPN");
  }

  /** Realizadas = atendidas, Abertas = total de notas com Dt. referência = dia, Pendentes = não atendidas. */
  function statsCorretivasDia(setor, dataISO) {
    let total = 0, realizadas = 0, pendentes = 0;
    for (const n of DB.notas) {
      if (n.setor !== setor || n.dataEntrada !== dataISO) continue;
      total++;
      if (notaNaoAtendida(n)) pendentes++; else realizadas++;
    }
    return { total, realizadas, pendentes };
  }

  /** Nº de máquinas que passaram de 10h de parada e foram finalizadas neste dia. */
  function quebrasGravesDia(setor, dataISO) {
    let n = 0;
    for (const p of DB.dados.passagensTurno) {
      if (p.setor !== setor || p.status !== "finalizada" || !p.finalizadaEm) continue;
      if (formatarDataISO(new Date(p.finalizadaEm)) !== dataISO) continue;
      if (p.tempoParadoMinutos >= LIMITE_PARADA_MINUTOS) n++;
    }
    return n;
  }

  /** true = tem problema (vermelho) em Safety, Quality ou Cost neste dia. */
  function statusGeralDia(setor, dataISO) {
    const registro = DB.buscarRegistroQuadro(setor, dataISO);
    const problemaSQ = !!registro && (
      registro.acidente === true || registro.quaseAcidente === true ||
      registro.retrabalho === true || registro.falhaFornecedor === true
    );
    return problemaSQ || quebrasGravesDia(setor, dataISO) > 0;
  }

  function diasDoMes(ano, mes) {
    const total = new Date(ano, mes, 0).getDate();
    const dias = [];
    for (let d = 1; d <= total; d++) dias.push(`${ano}-${String(mes).padStart(2, "0")}-${String(d).padStart(2, "0")}`);
    return dias;
  }

  function mesAnterior(ano, mes) {
    return mes === 1 ? { ano: ano - 1, mes: 12 } : { ano, mes: mes - 1 };
  }

  // ---------- Render ----------

  function renderizar() {
    limparAlerta(alerta);
    sujo = false;
    const setor = setorAtual();
    if (!setor) { quadroEl.innerHTML = ""; return; }

    const diaSelecionado = seletorDia.value;
    const [anoStr, mesStr] = diaSelecionado.split("-");
    const ano = Number(anoStr), mes = Number(mesStr);
    if (!ano || !mes) { quadroEl.innerHTML = ""; return; }

    const dias = diasDoMes(ano, mes);
    const hojeReal = hojeISO();
    const nomeMes = new Date(ano, mes - 1, 1).toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
    const colunasDias = `grid-template-columns:repeat(${dias.length},1fr)`;
    const numerosDias = `<div class="quadro-dias-numeros" style="${colunasDias}">${dias.map((_, i) => `<span>${i + 1}</span>`).join("")}</div>`;
    const statusGeralClasse = statusGeralDia(setor, diaSelecionado) ? "ocorrencia" : "ok";

    quadroEl.innerHTML = `
      <div class="quadro-folha">
        <div class="quadro-folha-titulo">
          <h2>${escaparHtml(setor)}</h2>
          <div class="status-geral-titulo" title="Status Geral do dia selecionado — vermelho se houve ocorrência em Safety, Quality ou Cost.">
            <span class="status-geral-legenda">Status Geral (${formatarDataBR(diaSelecionado)})</span>
            <span class="status-geral-quadrado ${statusGeralClasse}"></span>
          </div>
          <span class="setor-mes">Válido em ${escaparHtml(nomeMes)}</span>
        </div>

        <div class="quadro-bloco" data-secao="S">
          <div class="quadro-rotulo"><span class="letra">S</span><span class="nome">Safety</span></div>
          <div class="quadro-conteudo">
            <div class="quadro-item" data-campo="acidente">
              <div class="item-titulo">Acidente com/sem afastamento</div>
              <div class="quadro-dias-scroll">${numerosDias}<div class="quadro-dias" style="grid-template-columns:repeat(${dias.length},1fr)"></div></div>
              <div class="item-legenda">Vermelho: ocorrência de acidente (com ou sem afastamento).</div>
            </div>
            <div class="quadro-item" data-campo="quaseAcidente">
              <div class="item-titulo">Quase acidentes</div>
              <div class="quadro-dias-scroll">${numerosDias}<div class="quadro-dias" style="grid-template-columns:repeat(${dias.length},1fr)"></div></div>
              <div class="item-legenda">Vermelho: ocorrência imprevista que não resultou em ferimento ou dano.</div>
            </div>
            <div class="quadro-nao-editavel-aviso">Marcação manual — clique no dia para alternar: em branco &rarr; sem ocorrência (verde) &rarr; ocorrência (vermelho). Não esqueça de "Salvar marcações".</div>
          </div>
        </div>

        <div class="quadro-bloco" data-secao="Q">
          <div class="quadro-rotulo"><span class="letra">Q</span><span class="nome">Quality</span></div>
          <div class="quadro-conteudo">
            <div class="quadro-item" data-campo="retrabalho">
              <div class="item-titulo">Retrabalho da corretiva</div>
              <div class="quadro-dias-scroll">${numerosDias}<div class="quadro-dias" style="grid-template-columns:repeat(${dias.length},1fr)"></div></div>
              <div class="item-legenda">Vermelho: falha, com o mesmo efeito, em até 2 semanas após a atuação.</div>
            </div>
            <div class="quadro-item" data-campo="falhaFornecedor">
              <div class="item-titulo">Falha fornecedor</div>
              <div class="quadro-dias-scroll">${numerosDias}<div class="quadro-dias" style="grid-template-columns:repeat(${dias.length},1fr)"></div></div>
              <div class="item-legenda">Vermelho: desvio em peça/componente novo dentro da garantia, ou atraso de fornecedor.</div>
            </div>
          </div>
        </div>

        <div class="quadro-bloco" data-secao="D">
          <div class="quadro-rotulo"><span class="letra">D</span><span class="nome">Delivery</span></div>
          <div class="quadro-conteudo">
            <div class="quadro-item">
              <div class="item-titulo">Controle de Corretivas Realizadas <span style="font-weight:400;color:var(--texto-suave);">(automático — bd/notas.json)</span></div>
              <div class="quadro-grafico"><canvas id="graficoD"></canvas></div>
              <div class="quadro-tabela-scroll"><div class="quadro-resumo" id="resumoD"></div></div>
              <div class="item-legenda">Vermelho: eficiência no atendimento de corretivas abaixo da meta. <span class="rodape-meta">Meta: ${QUADRO_META_EFICIENCIA}%</span></div>
            </div>
          </div>
        </div>

        <div class="quadro-bloco" data-secao="C">
          <div class="quadro-rotulo"><span class="letra">C</span><span class="nome">Cost</span></div>
          <div class="quadro-conteudo">
            <div class="quadro-item">
              <div class="item-titulo">Controle de Quebra Graves <span style="font-weight:400;color:var(--texto-suave);">(automático — passagens de turno finalizadas)</span></div>
              <div class="quadro-grafico"><canvas id="graficoC"></canvas></div>
              <div class="quadro-tabela-scroll"><div class="quadro-resumo" id="resumoC"></div></div>
              <div class="item-legenda">Vermelho: quebras com horas de parada acima da meta. <span class="rodape-meta">Meta: 10 horas</span></div>
            </div>
          </div>
        </div>
      </div>
    `;

    renderDiasEditaveis(setor, dias, hojeReal);
    renderTabelaD(setor, ano, mes, dias, diaSelecionado);
    renderTabelaC(setor, ano, mes, dias, diaSelecionado);
    renderTopProblemas(setor, diaSelecionado);
  }

  // ---------- S / Q: grades clicáveis ----------

  /**
   * Quem pode marcar S/Q deste setor: admin e gestor sempre (qualquer dia);
   * o responsável pela SFM do próprio setor só nos dias que a reunião de
   * hoje cobre (calcularJanelaSfm, de util.js) — normalmente só ontem, ou
   * sexta+sábado+domingo numa segunda-feira.
   */
  function podeEditarSecaoSQ(setor) {
    if (usuario.papel === "admin" || usuario.papel === "gestor") return true;
    return usuario.papel === "operador" && usuario.setor === setor && usuario.responsavelSfm === true;
  }

  function diaEditavel(setor, dataISO, hoje) {
    if (dataISO > hoje) return false;
    if (!podeEditarSecaoSQ(setor)) return false;
    if (usuario.papel !== "operador") return true;
    const janela = calcularJanelaSfm() || [];
    return janela.includes(dataISO);
  }

  function renderDiasEditaveis(setor, dias, hoje) {
    const podeEditar = podeEditarSecaoSQ(setor);
    if (!podeEditar) {
      const aviso = quadroEl.querySelector(".quadro-nao-editavel-aviso");
      if (aviso) aviso.textContent = "Somente leitura — só o responsável pela SFM deste setor (ou gestor/admin) pode marcar S/Q.";
    } else if (usuario.papel === "operador") {
      const aviso = quadroEl.querySelector(".quadro-nao-editavel-aviso");
      if (aviso) aviso.textContent = "Marcação manual, liberada só para o(s) dia(s) da reunião de hoje — clique no dia para alternar: em branco → sem ocorrência (verde) → ocorrência (vermelho). Não esqueça de \"Salvar marcações\".";
    }

    for (const item of quadroEl.querySelectorAll(".quadro-item[data-campo]")) {
      const campo = item.dataset.campo;
      const grid = item.querySelector(".quadro-dias");
      grid.innerHTML = dias.map((dataISO, i) => {
        const dia = i + 1;
        const editavel = diaEditavel(setor, dataISO, hoje);
        const registro = DB.buscarRegistroQuadro(setor, dataISO);
        const valor = registro ? registro[campo] : undefined;
        const classe = valor === true ? "ocorrencia" : valor === false ? "ok" : "";
        return `<button type="button" class="quadro-cel ${classe}" data-dia="${dia}" data-data="${dataISO}" title="Dia ${dia}" ${editavel ? "" : "disabled"}></button>`;
      }).join("");

      grid.addEventListener("click", (ev) => {
        const cel = ev.target.closest(".quadro-cel");
        if (!cel || cel.disabled) return;
        const dataISO = cel.dataset.data;
        const registro = DB.buscarRegistroQuadro(setor, dataISO);
        const atual = registro ? registro[campo] : undefined;
        const proximo = atual === undefined ? false : atual === false ? true : null;
        DB.definirRegistroQuadro(setor, dataISO, campo, proximo);
        cel.className = "quadro-cel " + (proximo === true ? "ocorrencia" : proximo === false ? "ok" : "");
        sujo = true;
      });
    }
  }

  // ---------- D: tabela + gráfico ----------

  function renderTabelaD(setor, ano, mes, dias, diaCorte) {
    const idxCorte = dias.indexOf(diaCorte);
    const porDia = dias.map((d, i) => (i > idxCorte ? null : statsCorretivasDia(setor, d)));
    const anterior = mesAnterior(ano, mes);
    const diasAnt = diasDoMes(anterior.ano, anterior.mes);
    const acAntPorDia = diasAnt.map((d) => statsCorretivasDia(setor, d));
    const acAnt = acAntPorDia.reduce((acc, s) => ({
      total: acc.total + s.total, realizadas: acc.realizadas + s.realizadas, pendentes: acc.pendentes + s.pendentes,
    }), { total: 0, realizadas: 0, pendentes: 0 });

    const totalMes = porDia.reduce((acc, s) => s ? {
      total: acc.total + s.total, realizadas: acc.realizadas + s.realizadas, pendentes: acc.pendentes + s.pendentes,
    } : acc, { total: 0, realizadas: 0, pendentes: 0 });

    const efPorDia = porDia.map((s) => s && s.total > 0 ? Math.round((s.realizadas / s.total) * 100) : null);
    const efAcAnt = acAnt.total > 0 ? Math.round((acAnt.realizadas / acAnt.total) * 100) : null;
    const efAcAtu = totalMes.total > 0 ? Math.round((totalMes.realizadas / totalMes.total) * 100) : null;

    const colunas = `grid-template-columns:repeat(${dias.length},1fr)`;
    const resumo = document.getElementById("resumoD");
    resumo.innerHTML = `
      <div class="resumo-linha resumo-cabecalho">
        <span class="resumo-rotulo">Dias</span>
        <span class="resumo-ac" title="Ac. Mês Ant.">Ac.Ant.</span>
        <div class="resumo-dias-grid" style="${colunas}">${dias.map((_, i) => `<span>${i + 1}</span>`).join("")}</div>
        <span class="resumo-ac" title="Ac. Mês Atu.">Ac.Atu.</span>
      </div>
      <div class="resumo-linha">
        <span class="resumo-rotulo">% Eficiência</span>
        <span class="resumo-ac">${efAcAnt ?? "—"}</span>
        <div class="resumo-dias-grid" style="${colunas}">${efPorDia.map((v) => `<span class="${v !== null && v < QUADRO_META_EFICIENCIA ? "abaixo-meta" : ""}">${v ?? ""}</span>`).join("")}</div>
        <span class="resumo-ac">${efAcAtu ?? "—"}</span>
      </div>
      <div class="resumo-linha">
        <span class="resumo-rotulo">Nº de notas Realizadas</span>
        <span class="resumo-ac">${acAnt.realizadas}</span>
        <div class="resumo-dias-grid" style="${colunas}">${porDia.map((s) => `<span>${s && s.total > 0 ? s.realizadas : ""}</span>`).join("")}</div>
        <span class="resumo-ac">${totalMes.realizadas}</span>
      </div>
      <div class="resumo-linha">
        <span class="resumo-rotulo">Nº de notas Abertas</span>
        <span class="resumo-ac">${acAnt.total}</span>
        <div class="resumo-dias-grid" style="${colunas}">${porDia.map((s) => `<span>${s && s.total > 0 ? s.total : ""}</span>`).join("")}</div>
        <span class="resumo-ac">${totalMes.total}</span>
      </div>
      <div class="resumo-linha">
        <span class="resumo-rotulo">Nº de notas Pendentes</span>
        <span class="resumo-ac">${acAnt.pendentes}</span>
        <div class="resumo-dias-grid" style="${colunas}">${porDia.map((s) => `<span>${s && s.total > 0 ? s.pendentes : ""}</span>`).join("")}</div>
        <span class="resumo-ac">${totalMes.pendentes}</span>
      </div>
    `;

    const ctx = document.getElementById("graficoD");
    if (graficoD) graficoD.destroy();
    graficoD = new Chart(ctx, {
      type: "line",
      data: {
        labels: dias.map((_, i) => i + 1),
        datasets: [
          { label: "% Eficiência", data: efPorDia, borderColor: "#173A5E", backgroundColor: "#173A5E", spanGaps: true },
          { label: `Meta (${QUADRO_META_EFICIENCIA}%)`, data: dias.map(() => QUADRO_META_EFICIENCIA), borderColor: "#B3402A", borderDash: [6, 4], pointRadius: 0 },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        scales: { y: { min: 0, max: 100, ticks: { callback: (v) => v + "%" } } },
      },
    });
  }

  // ---------- C: tabela + gráfico ----------

  function renderTabelaC(setor, ano, mes, dias, diaCorte) {
    const diarioPorDia = dias.map((d) => quebrasGravesDia(setor, d));
    let acumulado = 0;
    const acumuladoPorDia = diarioPorDia.map((n) => (acumulado += n));

    const anterior = mesAnterior(ano, mes);
    const diasAnt = diasDoMes(anterior.ano, anterior.mes);
    const acAnt = diasAnt.reduce((soma, d) => soma + quebrasGravesDia(setor, d), 0);
    const idxCorte = dias.indexOf(diaCorte);
    const acAtu = idxCorte >= 0 ? acumuladoPorDia[idxCorte] : 0;

    const colunas = `grid-template-columns:repeat(${dias.length},1fr)`;
    const resumo = document.getElementById("resumoC");
    resumo.innerHTML = `
      <div class="resumo-linha resumo-cabecalho">
        <span class="resumo-rotulo">Dias</span>
        <span class="resumo-ac" title="Ac. Mês Ant.">Ac.Ant.</span>
        <div class="resumo-dias-grid" style="${colunas}">${dias.map((_, i) => `<span>${i + 1}</span>`).join("")}</div>
        <span class="resumo-ac" title="Ac. Mês Atu.">Ac.Atu.</span>
      </div>
      <div class="resumo-linha">
        <span class="resumo-rotulo">Quebras graves acumuladas</span>
        <span class="resumo-ac">${acAnt}</span>
        <div class="resumo-dias-grid" style="${colunas}">${acumuladoPorDia.map((v, i) => `<span>${dias[i] > diaCorte ? "" : v}</span>`).join("")}</div>
        <span class="resumo-ac">${acAtu}</span>
      </div>
      <div class="resumo-linha">
        <span class="resumo-rotulo">Quebras graves diário</span>
        <span class="resumo-ac">—</span>
        <div class="resumo-dias-grid" style="${colunas}">${diarioPorDia.map((v, i) => {
          if (dias[i] > diaCorte) return `<span></span>`;
          return `<span class="${v > 0 ? "dia-ocorrencia" : "dia-ok"}">${v || ""}</span>`;
        }).join("")}</div>
        <span class="resumo-ac">${diarioPorDia.slice(0, idxCorte + 1).reduce((a, b) => a + b, 0)}</span>
      </div>
    `;

    const diarioPorDiaGrafico = diarioPorDia.map((v, i) => (i > idxCorte ? null : v));
    const ctx = document.getElementById("graficoC");
    if (graficoC) graficoC.destroy();
    graficoC = new Chart(ctx, {
      type: "line",
      data: {
        labels: dias.map((_, i) => i + 1),
        datasets: [{ label: "Quebras graves (dia)", data: diarioPorDiaGrafico, borderColor: "#B3402A", backgroundColor: "#B3402A" }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        scales: { y: { beginAtZero: true, ticks: { precision: 0 } } },
      },
    });
  }

  // ---------- Top problemas: máquinas com >=10h de parada, finalizadas no dia selecionado do setor atual ----------

  function renderTopProblemas(setor, diaSelecionado) {
    const problemas = DB.dados.passagensTurno.filter((p) =>
      p.setor === setor &&
      p.status === "finalizada" &&
      p.tempoParadoMinutos >= LIMITE_PARADA_MINUTOS &&
      p.finalizadaEm && formatarDataISO(new Date(p.finalizadaEm)) === diaSelecionado
    ).sort((a, b) => b.tempoParadoMinutos - a.tempoParadoMinutos);

    const corpo = document.getElementById("corpoTopProblemas");
    corpo.innerHTML = problemas.length
      ? problemas.map((p) => {
          const nota = DB.buscarNota(p.nota);
          return `<tr>
            <td>${escaparHtml(nota?.equipamento || "—")}</td>
            <td>${escaparHtml(p.descricao)}</td>
            <td><strong>${formatarDuracaoMinutos(p.tempoParadoMinutos)}</strong></td>
            <td>${new Date(p.finalizadaEm).toLocaleString("pt-BR")}</td>
          </tr>`;
        }).join("")
      : `<tr><td colspan="4" style="text-align:center;color:var(--texto-suave);">Nenhuma máquina passou de 10h parada neste dia.</td></tr>`;

    renderTop3Impressao(setor, diaSelecionado, problemas);
  }

  /** Folha 2 da impressão (#folhaTop3, ver quadro-sfm.html): só os 3 piores do dia, já que é pra caber numa folha só. */
  function renderTop3Impressao(setor, diaSelecionado, problemas) {
    document.getElementById("top3SetorMes").textContent = `${setor} — ${formatarDataBR(diaSelecionado)}`;
    const top3 = problemas.slice(0, 3);
    const corpo = document.getElementById("corpoTop3Impressao");
    corpo.innerHTML = top3.length
      ? top3.map((p, i) => {
          const nota = DB.buscarNota(p.nota);
          return `<tr>
            <td>${i + 1}</td>
            <td>${escaparHtml(nota?.equipamento || "—")}</td>
            <td>${escaparHtml(p.descricao)}</td>
            <td><strong>${formatarDuracaoMinutos(p.tempoParadoMinutos)}</strong></td>
            <td>${new Date(p.finalizadaEm).toLocaleString("pt-BR")}</td>
          </tr>`;
        }).join("")
      : `<tr><td colspan="5" style="text-align:center;color:var(--texto-suave);">Nenhuma máquina passou de 10h parada neste dia.</td></tr>`;
  }

  window.addEventListener("beforeunload", (ev) => {
    if (sujo) { ev.preventDefault(); ev.returnValue = ""; }
  });

  renderizar();
})();
