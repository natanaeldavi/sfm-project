/* SFM — passar-turno.html */

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
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
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
  if (Auth.aplicarGateRecebimento(usuario)) return;

  montarTopbar(document.getElementById("topbar"), usuario, "Passar Turno");

  const setorAtivo = Auth.getSetorAtivo();
  const alerta = document.getElementById("alerta");
  if (!setorAtivo) {
    mostrarAlerta(alerta, "aviso", "Nenhum setor selecionado. Volte ao menu e escolha um setor.");
  }

  const subbar = document.getElementById("subbar");

  const cardRecebidas = document.getElementById("cardRecebidas");
  const corpoRecebidas = document.getElementById("corpoRecebidas");

  const inputXlsx = document.getElementById("inputXlsx");
  const resumoImportacao = document.getElementById("resumoImportacao");
  const cardTabela = document.getElementById("cardTabela");
  const cardSalvar = document.getElementById("cardSalvar");
  const corpoTabela = document.getElementById("corpoTabela");
  const buscaTexto = document.getElementById("buscaTexto");
  const chkTodosSetores = document.getElementById("chkTodosSetores");
  const contagemLinhas = document.getElementById("contagemLinhas");
  const btnSalvarPassagem = document.getElementById("btnSalvarPassagem");
  const msgSalvar = document.getElementById("msgSalvar");
  const turnoInfo = document.getElementById("turnoInfo");

  /**
   * Status da passagem de turno de hoje, mostrado acima do botão único
   * "Salvar passagem de turno" — substitui o antigo botão separado
   * "Concluir passagem de turno": agora salvar (mesmo sem ordens marcadas,
   * com confirmação) já conclui a passagem do dia.
   */
  function renderInfoTurno() {
    if (!usuario.turno) {
      turnoInfo.textContent = "Turno não definido para o seu usuário — peça para o admin configurar em Administração.";
      return;
    }
    if (usuario.papel !== "operador") {
      turnoInfo.textContent = `Turno: ${usuario.turno}`;
      return;
    }

    const data = dataDoTurnoAtual(usuario.turno);
    const concluida = DB.passagemTurnoConcluida(usuario.setor, usuario.turno, data);
    const obrigatorio = Auth.dentroJanelaPassagemObrigatoria(usuario);

    if (concluida) {
      const registro = DB.dados.confirmacoesTurno.find(
        (c) => c.tipo === "passagem" && c.setor === usuario.setor && c.turno === usuario.turno && c.data === data
      );
      const hora = registro ? new Date(registro.concluidoEm).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "";
      turnoInfo.textContent = `Turno ${usuario.turno} — passagem de hoje já concluída${hora ? " às " + hora : ""}. Salvar de novo atualiza a passagem normalmente.`;
      subbar.style.pointerEvents = "";
      subbar.style.opacity = "";
    } else if (obrigatorio) {
      const j = janelaPassarTurno(usuario.turno);
      const horaFim = `${String(Math.floor(j.fim / 60)).padStart(2, "0")}:${String(j.fim % 60).padStart(2, "0")}`;
      turnoInfo.innerHTML = `<strong>Horário obrigatório de passagem de turno (até ${horaFim}).</strong> Clique em "Salvar passagem de turno" abaixo antes de acessar o resto do sistema — mesmo que não tenha nenhuma ordem pra passar.`;
      subbar.style.pointerEvents = "none";
      subbar.style.opacity = "0.4";
    } else {
      turnoInfo.textContent = `Turno: ${usuario.turno} — clique em "Salvar passagem de turno" quando terminar, mesmo sem ordens pra passar.`;
      subbar.style.pointerEvents = "";
      subbar.style.opacity = "";
    }
  }

  renderInfoTurno();
  cardTabela.hidden = false;
  cardSalvar.hidden = false;
  renderTudo();
  DbUI.definirCallbackRecarregar(renderTudo);
  DbUI.iniciar(document.getElementById("dbStatus"));

  function renderTudo() {
    renderRecebidas();
    renderTabela();
  }

  // ---------- Seção 1: ordens já recebidas — continuar parada ou finalizar ----------

  function notasEmChainAtiva() {
    return new Set(
      DB.dados.passagensTurno
        .filter((p) => p.status === "aberta" || p.status === "recebida")
        .map((p) => p.nota)
    );
  }

  function renderRecebidas() {
    if (!setorAtivo) { cardRecebidas.hidden = true; return; }

    const recebidas = DB.dados.passagensTurno
      .filter((p) => p.setor === setorAtivo && p.status === "recebida")
      .sort((a, b) => (a.inicioParadaEm || a.dataHora || "").localeCompare(b.inicioParadaEm || b.dataHora || ""));

    cardRecebidas.hidden = recebidas.length === 0;
    if (recebidas.length === 0) return;

    corpoRecebidas.innerHTML = recebidas.map((p) => {
      const nota = DB.buscarNota(p.nota);
      const inicio = p.inicioParadaEm || p.dataHora;
      return `
        <tr data-id="${escaparHtml(p.id)}">
          <td>${escaparHtml(p.nota)}</td>
          <td>${escaparHtml(nota?.ordem || "—")}</td>
          <td>${escaparHtml(nota?.equipamento || "—")}</td>
          <td>${inicio ? new Date(inicio).toLocaleString("pt-BR") : "—"}</td>
          <td><input type="text" class="inputDescRecebida" value="${escaparHtml(p.descricao)}" style="min-width:160px;"></td>
          <td>
            <div class="acaoRecebida">
              <button type="button" class="secundario btnContinuar">Continuar parada</button>
              <button type="button" class="perigo btnFinalizar">Finalizar</button>
            </div>
          </td>
        </tr>`;
    }).join("");

    corpoRecebidas.querySelectorAll(".btnContinuar").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const tr = btn.closest("tr");
        const id = tr.dataset.id;
        const passagem = DB.dados.passagensTurno.find((p) => p.id === id);
        if (!passagem) return;

        const agora = new Date();
        passagem.status = "aberta";
        passagem.dataHora = agora.toISOString();
        passagem.descricao = tr.querySelector(".inputDescRecebida").value.trim() || passagem.descricao;
        passagem.turno = usuario.turno || passagem.turno;
        passagem.registradoPor = usuario.nome;

        const notaInfo = DB.buscarNota(passagem.nota);
        const inicioParada = new Date(passagem.inicioParadaEm || passagem.dataHora);
        const tempoParadoMinutos = Math.max(0, Math.round((agora - inicioParada) / 60000));
        DB.registrarEventoPassagem(setorAtivo, usuario.turno, usuario.nome, [{
          nota: passagem.nota,
          ordem: notaInfo?.ordem || null,
          equipamento: notaInfo?.equipamento || null,
          descricao: passagem.descricao,
          tempoParadoMinutos,
        }]);

        btn.disabled = true;
        const ok = await DbUI.salvarDados(alerta);
        if (ok) renderTudo(); else btn.disabled = false;
      });
    });

    corpoRecebidas.querySelectorAll(".btnFinalizar").forEach((btn) => {
      btn.addEventListener("click", () => {
        const tr = btn.closest("tr");
        const id = tr.dataset.id;
        const passagem = DB.dados.passagensTurno.find((p) => p.id === id);
        if (!passagem) return;

        const acaoCell = tr.querySelector(".acaoRecebida");
        acaoCell.innerHTML = `
          <input type="datetime-local" class="inputHoraFim" value="${paraDatetimeLocal(new Date())}" style="width:auto;display:inline-block;">
          <button type="button" class="btnConfirmarFinalizar">Confirmar</button>
          <button type="button" class="secundario btnCancelarFinalizar">Cancelar</button>
        `;

        acaoCell.querySelector(".btnCancelarFinalizar").addEventListener("click", () => renderRecebidas());

        acaoCell.querySelector(".btnConfirmarFinalizar").addEventListener("click", async () => {
          const valorInput = acaoCell.querySelector(".inputHoraFim").value;
          if (!valorInput) return;
          const horaFim = new Date(valorInput);
          const inicio = new Date(passagem.inicioParadaEm || passagem.dataHora);

          passagem.status = "finalizada";
          passagem.finalizadaEm = horaFim.toISOString();
          passagem.tempoParadoMinutos = Math.max(0, Math.round((horaFim - inicio) / 60000));
          passagem.finalizadoPor = usuario.nome;

          const btnConfirmar = acaoCell.querySelector(".btnConfirmarFinalizar");
          btnConfirmar.disabled = true;
          const ok = await DbUI.salvarDados(alerta);
          if (ok) renderTudo(); else btnConfirmar.disabled = false;
        });
      });
    });
  }

  // ---------- Importar planilha ----------

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
      if (salvou) renderTudo();
    } catch (e) {
      resumoImportacao.hidden = false;
      resumoImportacao.innerHTML = `<div class="alerta erro">Erro ao ler a planilha: ${escaparHtml(e.message)}</div>`;
    }
  });

  // ---------- Seção 3: novas ordens do setor para passar ----------

  buscaTexto.addEventListener("input", renderTabela);
  chkTodosSetores.addEventListener("change", renderTabela);

  function renderTabela() {
    const termo = buscaTexto.value.trim().toLowerCase();
    const mostrarTodos = chkTodosSetores.checked;
    const jaAtivas = notasEmChainAtiva();

    let notas = DB.notas.slice()
      .filter((n) => !jaAtivas.has(n.nota))
      .sort((a, b) => (b.dataEntrada || "").localeCompare(a.dataEntrada || ""));

    if (!mostrarTodos && setorAtivo) {
      notas = notas.filter((n) => n.setor === setorAtivo);
    }
    if (termo) {
      notas = notas.filter((n) =>
        [n.nota, n.ordem, n.textoBreve, n.equipamento, n.loc].some((v) => (v || "").toString().toLowerCase().includes(termo))
      );
    }

    notas = notas.slice(0, 500);
    contagemLinhas.textContent = `${notas.length} linha(s)`;

    corpoTabela.innerHTML = notas.map((n) => {
      const podeMarcar = n.setor === setorAtivo;
      const status = n.statusUsuario || n.statusSistema || "—";
      return `
        <tr data-nota="${escaparHtml(n.nota)}">
          <td><input type="checkbox" class="chkOrdem" ${podeMarcar ? "" : "disabled"}></td>
          <td>${escaparHtml(n.nota)}</td>
          <td>${escaparHtml(n.ordem || "—")}</td>
          <td>${escaparHtml(n.textoBreve || "—")}</td>
          <td>${escaparHtml(n.equipamento || "—")}</td>
          <td><span class="tag setor-${n.setor}">${n.setor}</span></td>
          <td>${escaparHtml(status)}</td>
          <td>${formatarDataBR(n.dataEntrada)}${n.horaEntrada ? " " + escaparHtml(n.horaEntrada) : ""}</td>
          <td><input type="text" class="inputDescricao" placeholder="Descrição breve" disabled style="min-width:180px;"></td>
        </tr>`;
    }).join("");

    corpoTabela.querySelectorAll("tr").forEach((tr) => {
      const chk = tr.querySelector(".chkOrdem");
      const inputDesc = tr.querySelector(".inputDescricao");
      chk.addEventListener("change", () => { inputDesc.disabled = !chk.checked; if (chk.checked) inputDesc.focus(); });
    });
  }

  btnSalvarPassagem.addEventListener("click", async () => {
    if (!setorAtivo) return;
    const linhasMarcadas = Array.from(corpoTabela.querySelectorAll("tr")).filter((tr) => tr.querySelector(".chkOrdem").checked);

    if (linhasMarcadas.length === 0) {
      const confirmou = confirm(`Você não marcou nenhuma ordem para passar do setor ${setorAtivo}. Confirma que não há nada para passar neste turno?`);
      if (!confirmou) return;
    } else {
      const semDescricao = linhasMarcadas.some((tr) => !tr.querySelector(".inputDescricao").value.trim());
      if (semDescricao) {
        msgSalvar.textContent = "Preencha a descrição de todas as ordens marcadas.";
        msgSalvar.style.color = "var(--vermelho-alerta)";
        return;
      }
    }

    const agora = new Date().toISOString();
    const ordensParaEvento = [];

    for (const tr of linhasMarcadas) {
      const nota = tr.dataset.nota;
      const descricao = tr.querySelector(".inputDescricao").value.trim();
      DB.dados.passagensTurno.push({
        id: gerarId("pt"),
        nota,
        setor: setorAtivo,
        turno: usuario.turno || null,
        descricao,
        dataHora: agora,
        inicioParadaEm: agora,
        status: "aberta",
        recebidoPor: null,
        recebidoEm: null,
        finalizadaEm: null,
        tempoParadoMinutos: null,
        finalizadoPor: null,
        registradoPor: usuario.nome,
      });
      const notaInfo = DB.buscarNota(nota);
      ordensParaEvento.push({
        nota,
        ordem: notaInfo?.ordem || null,
        equipamento: notaInfo?.equipamento || null,
        descricao,
        tempoParadoMinutos: 0, // acabou de começar a parar agora
      });
    }

    if (ordensParaEvento.length > 0) {
      DB.registrarEventoPassagem(setorAtivo, usuario.turno, usuario.nome, ordensParaEvento);
    }

    // Salvar (com ou sem ordens, já confirmado acima) conclui a passagem de
    // turno do dia — substitui o antigo botão separado "Concluir passagem
    // de turno". Só se aplica a operador com turno definido (mesma regra
    // de antes); admin/gestor não têm essa trava.
    if (usuario.papel === "operador" && usuario.turno) {
      const data = dataDoTurnoAtual(usuario.turno);
      DB.confirmarPassagemTurno(usuario.nome, usuario.setor, usuario.turno, data);
    }

    btnSalvarPassagem.disabled = true;
    const ok = await DbUI.salvarDados(alerta);
    btnSalvarPassagem.disabled = false;

    if (ok) {
      msgSalvar.textContent = linhasMarcadas.length > 0
        ? `${linhasMarcadas.length} ordem(ns) registrada(s) na passagem de turno.`
        : "Passagem de turno concluída sem ordens pendentes.";
      msgSalvar.style.color = "var(--verde-ok)";
      renderTudo();
      renderInfoTurno();
    }
  });
})();
