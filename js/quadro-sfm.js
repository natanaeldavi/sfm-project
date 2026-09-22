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

/**
 * Itens do assistente por etapas de preenchimento da SFM (turno Manhã) —
 * mesma ordem/rótulos da grade S/Q. Quando a resposta é "Sim", o
 * assistente pede Defeito/Máquina/Célula/Descrição (mesmos campos do
 * cadastro manual de Passar Turno) antes de avançar.
 */
const WIZARD_CAMPOS = [
  { campo: "acidente", pergunta: "Houve acidente com ou sem afastamento?", legenda: "Considere qualquer acidente, com ou sem afastamento, ocorrido no setor." },
  { campo: "quaseAcidente", pergunta: "Houve quase acidente?", legenda: "Ocorrência imprevista que não resultou em ferimento ou dano, mas poderia ter resultado." },
  { campo: "retrabalho", pergunta: "Houve retrabalho de corretiva?", legenda: "Falha, com o mesmo efeito, em até 2 semanas após a atuação." },
  { campo: "falhaFornecedor", pergunta: "Houve falha de fornecedor?", legenda: "Desvio em peça/componente novo dentro da garantia, ou atraso de fornecedor." },
];

// ---------- Importação da planilha do SAP (versão piloto: uma vez por dia, na SFM) ----------

const MAPA_CABECALHOS_SAP = {
  ordem: "ordem",
  nota: "nota",
  statussistema: "statusSistema",
  statususuario: "statusUsuario",
  tipodeordem: "tipoOrdem",
  centrabrespon: "centrab",
  equipamento: "equipamento",
  locinstalacao: "loc",
  textobreve: "textoBreve",
  descricao: "textoBreve", // export real do SAP usa "Descrição" no lugar de "Texto breve"
  databaseinic: "dataInicio",
  databasefim: "dataFim",
  centrocusto: "centroCusto",
  criadopor: "criadoPor",
  // data de referência (usada como data-base pro D do quadro SQDC) — nomes
  // exatos mais comuns, incluindo a abreviação real do SAP ("Dt." em vez
  // de "Data"); outras variações são pegas por palavras-chave em
  // encontrarColunaPorPalavras().
  datareferencia: "dataReferencia",
  dtreferencia: "dataReferencia",
  datadeentrada: "dataDeEntradaLegado",
  // "Data da nota"/"Hora da nota": data/hora real de abertura da nota no
  // SAP — usadas com prioridade (ver importarPlanilhaSap), já que
  // "Dt.referência" muda depois que a nota é criada.
  datadanota: "dataDaNota",
  horadanota: "horaDaNota",
};

/**
 * Acha o índice de uma coluna pelo cabeçalho conter todas as palavras
 * informadas (em qualquer ordem) — mais resistente a variações reais de
 * nome de coluna do SAP (ex.: "Hora início avaria" vs "Horário início da
 * avaria") do que tentar prever cada combinação exata de antemão.
 * `usados` é um Set de índices já atribuídos a outro campo, para não
 * mapear a mesma coluna pra dois campos diferentes.
 */
function encontrarColunaPorPalavras(cabecalhosNormalizados, palavras, usados) {
  for (let i = 0; i < cabecalhosNormalizados.length; i++) {
    if (usados && usados.has(i)) continue;
    const h = cabecalhosNormalizados[i];
    if (h && palavras.every((p) => h.includes(p))) return i;
  }
  return undefined;
}

/**
 * Palavras-chave de reforço por campo, usadas só quando o nome exato do
 * cabeçalho (MAPA_CABECALHOS_SAP) não bate com nada — cobre variações reais
 * de export do SAP (abreviação diferente, ponto a mais, "de" a menos etc.)
 * sem exigir prever cada nome exato de antemão. Cada combinação usa 2
 * palavras (quando possível) pra evitar que uma coluna errada seja pega por
 * engano (ex.: "tipo de ordem" não deve satisfazer o campo "ordem").
 */
