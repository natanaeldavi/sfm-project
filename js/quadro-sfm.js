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
 *    de turno finalizadas em bd/dados.json — mesma lógica já usada em
 *    sfm.html (ver README, seção "Atendidas/Não atendidas" e "Mais de 10h
 *    parada").
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
  const seletorMes = document.getElementById("seletorMes");
  const btnHoje = document.getElementById("btnHoje");
  const btnSalvar = document.getElementById("btnSalvar");
  const btnImprimir = document.getElementById("btnImprimir");
  const quadroEl = document.getElementById("quadro");

  let graficoD = null;
  let graficoC = null;
  let sujo = false; // há marcações de S/Q ainda não salvas

  function mesAtualStr() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  }

  // ---------- Setor ----------
  if (usuario.papel === "operador") {
    campoSetor.hidden = true;
  } else {
    seletorSetor.innerHTML = SETORES.map((s) => `<option value="${s}">${s}</option>`).join("");
    seletorSetor.value = SETORES.includes(Auth.getSetorAtivo()) ? Auth.getSetorAtivo() : SETORES[0];
    seletorSetor.addEventListener("change", () => { avisarSeSujo(); Auth.setSetorAtivo(seletorSetor.value); renderizar(); });
  }

  function setorAtual() {
    return usuario.papel === "operador" ? usuario.setor : seletorSetor.value;
  }

  seletorMes.value = mesAtualStr();
  seletorMes.addEventListener("change", () => { avisarSeSujo(); renderizar(); });
  btnHoje.addEventListener("click", () => { avisarSeSujo(); seletorMes.value = mesAtualStr(); renderizar(); });
  btnImprimir.addEventListener("click", () => window.print());

  function avisarSeSujo() {
    if (sujo) mostrarAlerta(alerta, "aviso", "Havia marcações não salvas que foram descartadas ao trocar de setor/mês.");
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

    const [anoStr, mesStr] = seletorMes.value.split("-");
    const ano = Number(anoStr), mes = Number(mesStr);
    if (!ano || !mes) { quadroEl.innerHTML = ""; return; }

    const dias = diasDoMes(ano, mes);
    const hoje = hojeISO();
    const nomeMes = new Date(ano, mes - 1, 1).toLocaleDateString("pt-BR", { month: "long", year: "numeric" });

    quadroEl.innerHTML = `
      <div class="quadro-folha">
        <div class="quadro-folha-titulo">
          <h2>${escaparHtml(setor)}</h2>
          <span class="setor-mes">Válido em ${escaparHtml(nomeMes)}</span>
        </div>

        <div class="quadro-bloco" data-secao="S">
          <div class="quadro-rotulo"><span class="letra">S</span><span class="nome">Safety</span></div>
          <div class="quadro-conteudo">
            <div class="quadro-item" data-campo="acidente">
              <div class="item-titulo">Acidente com/sem afastamento</div>
              <div class="quadro-dias-scroll"><div class="quadro-dias" style="grid-template-columns:repeat(${dias.length},1fr)"></div></div>
              <div class="item-legenda">Vermelho: ocorrência de acidente (com ou sem afastamento).</div>
            </div>
            <div class="quadro-item" data-campo="quaseAcidente">
              <div class="item-titulo">Quase acidentes</div>
              <div class="quadro-dias-scroll"><div class="quadro-dias" style="grid-template-columns:repeat(${dias.length},1fr)"></div></div>
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
              <div class="quadro-dias-scroll"><div class="quadro-dias" style="grid-template-columns:repeat(${dias.length},1fr)"></div></div>
              <div class="item-legenda">Vermelho: falha, com o mesmo efeito, em até 2 semanas após a atuação.</div>
            </div>
            <div class="quadro-item" data-campo="falhaFornecedor">
              <div class="item-titulo">Falha fornecedor</div>
              <div class="quadro-dias-scroll"><div class="quadro-dias" style="grid-template-columns:repeat(${dias.length},1fr)"></div></div>
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
              <div class="quadro-tabela-scroll"><table class="quadro-tabela" id="tabelaD"></table></div>
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
              <div class="quadro-tabela-scroll"><table class="quadro-tabela" id="tabelaC"></table></div>
              <div class="item-legenda">Vermelho: quebras com horas de parada acima da meta. <span class="rodape-meta">Meta: 10 horas</span></div>
            </div>
          </div>
        </div>
      </div>
    `;

    renderDiasEditaveis(setor, dias, hoje);
    renderTabelaD(setor, ano, mes, dias);
    renderTabelaC(setor, ano, mes, dias);
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

  function renderTabelaD(setor, ano, mes, dias) {
    const porDia = dias.map((d) => statsCorretivasDia(setor, d));
    const anterior = mesAnterior(ano, mes);
    const diasAnt = diasDoMes(anterior.ano, anterior.mes);
    const acAntPorDia = diasAnt.map((d) => statsCorretivasDia(setor, d));
    const acAnt = acAntPorDia.reduce((acc, s) => ({
      total: acc.total + s.total, realizadas: acc.realizadas + s.realizadas, pendentes: acc.pendentes + s.pendentes,
    }), { total: 0, realizadas: 0, pendentes: 0 });

    const totalMes = porDia.reduce((acc, s) => ({
      total: acc.total + s.total, realizadas: acc.realizadas + s.realizadas, pendentes: acc.pendentes + s.pendentes,
    }), { total: 0, realizadas: 0, pendentes: 0 });

    const efPorDia = porDia.map((s) => s.total > 0 ? Math.round((s.realizadas / s.total) * 100) : null);
    const efAcAnt = acAnt.total > 0 ? Math.round((acAnt.realizadas / acAnt.total) * 100) : null;
    const efAcAtu = totalMes.total > 0 ? Math.round((totalMes.realizadas / totalMes.total) * 100) : null;

    const tabela = document.getElementById("tabelaD");
    tabela.innerHTML = `
      <thead>
        <tr><th class="rotulo-linha">Dias</th><th>Ac. Mês Ant.</th>${dias.map((_, i) => `<th>${i + 1}</th>`).join("")}<th>Ac. Mês Atu.</th></tr>
      </thead>
      <tbody>
        <tr>
          <td class="rotulo-linha">% Eficiência</td>
          <td class="ac">${efAcAnt ?? "—"}</td>
          ${efPorDia.map((v) => `<td class="${v !== null && v < QUADRO_META_EFICIENCIA ? "abaixo-meta" : ""}">${v ?? ""}</td>`).join("")}
          <td class="ac">${efAcAtu ?? "—"}</td>
        </tr>
        <tr>
          <td class="rotulo-linha">Nº de notas Realizadas</td>
          <td class="ac">${acAnt.realizadas}</td>
          ${porDia.map((s) => `<td>${s.total > 0 ? s.realizadas : ""}</td>`).join("")}
          <td class="ac">${totalMes.realizadas}</td>
        </tr>
        <tr>
          <td class="rotulo-linha">Nº de notas Abertas</td>
          <td class="ac">${acAnt.total}</td>
          ${porDia.map((s) => `<td>${s.total > 0 ? s.total : ""}</td>`).join("")}
          <td class="ac">${totalMes.total}</td>
        </tr>
        <tr>
          <td class="rotulo-linha">Nº de notas Pendentes</td>
          <td class="ac">${acAnt.pendentes}</td>
          ${porDia.map((s) => `<td>${s.total > 0 ? s.pendentes : ""}</td>`).join("")}
          <td class="ac">${totalMes.pendentes}</td>
        </tr>
      </tbody>
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

  function renderTabelaC(setor, ano, mes, dias) {
    const diarioPorDia = dias.map((d) => quebrasGravesDia(setor, d));
    let acumulado = 0;
    const acumuladoPorDia = diarioPorDia.map((n) => (acumulado += n));

    const anterior = mesAnterior(ano, mes);
    const diasAnt = diasDoMes(anterior.ano, anterior.mes);
    const acAnt = diasAnt.reduce((soma, d) => soma + quebrasGravesDia(setor, d), 0);
    const acAtu = acumuladoPorDia.length ? acumuladoPorDia[acumuladoPorDia.length - 1] : 0;

    const tabela = document.getElementById("tabelaC");
    tabela.innerHTML = `
      <thead>
        <tr><th class="rotulo-linha">Dias</th><th>Ac. Mês Ant.</th>${dias.map((_, i) => `<th>${i + 1}</th>`).join("")}<th>Ac. Mês Atu.</th></tr>
      </thead>
      <tbody>
        <tr>
          <td class="rotulo-linha">Quebras graves acumuladas</td>
          <td class="ac">${acAnt}</td>
          ${acumuladoPorDia.map((v) => `<td>${v}</td>`).join("")}
          <td class="ac">${acAtu}</td>
        </tr>
        <tr>
          <td class="rotulo-linha">Quebras graves diário</td>
          <td class="ac">—</td>
          ${diarioPorDia.map((v) => `<td class="${v > 0 ? "abaixo-meta" : ""}">${v || ""}</td>`).join("")}
          <td class="ac">${diarioPorDia.reduce((a, b) => a + b, 0)}</td>
        </tr>
      </tbody>
    `;

    const ctx = document.getElementById("graficoC");
    if (graficoC) graficoC.destroy();
    graficoC = new Chart(ctx, {
      type: "line",
      data: {
        labels: dias.map((_, i) => i + 1),
        datasets: [{ label: "Quebras graves (dia)", data: diarioPorDia, borderColor: "#B3402A", backgroundColor: "#B3402A" }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        scales: { y: { beginAtZero: true, ticks: { precision: 0 } } },
      },
    });
  }

  window.addEventListener("beforeunload", (ev) => {
    if (sujo) { ev.preventDefault(); ev.returnValue = ""; }
  });

  renderizar();
})();
