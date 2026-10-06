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
 * mesma ordem/rótulos da grade S/Q, mais o Top 3 Problemas no final. Passos
 * `tipo: "simNao"` (padrão) perguntam Sim/Não e, se "Sim", pedem
 * Defeito/Máquina/Célula/Descrição (mesmos campos do cadastro manual de
 * Passar Turno) antes de avançar. O passo `tipo: "top3"` é tratado à parte
 * (ver renderWizardStep/renderWizardTop3) — monta até 3 entradas no formato
 * D/I/C/Ca/S da folha impressa (ver modelo/modelo-problemas.jpeg).
 */
const WIZARD_CAMPOS = [
  { campo: "acidente", tipo: "simNao", pergunta: "Houve acidente com ou sem afastamento?", legenda: "Considere qualquer acidente, com ou sem afastamento, ocorrido no setor." },
  { campo: "quaseAcidente", tipo: "simNao", pergunta: "Houve quase acidente?", legenda: "Ocorrência imprevista que não resultou em ferimento ou dano, mas poderia ter resultado." },
  { campo: "retrabalho", tipo: "simNao", pergunta: "Houve retrabalho de corretiva?", legenda: "Falha, com o mesmo efeito, em até 2 semanas após a atuação." },
  { campo: "falhaFornecedor", tipo: "simNao", pergunta: "Houve falha de fornecedor?", legenda: "Desvio em peça/componente novo dentro da garantia, ou atraso de fornecedor." },
  { campo: "topProblemas", tipo: "top3", pergunta: "Quais foram os Top 3 problemas do dia?", legenda: "Registre até 3 problemas no formato D/I/C/Ca/S da folha impressa. Use uma sugestão de quebra grave (10h+ parada) para pré-preencher, ou adicione manualmente — se não houve nenhum problema relevante, pode avançar sem adicionar nada." },
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
  denominacao: "nomeEquipamento",
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
  nomeEquipamento: ["denominacao"],
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
      nomeEquipamento: strOuNull(extrair(linha, "nomeEquipamento")),
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

  await DB.carregarAutoLoad({ notas: true, quadro: true });
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
  const wizardSugestoesRetrabalho = document.getElementById("wizardSugestoesRetrabalho");
  const wizardDefeito = document.getElementById("wizardDefeito");
  const wizardMaquina = document.getElementById("wizardMaquina");
  const wizardCelula = document.getElementById("wizardCelula");
  const wizardDescricao = document.getElementById("wizardDescricao");
  const wizardMsgDetalhe = document.getElementById("wizardMsgDetalhe");
  const wizardBtnConfirmarDetalhe = document.getElementById("wizardBtnConfirmarDetalhe");
  const wizardTop3 = document.getElementById("wizardTop3");
  const wizardTop3Continuacao = document.getElementById("wizardTop3Continuacao");
  const wizardTop3Sugestoes = document.getElementById("wizardTop3Sugestoes");
  const wizardTop3Lista = document.getElementById("wizardTop3Lista");
  const wizardBtnTop3Adicionar = document.getElementById("wizardBtnTop3Adicionar");
  const wizardMsgTop3 = document.getElementById("wizardMsgTop3");
  const wizardBtnConfirmarTop3 = document.getElementById("wizardBtnConfirmarTop3");
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

  // Se o operador já concluiu a SFM de hoje, abre direto no último dia que ela cobriu
  // (normalmente "ontem" — ver calcularJanelaSfm) em vez de "hoje", onde a SFM recém-preenchida
  // não aparece (nada foi marcado pra hoje, só pro(s) dia(s) da janela).
  const janelaSfmHoje = usuario.papel === "operador" ? calcularJanelaSfm() : null;
  seletorDia.value = (janelaSfmHoje && DB.sfmConcluidaHoje(usuario.setor, hojeISO()))
    ? janelaSfmHoje[janelaSfmHoje.length - 1]
    : hojeISO();
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
  let wizardRespostas = {}; // chave "dataISO|campo" -> { valor: true/false, detalhe: {defeito,maquina,celula,descricao}|null } (simNao) ou { valor: [entradasTop3] } (top3)
  let wizardTop3Entradas = []; // entradas do passo "top3" sendo editado no momento (até 3)

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

    const resposta = wizardRespostas[`${dia}|${campoInfo.campo}`];

    if (campoInfo.tipo === "top3") {
      wizardBotoesSimNao.hidden = true;
      wizardDetalhe.hidden = true;
      wizardTop3.hidden = false;
      wizardMsgTop3.textContent = "";
      wizardTop3Entradas = resposta && Array.isArray(resposta.valor)
        ? resposta.valor.map((e) => ({ ...entradaTop3Vazia(), ...e, checks: { ...entradaTop3Vazia().checks, ...e.checks } }))
        : [];
      renderWizardTop3(dia);
    } else {
      wizardTop3.hidden = true;
      wizardBotoesSimNao.hidden = false;
      wizardDetalhe.hidden = true;
      wizardMsgDetalhe.textContent = "";

      const detalhe = resposta && resposta.valor === true ? resposta.detalhe : null;
      wizardDefeito.value = detalhe?.defeito || "";
      wizardMaquina.value = detalhe?.maquina || "";
      wizardCelula.value = detalhe?.celula || "";
      wizardDescricao.value = detalhe?.descricao || "";

      wizardSugestoesRetrabalho.innerHTML = "";
      if (campoInfo.campo === "retrabalho") renderSugestoesRetrabalho(dia);
    }

    wizardBtnVoltar.hidden = wizardIndice === 0;
  }

  // ---------- Sugestões: retrabalho (máquinas com mais de 1 ordem aberta no dia) ----------

  function candidatosRetrabalho(dia) {
    const porEquipamento = new Map();
    for (const n of DB.notas) {
      if (n.setor !== usuario.setor || n.dataEntrada !== dia || !n.equipamento) continue;
      let grupo = porEquipamento.get(n.equipamento);
      if (!grupo) { grupo = { equipamento: n.equipamento, nomeEquipamento: n.nomeEquipamento || null, notas: [] }; porEquipamento.set(n.equipamento, grupo); }
      grupo.notas.push(n);
      if (!grupo.nomeEquipamento && n.nomeEquipamento) grupo.nomeEquipamento = n.nomeEquipamento;
    }
    return Array.from(porEquipamento.values()).filter((g) => g.notas.length > 1);
  }

  function renderSugestoesRetrabalho(dia) {
    const candidatos = candidatosRetrabalho(dia);
    if (candidatos.length === 0) { wizardSugestoesRetrabalho.innerHTML = ""; return; }
    wizardSugestoesRetrabalho.innerHTML = `
      <div class="wizard-sugestoes">
        <span class="wizard-sugestao-titulo">Equipamentos com mais de 1 ordem aberta hoje (possível retrabalho) — clique para ver as ordens:</span>
        ${candidatos.map((c, i) => `<button type="button" class="wizard-chip-sugestao" data-i="${i}">${escaparHtml(c.nomeEquipamento || c.equipamento)} — ${c.notas.length} ordens</button>`).join("")}
      </div>
      <div id="wizardRetrabalhoDetalhe"></div>`;
    const painelDetalhe = wizardSugestoesRetrabalho.querySelector("#wizardRetrabalhoDetalhe");
    // Só mostra as ordens como referência — não preenche Defeito/Máquina/Célula/Descrição
    // sozinho, o operador descreve o retrabalho com as próprias palavras, olhando essa referência.
    wizardSugestoesRetrabalho.querySelectorAll(".wizard-chip-sugestao").forEach((btn) => {
      btn.addEventListener("click", () => {
        const c = candidatos[Number(btn.dataset.i)];
        painelDetalhe.innerHTML = `
          <div class="tabela-scroll" style="margin-top:8px;max-height:200px;">
            <table>
              <thead><tr><th>Nota</th><th>Ordem</th><th>Data</th><th>Horário</th><th>Local / Célula</th><th>Máquina</th><th>Descrição</th></tr></thead>
              <tbody>
                ${c.notas.map((n) => `<tr>
                  <td>${escaparHtml(n.nota)}</td>
                  <td>${escaparHtml(n.ordem || "—")}</td>
                  <td>${formatarDataBR(n.dataEntrada)}</td>
                  <td>${escaparHtml(n.horaEntrada || "—")}</td>
                  <td>${escaparHtml(n.loc || "—")}</td>
                  <td>${escaparHtml(n.nomeEquipamento || n.equipamento || "—")}</td>
                  <td>${escaparHtml(n.textoBreve || "—")}</td>
                </tr>`).join("")}
              </tbody>
            </table>
          </div>`;
      });
    });
  }

  // ---------- Top 3 Problemas (D/I/C/Ca/S) ----------

  function candidatosQuebraGrave(dia) {
    return DB.dados.passagensTurno.filter((p) =>
      p.setor === usuario.setor && p.status === "finalizada" &&
      p.tempoParadoMinutos >= LIMITE_PARADA_MINUTOS &&
      p.finalizadaEm && formatarDataISO(new Date(p.finalizadaEm)) === dia
    );
  }

  /** TOP1/TOP2/TOP3 são mutuamente exclusivos (ver TOP3_RANKS) — definem o rótulo mostrado à
   * esquerda da grade (ver rotuloRankTop3). Os demais são checkboxes independentes de escalonamento. */
  const TOP3_RANKS = [
    { chave: "top1", rotulo: "TOP 1" },
    { chave: "top2", rotulo: "TOP 2" },
    { chave: "top3", rotulo: "TOP 3" },
  ];
  const TOP3_CHECKS = [
    { chave: "goSee", rotulo: "GO & SEE" },
    { chave: "pdcaA3", rotulo: "PDCA A3" },
    { chave: "planoAcao", rotulo: "Plano de ação" },
    { chave: "feedback", rotulo: "Feedback" },
  ];

  /** Rótulo da esquerda da grade — reflete qual de TOP1/TOP2/TOP3 está marcado no rodapé, não a posição na lista. */
  function rotuloRankTop3(checks) {
    const marcado = TOP3_RANKS.find(({ chave }) => checks?.[chave]);
    return marcado ? marcado.rotulo : "TOP ?";
  }

  /** Marca por padrão o rank (TOP1/2/3) correspondente à posição em que a entrada está sendo adicionada agora — só um ponto de partida, o operador pode trocar depois. */
  function checksComRankPadrao(indice) {
    const checks = entradaTop3Vazia().checks;
    checks[TOP3_RANKS[indice]?.chave || "top1"] = true;
    return checks;
  }

  function entradaTop3Vazia() {
    return {
      id: gerarId("top3"),
      dia: 1, // 1º/2º/3º do ciclo D/I -> C/Ca -> S — selecionável pelo operador, usado pra sugerir continuidade no dia seguinte
      celula: null, maquina: null, ordem: null, horario: null, descricao: null,
      efeito: null, mttr: null, contencao: null, causaRaiz: null, solucao: null,
      ajuda: null, responsavel: null,
      checks: { top1: false, top2: false, top3: false, goSee: false, pdcaA3: false, planoAcao: false, feedback: false },
      origemPassagemId: null,
    };
  }

  /** Lê o Top 3 de um dia: se ainda estiver sendo preenchido nesta mesma sessão do assistente
   * (ex.: janela de fim de semana com vários dias seguidos), usa o que está em memória — senão
   * cai pro que já foi salvo em bd/quadro.json. */
  function topProblemasDoDia(setor, diaISO) {
    const resposta = wizardRespostas[`${diaISO}|topProblemas`];
    if (resposta && Array.isArray(resposta.valor)) return resposta.valor;
    const registro = DB.buscarRegistroQuadro(setor, diaISO);
    return Array.isArray(registro?.topProblemas) ? registro.topProblemas : [];
  }

  /** Problemas do dia anterior ainda não concluídos (dia < 3º) — candidatos a "dar continuidade" hoje. */
  function candidatosContinuacaoTop3(dia) {
    const diaAnterior = somarDiasISO(dia, -1);
    return topProblemasDoDia(usuario.setor, diaAnterior).filter((e) => (e.dia || 1) < 3);
  }

  function renderContinuacaoTop3(dia) {
    const candidatos = candidatosContinuacaoTop3(dia).filter((e) => !wizardTop3Entradas.some((x) => x.id === e.id));
    wizardTop3Continuacao.innerHTML = candidatos.length
      ? `<div class="wizard-sugestoes">
          <span class="wizard-sugestao-titulo">Problemas em aberto de ontem — dar continuidade?</span>
          ${candidatos.map((e) => `<button type="button" class="wizard-chip-sugestao" data-id="${e.id}">${escaparHtml(e.maquina || e.descricao || "Problema sem máquina")} — estava no ${e.dia || 1}º dia</button>`).join("")}
        </div>`
      : "";
    wizardTop3Continuacao.querySelectorAll(".wizard-chip-sugestao").forEach((btn) => {
      btn.addEventListener("click", () => {
        if (wizardTop3Entradas.length >= 3) {
          wizardMsgTop3.textContent = "Já tem 3 problemas adicionados — remova um para continuar este.";
          wizardMsgTop3.style.color = "var(--vermelho-alerta)";
          return;
        }
        const candidato = candidatos.find((c) => c.id === btn.dataset.id);
        wizardTop3Entradas.push({
          ...entradaTop3Vazia(),
          ...candidato,
          checks: { ...entradaTop3Vazia().checks, ...candidato.checks },
          dia: Math.min((candidato.dia || 1) + 1, 3),
        });
        wizardMsgTop3.textContent = "";
        renderWizardTop3(dia);
      });
    });
  }

  /** Monta a grade de edição de uma entrada do Top 3, no mesmo layout D/I/C/Ca/S da folha impressa (ver modelo/problemas.html). */
  function campoTop3Html(e, i) {
    const v = (x) => escaparHtml(x || "");
    const checks = e.checks || {};
    return `
      <div class="top3-folha">
        <table class="top3-tabela">
          <colgroup><col style="width:52px"><col style="width:34px"><col style="width:34px"><col><col style="width:64px"><col style="width:120px"></colgroup>
          <tbody>
            <tr>
              <td class="top3-top" rowspan="5">${rotuloRankTop3(checks)}<button type="button" class="btn-remover-top3" data-i="${i}" title="Remover este problema">✕</button></td>
              <td class="top3-dia" rowspan="2"><label><input type="radio" name="top3-dia-${i}" data-campo="dia" data-i="${i}" value="1" ${(e.dia || 1) === 1 ? "checked" : ""}> 1º</label></td>
              <td class="top3-let">D:</td>
              <td>
                <div class="top3-lbl">O que? Quando? Onde?</div>
                <div class="top3-sub-grid">
                  <div><div class="top3-lbl">Célula</div><input type="text" data-campo="celula" data-i="${i}" value="${v(e.celula)}"></div>
                  <div><div class="top3-lbl">Máquina</div><input type="text" data-campo="maquina" data-i="${i}" value="${v(e.maquina)}"></div>
                  <div><div class="top3-lbl">Ordem</div><input type="text" data-campo="ordem" data-i="${i}" value="${v(e.ordem)}"></div>
                  <div><div class="top3-lbl">Horário</div><input type="text" data-campo="horario" data-i="${i}" value="${v(e.horario)}" placeholder="hh:mm"></div>
                  <div><div class="top3-lbl">Descrição do problema</div><input type="text" data-campo="descricao" data-i="${i}" value="${v(e.descricao)}"></div>
                </div>
              </td>
              <td class="top3-ajuda" rowspan="5">
                <div class="top3-lbl">Ajuda</div>
                <label><input type="radio" name="top3-ajuda-${i}" data-campo="ajuda" data-i="${i}" value="sim" ${e.ajuda === true ? "checked" : ""}> Sim</label>
                <label><input type="radio" name="top3-ajuda-${i}" data-campo="ajuda" data-i="${i}" value="nao" ${e.ajuda === false ? "checked" : ""}> Não</label>
              </td>
              <td rowspan="5"><div class="top3-lbl">Resp.</div><input type="text" data-campo="responsavel" data-i="${i}" value="${v(e.responsavel)}" placeholder="Responsável"></td>
            </tr>
            <tr>
              <td class="top3-let">I:</td>
              <td>
                <div class="top3-lbl">Quais os efeitos do problema? Quanto?</div>
                <textarea data-campo="efeito" data-i="${i}">${v(e.efeito)}</textarea>
                <div class="top3-lbl">Tempo de reparo = MTTR =</div>
                <input type="text" data-campo="mttr" data-i="${i}" value="${v(e.mttr)}">
              </td>
            </tr>
            <tr>
              <td class="top3-dia" rowspan="2"><label><input type="radio" name="top3-dia-${i}" data-campo="dia" data-i="${i}" value="2" ${(e.dia || 1) === 2 ? "checked" : ""}> 2º</label></td>
              <td class="top3-let">C:</td>
              <td>
                <div class="top3-lbl">Ações imediatas para eliminar ou reduzir o impacto. O que foi feito para reestabelecer o equipamento?</div>
                <textarea data-campo="contencao" data-i="${i}">${v(e.contencao)}</textarea>
              </td>
            </tr>
            <tr>
              <td class="top3-let">Ca:</td>
              <td>
                <div class="top3-lbl">Por que o problema aconteceu? 5 porquês</div>
                <textarea data-campo="causaRaiz" data-i="${i}">${v(e.causaRaiz)}</textarea>
              </td>
            </tr>
            <tr>
              <td class="top3-dia"><label><input type="radio" name="top3-dia-${i}" data-campo="dia" data-i="${i}" value="3" ${(e.dia || 1) === 3 ? "checked" : ""}> 3º</label></td>
              <td class="top3-let">S:</td>
              <td>
                <div class="top3-lbl">Ações para eliminar a causa raiz. Ações para evitar que o equipamento quebre novamente pelo mesmo motivo. Tem abrangência?</div>
                <textarea data-campo="solucao" data-i="${i}">${v(e.solucao)}</textarea>
              </td>
            </tr>
            <tr class="top3-rodape">
              <td colspan="6">
                ${TOP3_RANKS.map(({ chave, rotulo }) => `<label><input type="radio" name="top3-rank-${i}" data-campo="rank:${chave}" data-i="${i}" ${checks[chave] ? "checked" : ""}> ${rotulo}</label>`).join("")}
                ${TOP3_CHECKS.map(({ chave, rotulo }) => `<label><input type="checkbox" data-campo="check:${chave}" data-i="${i}" ${checks[chave] ? "checked" : ""}> ${rotulo}</label>`).join("")}
              </td>
            </tr>
          </tbody>
        </table>
      </div>`;
  }

  /** Lê um clique/alteração num campo de uma entrada do Top 3 e atualiza wizardTop3Entradas — delegado no container (ver wizardTop3Lista abaixo), já que o conteúdo é inteiramente recriado a cada renderWizardTop3. */
  function aplicarMudancaTop3(ev) {
    const campo = ev.target.dataset.campo;
    if (!campo) return;
    const i = Number(ev.target.dataset.i);
    const entrada = wizardTop3Entradas[i];
    if (!entrada) return;
    if (campo === "ajuda") { entrada.ajuda = ev.target.value === "sim"; return; }
    if (campo === "dia") { entrada.dia = Number(ev.target.value); return; }
    if (campo.startsWith("rank:")) {
      // TOP1/TOP2/TOP3 são mutuamente exclusivos — marcar um desmarca os outros dois. Refaz a
      // grade pra atualizar o rótulo "TOP n" à esquerda, que agora segue essa marcação.
      for (const { chave } of TOP3_RANKS) entrada.checks[chave] = false;
      entrada.checks[campo.slice(5)] = true;
      renderWizardTop3(wizardStepAtual().dia);
      return;
    }
    if (campo.startsWith("check:")) { entrada.checks[campo.slice(6)] = ev.target.checked; return; }
    entrada[campo] = ev.target.value;
  }

  function renderWizardTop3(dia) {
    renderContinuacaoTop3(dia);

    const candidatos = candidatosQuebraGrave(dia).filter((p) => !wizardTop3Entradas.some((e) => e.origemPassagemId === p.id));

    wizardTop3Sugestoes.innerHTML = candidatos.length
      ? `<div class="wizard-sugestoes">
          <span class="wizard-sugestao-titulo">Quebras graves do dia (10h+ parada) — use para pré-preencher um Top 3:</span>
          ${candidatos.map((p) => `<button type="button" class="wizard-chip-sugestao" data-id="${p.id}">${escaparHtml(p.maquina || "—")} — ${formatarDuracaoMinutos(p.tempoParadoMinutos)}</button>`).join("")}
        </div>`
      : "";
    wizardTop3Sugestoes.querySelectorAll(".wizard-chip-sugestao").forEach((btn) => {
      btn.addEventListener("click", () => {
        if (wizardTop3Entradas.length >= 3) {
          wizardMsgTop3.textContent = "Já tem 3 problemas adicionados — remova um para usar essa sugestão.";
          wizardMsgTop3.style.color = "var(--vermelho-alerta)";
          return;
        }
        const p = candidatos.find((c) => c.id === btn.dataset.id);
        wizardTop3Entradas.push({
          ...entradaTop3Vazia(),
          checks: checksComRankPadrao(wizardTop3Entradas.length),
          celula: p.celula || null,
          maquina: p.maquina || null,
          horario: p.inicioParadaEm ? new Date(p.inicioParadaEm).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : null,
          descricao: p.defeito ? `${p.defeito} — ${p.descricao}` : p.descricao,
          efeito: `Máquina parada ${formatarDuracaoMinutos(p.tempoParadoMinutos)}`,
          mttr: formatarDuracaoMinutos(p.tempoParadoMinutos),
          origemPassagemId: p.id,
        });
        wizardMsgTop3.textContent = "";
        renderWizardTop3(dia);
      });
    });

    wizardTop3Lista.innerHTML = wizardTop3Entradas.length
      ? wizardTop3Entradas.map((e, i) => campoTop3Html(e, i)).join("")
      : `<p class="rodape-nota" style="text-align:left;">Nenhum problema adicionado ainda.</p>`;

    wizardBtnTop3Adicionar.disabled = wizardTop3Entradas.length >= 3;
  }

  // Delegado uma única vez no container (não a cada render, que recria todo o conteúdo) —
  // evita o bug de listeners duplicados que gerava entradas fantasma (ver histórico).
  wizardTop3Lista.addEventListener("input", aplicarMudancaTop3);
  wizardTop3Lista.addEventListener("change", aplicarMudancaTop3);
  wizardTop3Lista.addEventListener("click", (ev) => {
    const btn = ev.target.closest(".btn-remover-top3");
    if (!btn) return;
    wizardTop3Entradas.splice(Number(btn.dataset.i), 1);
    renderWizardTop3(wizardStepAtual().dia);
  });

  wizardBtnTop3Adicionar.addEventListener("click", () => {
    if (wizardTop3Entradas.length >= 3) return;
    // Sem rank pré-marcado (diferente da sugestão de quebra grave, que já vem com conteúdo real) —
    // uma entrada totalmente em branco não deve "parecer preenchida" só pelo rank, ver entradaTop3Preenchida.
    wizardTop3Entradas.push(entradaTop3Vazia());
    wizardMsgTop3.textContent = "";
    renderWizardTop3(wizardStepAtual().dia);
  });

  /** Uma entrada "em branco" (criada por "+ Adicionar manualmente" e esquecida sem preencher, ou sobrando de uma sugestão removida) não deve ser salva como Top 3.
   * O rank (TOP1/2/3) sozinho não conta — ele vem pré-marcado por padrão em sugestões (ver checksComRankPadrao), então um rank marcado sem mais nada ainda é "em branco". */
  function entradaTop3Preenchida(e) {
    const camposTexto = ["celula", "maquina", "ordem", "horario", "descricao", "efeito", "mttr", "contencao", "causaRaiz", "solucao", "responsavel"];
    if (camposTexto.some((campo) => e[campo])) return true;
    if (e.ajuda === true || e.ajuda === false) return true;
    if (e.checks && TOP3_CHECKS.some(({ chave }) => e.checks[chave])) return true;
    return false;
  }

  wizardBtnConfirmarTop3.addEventListener("click", () => {
    const { dia, campoInfo } = wizardStepAtual();
    const entradas = wizardTop3Entradas.map((e) => ({ ...e })).filter(entradaTop3Preenchida);
    wizardRespostas[`${dia}|${campoInfo.campo}`] = { valor: entradas };
    avancarWizard();
  });

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
      const info = WIZARD_CAMPOS.find((c) => c.campo === campo);
      if (info && info.tipo === "top3") {
        DB.definirRegistroQuadro(usuario.setor, dia, campo, resposta.valor || []);
      } else {
        DB.definirRegistroQuadro(usuario.setor, dia, campo, resposta.valor);
        DB.definirRegistroQuadro(usuario.setor, dia, `${campo}Detalhe`, resposta.valor ? resposta.detalhe : null);
      }
    }
    DB.confirmarSfm(usuario.nome, usuario.setor, hojeISO());

    const okQuadro = await DbUI.salvarQuadro(alerta);
    const okDados = await DbUI.salvarDados(alerta);
    if (okQuadro && okDados) mostrarAlerta(alerta, "ok", "SFM de hoje registrada com sucesso.");

    // Mostra direto o dia que acabou de ser preenchido (normalmente "ontem", não hoje —
    // ver calcularJanelaSfm) em vez de deixar o seletor em "hoje", onde nada apareceria.
    if (wizardDias.length) seletorDia.value = wizardDias[wizardDias.length - 1];
    mostrarBoardNormal();
  }

  DbUI.definirCallbackRecarregar(() => atualizarFluxoPrincipal());
  DbUI.iniciar(document.getElementById("dbStatus"));

  // ---------- Cálculos automáticos (D e C) ----------

  function notaNaoAtendida(nota) {
    return (nota.statusSistema || "").toUpperCase().includes("MSPN");
  }

  // Índices por dia (dataISO -> stats), construídos 1x por renderizar() pelo
  // setor exibido — statsCorretivasDia/quebrasGravesDia são chamadas ~60x
  // por render (mês atual + mês anterior, D e C), e DB.notas só cresce (nunca
  // é podado), então escanear a lista inteira a cada chamada fica caro à
  // medida que o histórico aumenta. Ver construirIndicesDC.
  let notasIndexAtual = null;
  let quebrasIndexAtual = null;

  function construirIndicesDC(setor) {
    notasIndexAtual = new Map();
    for (const n of DB.notas) {
      if (n.setor !== setor || !n.dataEntrada) continue;
      let s = notasIndexAtual.get(n.dataEntrada);
      if (!s) { s = { total: 0, realizadas: 0, pendentes: 0 }; notasIndexAtual.set(n.dataEntrada, s); }
      s.total++;
      if (notaNaoAtendida(n)) s.pendentes++; else s.realizadas++;
    }

    quebrasIndexAtual = new Map();
    for (const p of DB.dados.passagensTurno) {
      if (p.setor !== setor || p.status !== "finalizada" || !p.finalizadaEm) continue;
      if (p.tempoParadoMinutos < LIMITE_PARADA_MINUTOS) continue;
      const dia = formatarDataISO(new Date(p.finalizadaEm));
      quebrasIndexAtual.set(dia, (quebrasIndexAtual.get(dia) || 0) + 1);
    }
  }

  /** Realizadas = atendidas, Abertas = total de notas com Dt. referência = dia, Pendentes = não atendidas. */
  function statsCorretivasDia(setor, dataISO) {
    return notasIndexAtual?.get(dataISO) || { total: 0, realizadas: 0, pendentes: 0 };
  }

  /** Nº de máquinas que passaram de 10h de parada e foram finalizadas neste dia. */
  function quebrasGravesDia(setor, dataISO) {
    return quebrasIndexAtual?.get(dataISO) || 0;
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
    construirIndicesDC(setor);

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
  // (não é mais exibido como tabela própria na tela — só alimenta a impressão/PDF e as
  // sugestões do assistente da SFM; o que aparece na tela é só o Top 3 preenchido, ver abaixo.)

  function renderTopProblemas(setor, diaSelecionado) {
    renderTop3Impressao(setor, diaSelecionado);
    renderTop3Preenchido(setor, diaSelecionado);
  }

  /** Top 3 Problemas (D/I/C/Ca/S) preenchido pelo assistente da SFM (ver WIZARD_CAMPOS) — só leitura aqui. */
  function renderTop3Preenchido(setor, diaSelecionado) {
    const registro = DB.buscarRegistroQuadro(setor, diaSelecionado);
    const top3 = Array.isArray(registro?.topProblemas) ? registro.topProblemas : [];
    const corpo = document.getElementById("corpoTop3Preenchido");
    if (!top3.length) {
      corpo.innerHTML = `<p class="rodape-nota" style="text-align:left;">Nenhum Top 3 preenchido na SFM deste dia ainda.</p>`;
      return;
    }
    corpo.innerHTML = top3.map((e, i) => campoTop3HtmlLeitura(e, i)).join("");
  }

  /** Mesma grade de campoTop3Html, mas só leitura (texto em vez de input) — pra exibir fora do assistente. */
  function campoTop3HtmlLeitura(e, i) {
    const v = (x) => `<span class="top3-valor">${escaparHtml(x || "—")}</span>`;
    const checks = e.checks || {};
    const diaAtual = e.dia || 1;
    const rotuloDia = (estagio) => `<span class="${diaAtual === estagio ? "top3-dia-ativo" : ""}">${estagio}º</span>`;
    return `
      <div class="top3-folha">
        <table class="top3-tabela top3-tabela-leitura">
          <colgroup><col style="width:52px"><col style="width:34px"><col style="width:34px"><col><col style="width:64px"><col style="width:120px"></colgroup>
          <tbody>
            <tr>
              <td class="top3-top" rowspan="5">${rotuloRankTop3(checks)}</td>
              <td class="top3-dia" rowspan="2">${rotuloDia(1)}</td>
              <td class="top3-let">D:</td>
              <td>
                <div class="top3-lbl">O que? Quando? Onde?</div>
                <div class="top3-sub-grid">
                  <div><div class="top3-lbl">Célula</div>${v(e.celula)}</div>
                  <div><div class="top3-lbl">Máquina</div>${v(e.maquina)}</div>
                  <div><div class="top3-lbl">Ordem</div>${v(e.ordem)}</div>
                  <div><div class="top3-lbl">Horário</div>${v(e.horario)}</div>
                  <div><div class="top3-lbl">Descrição do problema</div>${v(e.descricao)}</div>
                </div>
              </td>
              <td class="top3-ajuda" rowspan="5">
                <div class="top3-lbl">Ajuda</div>
                ${e.ajuda === true ? "Sim" : e.ajuda === false ? "Não" : "—"}
              </td>
              <td rowspan="5"><div class="top3-lbl">Resp.</div>${v(e.responsavel)}</td>
            </tr>
            <tr>
              <td class="top3-let">I:</td>
              <td>
                <div class="top3-lbl">Quais os efeitos do problema? Quanto?</div>
                ${v(e.efeito)}
                <div class="top3-lbl">Tempo de reparo = MTTR =</div>
                ${v(e.mttr)}
              </td>
            </tr>
            <tr>
              <td class="top3-dia" rowspan="2">${rotuloDia(2)}</td>
              <td class="top3-let">C:</td>
              <td>
                <div class="top3-lbl">Ações imediatas para eliminar ou reduzir o impacto. O que foi feito para reestabelecer o equipamento?</div>
                ${v(e.contencao)}
              </td>
            </tr>
            <tr>
              <td class="top3-let">Ca:</td>
              <td>
                <div class="top3-lbl">Por que o problema aconteceu? 5 porquês</div>
                ${v(e.causaRaiz)}
              </td>
            </tr>
            <tr>
              <td class="top3-dia">${rotuloDia(3)}</td>
              <td class="top3-let">S:</td>
              <td>
                <div class="top3-lbl">Ações para eliminar a causa raiz. Ações para evitar que o equipamento quebre novamente pelo mesmo motivo. Tem abrangência?</div>
                ${v(e.solucao)}
              </td>
            </tr>
            <tr class="top3-rodape">
              <td colspan="6">
                ${TOP3_RANKS.map(({ chave, rotulo }) => `<span class="top3-check-leitura">${checks[chave] ? "☑" : "☐"} ${rotulo}</span>`).join("")}
                ${TOP3_CHECKS.map(({ chave, rotulo }) => `<span class="top3-check-leitura">${checks[chave] ? "☑" : "☐"} ${rotulo}</span>`).join("")}
              </td>
            </tr>
          </tbody>
        </table>
      </div>`;
  }

  /** Folha 2 da impressão (#folhaTop3, ver quadro-sfm.html) — mesmo Top 3 preenchido na SFM (D/I/C/Ca/S)
   * exibido na tela (ver renderTop3Preenchido); só imprime quando houver algum (ver classe "sem-dados"). */
  function renderTop3Impressao(setor, diaSelecionado) {
    const registro = DB.buscarRegistroQuadro(setor, diaSelecionado);
    const top3 = Array.isArray(registro?.topProblemas) ? registro.topProblemas : [];
    document.getElementById("top3SetorMes").textContent = `${setor} — ${formatarDataBR(diaSelecionado)}`;
    document.getElementById("corpoTop3Impressao").innerHTML = top3.map((e, i) => campoTop3HtmlLeitura(e, i)).join("");
    document.getElementById("folhaTop3").classList.toggle("sem-dados", top3.length === 0);
  }

  window.addEventListener("beforeunload", (ev) => {
    if (sujo) { ev.preventDefault(); ev.returnValue = ""; }
  });

  atualizarFluxoPrincipal();
})();