const PALAVRAS_FALLBACK_SAP = {
  statusSistema: ["status", "sistema"],
  statusUsuario: ["status", "usuario"],
  tipoOrdem: ["tipo", "ordem"],
  centrab: ["centrab"],
  loc: ["instalacao"],
  textoBreve: ["texto", "breve"],
  dataInicio: ["data", "inic"],
  dataFim: ["data", "fim"],
  centroCusto: ["centro", "custo"],
  criadoPor: ["criado", "por"],
  dataReferencia: ["referencia"],
  dataDeEntradaLegado: ["data", "entrada"],
  // "avar" (não "avaria" por extenso) casa tanto com a abreviação real do
  // SAP ("HoraInícioAvar.") quanto com o nome por extenso ("Hora início
  // da avaria"), já que "avar" é prefixo de "avaria".
  horaInicioAvaria: ["inicio", "avar"],
};

function normalizarCabecalho(texto) {
  return (texto || "")
    .toString()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function strOuNull(v) {
  if (v === null || v === undefined) return null;
  const s = v.toString().trim();
  return s === "" ? null : s;
}

/**
 * Lê o ArrayBuffer da planilha do SAP e retorna { notas, cabecalhosLidos,
 * camposReconhecidos }. `notas` já vem classificada e deduplicada por
 * Nota; os outros dois campos servem só de diagnóstico (pra mostrar na
 * tela o que foi encontrado, se algo não bater).
 */
function importarPlanilhaSap(arrayBuffer) {
  const wb = XLSX.read(arrayBuffer, { type: "array", cellDates: true });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const linhas = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null });
  if (linhas.length < 2) return { notas: [], cabecalhosLidos: [], camposReconhecidos: [] };

  const cabecalhosLidos = linhas[0].map((c) => (c === null ? "" : c.toString().trim())).filter(Boolean);

  const cabecalhosNormalizados = linhas[0].map(normalizarCabecalho);

  const indices = {};
  cabecalhosNormalizados.forEach((norm, i) => {
    if (MAPA_CABECALHOS_SAP[norm] && indices[MAPA_CABECALHOS_SAP[norm]] === undefined) {
      indices[MAPA_CABECALHOS_SAP[norm]] = i;
    }
  });

  // Reforço por palavras-chave para qualquer campo cujo nome exato do
  // cabeçalho não bateu com o dicionário acima — cobre variações reais de
  // export do SAP (abreviação diferente, ponto a mais, "de" a menos etc.).
  // Cada coluna só pode ser usada por um campo (evita, por exemplo, que
  // "Tipo de ordem" seja reaproveitada pro campo "Ordem").
  const usados = new Set(Object.values(indices));
  for (const campo of Object.keys(PALAVRAS_FALLBACK_SAP)) {
    if (indices[campo] !== undefined) continue;
    const achado = encontrarColunaPorPalavras(cabecalhosNormalizados, PALAVRAS_FALLBACK_SAP[campo], usados);
    if (achado !== undefined) {
      indices[campo] = achado;
      usados.add(achado);
    }
  }

  if (indices.nota === undefined) {
    throw new Error('Não encontrei a coluna "Nota" na planilha. Confira se é o arquivo certo exportado do SAP.');
  }

  const extrair = (linha, campo) => {
    const idx = indices[campo];
    if (idx === undefined) return null;
    return linha[idx] === undefined ? null : linha[idx];
  };

  const mapaNotas = new Map();
  for (let i = 1; i < linhas.length; i++) {
    const linha = linhas[i];
    if (!linha || linha.every((c) => c === null || c === "")) continue;

    const numNota = strOuNull(extrair(linha, "nota"));
    if (!numNota) continue;

    // Data de referência: usa "Data da nota" como data de abertura real da
    // nota — "Dt.referência" muda depois que a nota é criada (ex.: quando a
    // ordem é de fato gerada/tratada), então sub-contava o dia real de
    // abertura no D do quadro SQDC. "Dt.referência"/"Data de entrada" só
    // entram como alternativa em planilhas antigas que não tenham "Data da
    // nota".
    const dataRefBruta = extrair(linha, "dataDaNota") ?? extrair(linha, "dataReferencia") ?? extrair(linha, "dataDeEntradaLegado");
    // Horário: acompanha a mesma coluna usada acima como data ("Hora da
    // nota" junto de "Data da nota") — "Hora início avaria" só entra como
    // alternativa se a planilha não tiver "Hora da nota".
    const horaBruta = extrair(linha, "horaDaNota") ?? extrair(linha, "horaInicioAvaria");

    const nota = {
      nota: numNota,
      ordem: strOuNull(extrair(linha, "ordem")),
      statusSistema: strOuNull(extrair(linha, "statusSistema")),
      statusUsuario: strOuNull(extrair(linha, "statusUsuario")),
      tipoOrdem: strOuNull(extrair(linha, "tipoOrdem")),
      centrab: strOuNull(extrair(linha, "centrab")),
      equipamento: strOuNull(extrair(linha, "equipamento")),
      loc: strOuNull(extrair(linha, "loc")),
      textoBreve: strOuNull(extrair(linha, "textoBreve")),
      dataInicio: paraDataISO(extrair(linha, "dataInicio")),
      dataFim: paraDataISO(extrair(linha, "dataFim")),
      centroCusto: strOuNull(extrair(linha, "centroCusto")),
      criadoPor: strOuNull(extrair(linha, "criadoPor")),
      dataEntrada: paraDataISO(dataRefBruta),
      horaEntrada: horaBruta ? extrairHoraDeData(horaBruta) : extrairHoraDeData(dataRefBruta),
      atualizadoEm: new Date().toISOString(),
    };
    nota.setor = classificarSetor(nota.loc);
    mapaNotas.set(nota.nota, nota);
  }

  return {
    notas: Array.from(mapaNotas.values()),
    cabecalhosLidos,
    camposReconhecidos: Object.keys(indices).filter((k) => indices[k] !== undefined),
  };
}

