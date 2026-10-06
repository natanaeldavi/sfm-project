/* SFM — passar-turno.html (versão piloto)
 *
 * Enquanto a importação automática de ordens do SAP não está disponível
 * durante o turno, cada ordem que está sendo passada é cadastrada
 * manualmente aqui: Defeito, Máquina, Célula e Descrição — sem número de
 * nota/ordem nem código de máquina. A planilha do SAP continua existindo,
 * mas passou a ser importada uma vez por dia na tela SFM (quadro-sfm.js),
 * na hora da reunião — não mais a cada passagem de turno.
 *
 * Antes do cadastro manual, uma lista (ver cardOrdensAbertas) mostra as notas
 * do setor ainda abertas (sem Data fim) do dia mais recente importado — cada
 * linha tem um campo Defeito (obrigatório) e Célula (opcional) e seu próprio
 * botão Adicionar, que já joga direto pra lista de pendentes abaixo, sem
 * precisar passar pelos campos do cadastro manual.
 */

(async function () {
  const usuario = Auth.exigirLogin();
  if (!usuario) return;
  Auth.garantirSetorOperador(usuario);

  const setorAtivo = Auth.getSetorAtivo();
  await DB.carregarAutoLoad({ notas: true, setor: setorAtivo });
  Auth.atualizarUsuarioDoBanco(usuario);
  if (Auth.aplicarGateRecebimento(usuario)) return;

  montarTopbar(document.getElementById("topbar"), usuario, "Passar Turno");

  const alerta = document.getElementById("alerta");
  if (!setorAtivo) {
    mostrarAlerta(alerta, "aviso", "Nenhum setor selecionado. Volte ao menu e escolha um setor.");
  }

  const subbar = document.getElementById("subbar");

  const cardRecebidas = document.getElementById("cardRecebidas");
  const corpoRecebidas = document.getElementById("corpoRecebidas");

  const campoDefeito = document.getElementById("campoDefeito");
  const campoMaquina = document.getElementById("campoMaquina");
  const campoCelula = document.getElementById("campoCelula");
  const campoHoraDefeito = document.getElementById("campoHoraDefeito");
  const campoDescricao = document.getElementById("campoDescricao");
  const btnAdicionarOrdem = document.getElementById("btnAdicionarOrdem");
  const msgNovaOrdem = document.getElementById("msgNovaOrdem");
  const cardOrdensAbertas = document.getElementById("cardOrdensAbertas");
  const corpoOrdensAbertas = document.getElementById("corpoOrdensAbertas");
  const msgOrdensAbertas = document.getElementById("msgOrdensAbertas");

  campoHoraDefeito.value = paraDatetimeLocal(new Date());

  const cardTabela = document.getElementById("cardTabela");
  const cardSalvar = document.getElementById("cardSalvar");
  const corpoTabela = document.getElementById("corpoTabela");
  const contagemLinhas = document.getElementById("contagemLinhas");
  const btnSalvarPassagem = document.getElementById("btnSalvarPassagem");
  const msgSalvar = document.getElementById("msgSalvar");
  const turnoInfo = document.getElementById("turnoInfo");

  /** Ordens digitadas nesta sessão, ainda não salvas. */
  let pendentes = [];

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
    renderTabelaPendentes();
    renderOrdensAbertas();
  }

  // ---------- Seção 2: ordens abertas do dia (planilha do SAP) — lista com botão Adicionar por linha ----------

  /**
   * Janela de tempo das "ordens abertas" mostradas aqui — não é "o dia mais recente que a
   * planilha foi importada" (isso sempre seria só o dia da própria importação), e sim um período
   * fixo que sempre termina hoje às 06:00 (horário em que a SFM da manhã é feita) e começa duas
   * noites antes às 22:30 — cobrindo as passagens de turno desde então. Numa segunda-feira a
   * janela recua mais (começa 4 dias antes, não 2), pra cobrir também sexta/sábado/domingo, sem
   * SFM nesses dias — mesmo princípio de calcularJanelaSfm (ver js/util.js), só que aqui o fim é
   * sempre "hoje 06:00" (não "ontem").
   */
  function janelaOrdensAbertas(agora) {
    const ref = agora || new Date();
    const fim = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate(), 6, 0, 0, 0);
    const diasVoltar = ref.getDay() === 1 ? 4 : 2; // segunda-feira (getDay()===1): recua até a sexta
    const inicio = new Date(fim);
    inicio.setDate(inicio.getDate() - diasVoltar);
    inicio.setHours(22, 30, 0, 0);
    return { inicio, fim };
  }

  function quandoDaNota(n) {
    return new Date(`${n.dataEntrada}T${n.horaEntrada || "00:00"}:00`);
  }

  /** Notas do setor ainda sem Data fim (em aberto), com abertura dentro da janela de tempo acima,
   * e que ainda não foram adicionadas à lista de pendentes. */
  function ordensAbertasDoUltimoDia() {
    const { inicio, fim } = janelaOrdensAbertas();
    const jaAdicionadas = new Set(pendentes.map((p) => p.notaOrigem).filter(Boolean));
    return DB.notas
      .filter((n) => n.setor === setorAtivo && !n.dataFim && n.dataEntrada && !jaAdicionadas.has(n.nota))
      .filter((n) => { const q = quandoDaNota(n); return !isNaN(q) && q >= inicio && q <= fim; })
      .sort((a, b) => quandoDaNota(a) - quandoDaNota(b));
  }

  function renderOrdensAbertas() {
    const ordens = ordensAbertasDoUltimoDia();
    cardOrdensAbertas.hidden = ordens.length === 0;
    msgOrdensAbertas.textContent = "";

    corpoOrdensAbertas.innerHTML = ordens.map((n) => `
      <tr data-nota="${escaparHtml(n.nota)}">
        <td>${escaparHtml(n.nota)}</td>
        <td>${escaparHtml(n.ordem || "—")}</td>
        <td>${escaparHtml(n.nomeEquipamento || n.equipamento || "—")}</td>
        <td>${escaparHtml(n.textoBreve || "—")}</td>
        <td>${escaparHtml(n.horaEntrada || "—")}</td>
        <td><input type="text" class="inputDefeitoOrdemAberta" placeholder="Ex.: vazamento hidráulico"></td>
        <td><input type="text" class="inputCelulaOrdemAberta" placeholder="Opcional"></td>
        <td><button type="button" class="btnAdicionarOrdemAberta">Adicionar</button></td>
      </tr>`).join("");

    corpoOrdensAbertas.querySelectorAll(".btnAdicionarOrdemAberta").forEach((btn) => {
      btn.addEventListener("click", () => {
        const tr = btn.closest("tr");
        const numNota = tr.dataset.nota;
        const nota = DB.notas.find((n) => n.nota === numNota);
        if (!nota) return;

        const defeito = tr.querySelector(".inputDefeitoOrdemAberta").value.trim();
        if (!defeito) {
          msgOrdensAbertas.textContent = "Preencha o Defeito dessa ordem antes de adicionar.";
          msgOrdensAbertas.style.color = "var(--vermelho-alerta)";
          return;
        }
        const celula = tr.querySelector(".inputCelulaOrdemAberta").value.trim();

        const horaDefeito = quandoDaNota(nota);
        const inicioParadaEm = (!isNaN(horaDefeito) && horaDefeito <= new Date()) ? horaDefeito.toISOString() : new Date().toISOString();

        pendentes.push({
          defeito,
          maquina: nota.nomeEquipamento || nota.equipamento || "",
          celula,
          descricao: nota.textoBreve || "",
          inicioParadaEm,
          notaOrigem: nota.nota,
        });
        msgOrdensAbertas.textContent = "";
        renderTabelaPendentes();
        renderOrdensAbertas();
      });
    });
  }

  // ---------- Seção 1: ordens já recebidas — continuar parada ou finalizar ----------

  function renderRecebidas() {
    if (!setorAtivo) { cardRecebidas.hidden = true; return; }

    const recebidas = DB.dados.passagensTurno
      .filter((p) => p.setor === setorAtivo && p.status === "recebida")
      .sort((a, b) => (a.inicioParadaEm || a.dataHora || "").localeCompare(b.inicioParadaEm || b.dataHora || ""));

    cardRecebidas.hidden = recebidas.length === 0;
    if (recebidas.length === 0) return;

    corpoRecebidas.innerHTML = recebidas.map((p) => {
      const inicio = p.inicioParadaEm || p.dataHora;
      return `
        <tr data-id="${escaparHtml(p.id)}">
          <td>${escaparHtml(p.defeito || "—")}</td>
          <td>${escaparHtml(p.maquina || "—")}</td>
          <td>${escaparHtml(p.celula || "—")}</td>
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

        const inicioParada = new Date(passagem.inicioParadaEm || passagem.dataHora);
        const tempoParadoMinutos = Math.max(0, Math.round((agora - inicioParada) / 60000));
        DB.registrarEventoPassagem(setorAtivo, usuario.turno, usuario.nome, [{
          defeito: passagem.defeito || null,
          maquina: passagem.maquina || null,
          celula: passagem.celula || null,
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

  // ---------- Seção 2/3: cadastro manual de novas ordens para passar ----------

  btnAdicionarOrdem.addEventListener("click", () => {
    const defeito = campoDefeito.value.trim();
    const maquina = campoMaquina.value.trim();
    const celula = campoCelula.value.trim();
    const descricao = campoDescricao.value.trim();
    const horaDefeitoValor = campoHoraDefeito.value;

    if (!defeito || !maquina || !descricao || !horaDefeitoValor) {
      msgNovaOrdem.textContent = "Preencha ao menos Defeito, Máquina, Horário do defeito e Descrição.";
      msgNovaOrdem.style.color = "var(--vermelho-alerta)";
      return;
    }

    const horaDefeito = new Date(horaDefeitoValor);
    if (horaDefeito > new Date()) {
      msgNovaOrdem.textContent = "O horário do defeito não pode estar no futuro.";
      msgNovaOrdem.style.color = "var(--vermelho-alerta)";
      return;
    }

    pendentes.push({ defeito, maquina, celula, descricao, inicioParadaEm: horaDefeito.toISOString(), notaOrigem: null });
    campoDefeito.value = "";
    campoMaquina.value = "";
    campoCelula.value = "";
    campoDescricao.value = "";
    campoHoraDefeito.value = paraDatetimeLocal(new Date());
    campoDefeito.focus();
    msgNovaOrdem.textContent = "";
    renderTabelaPendentes();
    renderOrdensAbertas();
  });

  function renderTabelaPendentes() {
    contagemLinhas.textContent = `${pendentes.length} ordem(ns)`;

    corpoTabela.innerHTML = pendentes.length
      ? pendentes.map((p, i) => `
        <tr data-idx="${i}">
          <td>${escaparHtml(p.defeito)}</td>
          <td>${escaparHtml(p.maquina)}</td>
          <td>${escaparHtml(p.celula || "—")}</td>
          <td>${new Date(p.inicioParadaEm).toLocaleString("pt-BR")}</td>
          <td>${escaparHtml(p.descricao)}</td>
          <td><button type="button" class="secundario btnRemoverPendente">Remover</button></td>
        </tr>`).join("")
      : `<tr><td colspan="6" style="text-align:center;color:var(--texto-suave);">Nenhuma ordem adicionada ainda.</td></tr>`;

    corpoTabela.querySelectorAll(".btnRemoverPendente").forEach((btn) => {
      btn.addEventListener("click", () => {
        const idx = Number(btn.closest("tr").dataset.idx);
        pendentes.splice(idx, 1);
        renderTabelaPendentes();
        renderOrdensAbertas();
      });
    });
  }

  btnSalvarPassagem.addEventListener("click", async () => {
    if (!setorAtivo) return;

    if (pendentes.length === 0) {
      const confirmou = confirm(`Você não adicionou nenhuma ordem para passar do setor ${setorAtivo}. Confirma que não há nada para passar neste turno?`);
      if (!confirmou) return;
    }

    const agoraDate = new Date();
    const agora = agoraDate.toISOString();
    const ordensParaEvento = [];

    for (const p of pendentes) {
      DB.dados.passagensTurno.push({
        id: gerarId("pt"),
        setor: setorAtivo,
        turno: usuario.turno || null,
        defeito: p.defeito,
        maquina: p.maquina,
        celula: p.celula || null,
        descricao: p.descricao,
        dataHora: agora,
        inicioParadaEm: p.inicioParadaEm,
        status: "aberta",
        recebidoPor: null,
        recebidoEm: null,
        finalizadaEm: null,
        tempoParadoMinutos: null,
        finalizadoPor: null,
        registradoPor: usuario.nome,
        notaOrigem: p.notaOrigem || null,
      });
      // Tempo parado até o momento de passar, calculado a partir do
      // horário real do defeito (não de agora) — a máquina pode já estar
      // parada há um tempo quando a ordem é cadastrada.
      const tempoParadoMinutos = Math.max(0, Math.round((agoraDate - new Date(p.inicioParadaEm)) / 60000));
      ordensParaEvento.push({
        defeito: p.defeito,
        maquina: p.maquina,
        celula: p.celula || null,
        descricao: p.descricao,
        tempoParadoMinutos,
        notaOrigem: p.notaOrigem || null,
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

    const quantidade = pendentes.length;
    btnSalvarPassagem.disabled = true;
    const ok = await DbUI.salvarDados(alerta);
    btnSalvarPassagem.disabled = false;

    if (ok) {
      pendentes = [];
      msgSalvar.textContent = quantidade > 0
        ? `${quantidade} ordem(ns) registrada(s) na passagem de turno.`
        : "Passagem de turno concluída sem ordens pendentes.";
      msgSalvar.style.color = "var(--verde-ok)";
      renderTudo();
      renderInfoTurno();
    }
  });
})();