(async function () {
  const usuario = Auth.exigirLogin();
  if (!usuario) return;
  Auth.garantirSetorOperador(usuario);

  await DB.carregarAutoLoad();
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

  const inputXlsx = document.getElementById("inputXlsx");
  const resumoImportacao = document.getElementById("resumoImportacao");

  const cardFiltros = document.getElementById("cardFiltros");
  const cardComoAlimentar = document.getElementById("cardComoAlimentar");
  const cardTopProblemas = document.getElementById("cardTopProblemas");

  const cardWizardPrompt = document.getElementById("cardWizardPrompt");
  const wizardPromptTexto = document.getElementById("wizardPromptTexto");
  const btnIniciarWizard = document.getElementById("btnIniciarWizard");
  const btnAdiarWizard = document.getElementById("btnAdiarWizard");
  const cardWizard = document.getElementById("cardWizard");
  const wizardTitulo = document.getElementById("wizardTitulo");
  const wizardProgresso = document.getElementById("wizardProgresso");
  const wizardPergunta = document.getElementById("wizardPergunta");
  const wizardLegenda = document.getElementById("wizardLegenda");
  const wizardBotoesSimNao = document.getElementById("wizardBotoesSimNao");
  const wizardBtnNao = document.getElementById("wizardBtnNao");
  const wizardBtnSim = document.getElementById("wizardBtnSim");
  const wizardDetalhe = document.getElementById("wizardDetalhe");
  const wizardDefeito = document.getElementById("wizardDefeito");
  const wizardMaquina = document.getElementById("wizardMaquina");
  const wizardCelula = document.getElementById("wizardCelula");
  const wizardDescricao = document.getElementById("wizardDescricao");
  const wizardMsgDetalhe = document.getElementById("wizardMsgDetalhe");
  const wizardBtnConfirmarDetalhe = document.getElementById("wizardBtnConfirmarDetalhe");
  const wizardBtnVoltar = document.getElementById("wizardBtnVoltar");

  let graficoD = null;
  let graficoC = null;
  let sujo = false; // há marcações de S/Q ainda não salvas

  // ---------- Importar planilha do SAP (uma vez por dia, na SFM) ----------

  inputXlsx.addEventListener("change", async () => {
    const file = inputXlsx.files[0];
    if (!file) return;
    try {
      const buffer = await file.arrayBuffer();
      const { notas: notasImportadas, cabecalhosLidos, camposReconhecidos } = importarPlanilhaSap(buffer);
      const { inseridas, atualizadas } = DB.mesclarNotasImportadas(notasImportadas);

      resumoImportacao.hidden = false;
      let aviso = `<div class="alerta ok">Planilha lida: ${notasImportadas.length} notas encontradas — ${inseridas} novas gravadas, ${atualizadas} já existiam e foram atualizadas (nunca duplica, é sempre uma linha por nota).</div>`;

      const dataReconhecida = camposReconhecidos.includes("dataReferencia") || camposReconhecidos.includes("dataDeEntradaLegado") || camposReconhecidos.includes("dataDaNota");
      const semDataEntrada = notasImportadas.filter((n) => !n.dataEntrada).length;
      if (notasImportadas.length > 0 && !dataReconhecida) {
        aviso += `<div class="alerta erro"><strong>A coluna de data de referência não foi encontrada na planilha.</strong> Sem ela, o D (Controle de Corretivas Realizadas) do quadro SQDC não mostra nenhuma ordem, percentual ou informação — ele filtra tudo por essa data. Abra o diagnóstico abaixo, veja a lista de "Colunas encontradas na planilha" e confira se alguma delas é a data de referência (ex.: "Data referência", "Data de referência" ou "Data de entrada"); se o nome for diferente do esperado, avise para ajustar o reconhecimento e reimporte a planilha (reimportar corrige as notas já gravadas, sem duplicar).</div>`;
      } else if (notasImportadas.length > 0 && semDataEntrada > 0) {
        aviso += `<div class="alerta aviso">${semDataEntrada} de ${notasImportadas.length} notas vieram sem data de referência preenchida na própria célula — essas não vão aparecer no D do quadro SQDC (as demais aparecem normalmente).</div>`;
      }
      const horaReconhecida = camposReconhecidos.includes("horaInicioAvaria") || camposReconhecidos.includes("horaDaNota");
      const semHora = notasImportadas.filter((n) => !n.horaEntrada).length;
      if (notasImportadas.length > 0 && !horaReconhecida && semHora === notasImportadas.length) {
        aviso += `<div class="alerta aviso">Nenhuma nota veio com horário — confira se a coluna "Hora início avaria" foi reconhecida (cabeçalhos abaixo).</div>`;
      }

      aviso += `<details style="margin-top:8px;font-size:12px;color:var(--texto-suave);" ${dataReconhecida ? "" : "open"}>
        <summary style="cursor:pointer;">Ver cabeçalhos lidos da planilha (diagnóstico)</summary>
        <p><strong>Colunas encontradas na planilha:</strong> ${escaparHtml(cabecalhosLidos.join(" | "))}</p>
        <p><strong>Campos reconhecidos pelo sistema:</strong> ${camposReconhecidos.length ? escaparHtml(camposReconhecidos.join(", ")) : "nenhum"}</p>
      </details>`;

      resumoImportacao.innerHTML = aviso;

      const salvou = await DbUI.salvarNotas(alerta);
      if (salvou) renderizar();
    } catch (e) {
      resumoImportacao.hidden = false;
      resumoImportacao.innerHTML = `<div class="alerta erro">Erro ao ler a planilha: ${escaparHtml(e.message)}</div>`;
    }
  });

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

  // ---------- Assistente por etapas de preenchimento da SFM (turno Manhã) ----------

  let wizardDias = [];
  let wizardIndice = 0;
  let wizardRespostas = {}; // chave "dataISO|campo" -> { valor: true/false, detalhe: {defeito,maquina,celula,descricao}|null }

  /** Só o turno Manhã do setor preenche a SFM pelo assistente, um dia sem reunião (sáb/dom) não tem o que preencher. */
  function elegivelParaWizardHoje() {
    return usuario.papel === "operador" && usuario.turno === "Manhã" &&
      !!calcularJanelaSfm() && !DB.sfmConcluidaHoje(usuario.setor, hojeISO());
  }

  function textoDiasCobertos(dias) {
    const formatados = dias.map(formatarDataBR);
    if (formatados.length <= 1) return formatados[0] || "";
    return formatados.slice(0, -1).join(", ") + " e " + formatados[formatados.length - 1];
  }

  /** Ponto de entrada: decide se mostra o convite do assistente ou o quadro normal. Chamado no início e sempre que os dados são recarregados. */
  function atualizarFluxoPrincipal() {
    if (elegivelParaWizardHoje()) {
      mostrarPromptWizard();
    } else {
      mostrarBoardNormal();
    }
  }

  function mostrarBoardNormal() {
    cardWizardPrompt.hidden = true;
    cardWizard.hidden = true;
    cardFiltros.hidden = false;
    quadroEl.hidden = false;
    cardComoAlimentar.hidden = false;
    cardTopProblemas.hidden = false;
    renderizar();
  }

  function mostrarPromptWizard() {
    cardFiltros.hidden = true;
    quadroEl.hidden = true;
    cardComoAlimentar.hidden = true;
    cardTopProblemas.hidden = true;
    cardWizard.hidden = true;

    const dias = calcularJanelaSfm();
    wizardPromptTexto.textContent = `Ainda não foi preenchida a SFM de hoje do setor ${usuario.setor}, referente a ${textoDiasCobertos(dias)}.`;
    cardWizardPrompt.hidden = false;
  }

  btnAdiarWizard.addEventListener("click", () => mostrarBoardNormal());
  btnIniciarWizard.addEventListener("click", () => iniciarWizard());

  function iniciarWizard() {
    wizardDias = calcularJanelaSfm() || [];
    wizardIndice = 0;
    wizardRespostas = {};

    // Pré-preenche com o que já existir salvo (ex.: admin já tinha marcado algo, ou o operador voltou ao assistente depois de sair no meio).
    for (const dia of wizardDias) {
      const registro = DB.buscarRegistroQuadro(usuario.setor, dia);
      if (!registro) continue;
      for (const { campo } of WIZARD_CAMPOS) {
        if (registro[campo] === undefined) continue;
        wizardRespostas[`${dia}|${campo}`] = { valor: registro[campo], detalhe: registro[`${campo}Detalhe`] || null };
      }
    }

    cardWizardPrompt.hidden = true;
    cardWizard.hidden = false;
    renderWizardStep();
  }

  function totalWizardSteps() {
    return wizardDias.length * WIZARD_CAMPOS.length;
  }

  function wizardStepAtual() {
    const diaIdx = Math.floor(wizardIndice / WIZARD_CAMPOS.length);
    const campoIdx = wizardIndice % WIZARD_CAMPOS.length;
    return { dia: wizardDias[diaIdx], diaIdx, campoInfo: WIZARD_CAMPOS[campoIdx], campoIdx };
  }

  function renderWizardStep() {
    const { dia, diaIdx, campoInfo, campoIdx } = wizardStepAtual();

    wizardTitulo.textContent = `SFM — ${usuario.setor}`;
    wizardProgresso.textContent = wizardDias.length > 1
      ? `Dia ${diaIdx + 1} de ${wizardDias.length} — Item ${campoIdx + 1} de ${WIZARD_CAMPOS.length}`
      : `Item ${campoIdx + 1} de ${WIZARD_CAMPOS.length}`;
    wizardPergunta.textContent = `${campoInfo.pergunta} (${formatarDataBR(dia)})`;
    wizardLegenda.textContent = campoInfo.legenda;

    wizardBotoesSimNao.hidden = false;
    wizardDetalhe.hidden = true;
    wizardMsgDetalhe.textContent = "";

    const resposta = wizardRespostas[`${dia}|${campoInfo.campo}`];
    const detalhe = resposta && resposta.valor === true ? resposta.detalhe : null;
    wizardDefeito.value = detalhe?.defeito || "";
    wizardMaquina.value = detalhe?.maquina || "";
    wizardCelula.value = detalhe?.celula || "";
    wizardDescricao.value = detalhe?.descricao || "";

    wizardBtnVoltar.hidden = wizardIndice === 0;
  }

  wizardBtnNao.addEventListener("click", () => {
    const { dia, campoInfo } = wizardStepAtual();
    wizardRespostas[`${dia}|${campoInfo.campo}`] = { valor: false, detalhe: null };
    avancarWizard();
  });

  wizardBtnSim.addEventListener("click", () => {
    wizardBotoesSimNao.hidden = true;
    wizardDetalhe.hidden = false;
    wizardDefeito.focus();
  });

  wizardBtnConfirmarDetalhe.addEventListener("click", () => {
    const defeito = wizardDefeito.value.trim();
    const maquina = wizardMaquina.value.trim();
    const celula = wizardCelula.value.trim();
    const descricao = wizardDescricao.value.trim();

    if (!defeito || !maquina || !descricao) {
      wizardMsgDetalhe.textContent = "Preencha ao menos Defeito, Máquina e Descrição.";
      wizardMsgDetalhe.style.color = "var(--vermelho-alerta)";
      return;
    }

    const { dia, campoInfo } = wizardStepAtual();
    wizardRespostas[`${dia}|${campoInfo.campo}`] = { valor: true, detalhe: { defeito, maquina, celula, descricao } };
    avancarWizard();
  });

  wizardBtnVoltar.addEventListener("click", () => {
    if (wizardIndice === 0) return;
    wizardIndice--;
    renderWizardStep();
  });

  function avancarWizard() {
    wizardIndice++;
    if (wizardIndice >= totalWizardSteps()) finalizarWizard();
    else renderWizardStep();
  }

  async function finalizarWizard() {
    for (const [chave, resposta] of Object.entries(wizardRespostas)) {
      const [dia, campo] = chave.split("|");
      DB.definirRegistroQuadro(usuario.setor, dia, campo, resposta.valor);
      DB.definirRegistroQuadro(usuario.setor, dia, `${campo}Detalhe`, resposta.valor ? resposta.detalhe : null);
    }
    DB.confirmarSfm(usuario.nome, usuario.setor, hojeISO());

    const okQuadro = await DbUI.salvarQuadro(alerta);
    const okDados = await DbUI.salvarDados(alerta);
    if (okQuadro && okDados) mostrarAlerta(alerta, "ok", "SFM de hoje registrada com sucesso.");

    mostrarBoardNormal();
  }

  DbUI.definirCallbackRecarregar(() => atualizarFluxoPrincipal());
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

    renderDiasEditaveis(setor, dias, hojeReal, diaSelecionado);
    renderTabelaD(setor, ano, mes, dias, diaSelecionado);
    renderTabelaC(setor, ano, mes, dias, diaSelecionado);
    renderTopProblemas(setor, diaSelecionado);
  }

  // ---------- S / Q: grades clicáveis ----------

  /**
   * Quem pode editar a grade S/Q diretamente (clique na célula): só admin
   * e gestor, em qualquer setor/dia — edição livre, fora do fluxo guiado.
   * O turno Manhã preenche pelo assistente por etapas (ver
   * elegivelParaWizardHoje/iniciarWizard), não mais clicando na grade.
   */
  function podeEditarSecaoSQ(setor) {
    return usuario.papel === "admin" || usuario.papel === "gestor";
  }

  function diaEditavel(setor, dataISO, hoje) {
    if (dataISO > hoje) return false;
    return podeEditarSecaoSQ(setor);
  }

  /**
   * dias depois do diaSelecionado ainda "não aconteceram" nessa visualização
   * (mesmo que já tenham marcação salva de verdade) — não mostra o valor
   * nem libera edição, pra reproduzir fielmente como o quadro estava
   * naquele dia. Independe de diaEditavel, que trata de QUEM pode editar
   * (papel/janela da SFM); aqui é só "isso já devia estar marcado a essa
   * altura?".
   */
  function renderDiasEditaveis(setor, dias, hoje, diaSelecionado) {
    const podeEditar = podeEditarSecaoSQ(setor);
    const aviso = quadroEl.querySelector(".quadro-nao-editavel-aviso");
    if (aviso) {
      aviso.textContent = podeEditar
        ? "Edição direta (admin/gestor) — clique no dia para alternar: em branco → sem ocorrência (verde) → ocorrência (vermelho). Não esqueça de \"Salvar marcações\"."
        : "Somente leitura — a SFM é preenchida pelo turno Manhã do setor, pelo assistente por etapas, na hora da reunião.";
    }

    for (const item of quadroEl.querySelectorAll(".quadro-item[data-campo]")) {
      const campo = item.dataset.campo;
      const grid = item.querySelector(".quadro-dias");
      grid.innerHTML = dias.map((dataISO, i) => {
        const dia = i + 1;
        const aindaNaoAconteceu = dataISO > diaSelecionado;
        const editavel = !aindaNaoAconteceu && diaEditavel(setor, dataISO, hoje);
        const registro = aindaNaoAconteceu ? null : DB.buscarRegistroQuadro(setor, dataISO);
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
          return `<tr>
            <td>${escaparHtml(p.maquina || "—")}</td>
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
          return `<tr>
            <td>${i + 1}</td>
            <td>${escaparHtml(p.maquina || "—")}</td>
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

  atualizarFluxoPrincipal();
})();
