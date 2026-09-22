/* SFM — camada de "banco de dados".
 *
 * Três arquivos, dentro de bd/, ao lado dos .html: bd/dados.json (usuarios,
 * passagensTurno, eficiencia, confirmacoesTurno, eventosPassagem),
 * bd/notas.json (notas/ordens importadas do SAP) e bd/quadro.json
 * (registros manuais do quadro S/Q/D/C).
 *
 * Leitura e escrita passam pelo backend local (Flask, ver ../app-python/) via
 * /api/dados, /api/notas, /api/quadro — o servidor lê/escreve esses arquivos
 * como arquivos comuns do sistema, então não pede nenhuma permissão de pasta
 * ao navegador.
 *
 * bd/notas.json só cresce (acumula toda nota já importada do SAP, nunca é
 * podado) — num setor com bastante movimento ele fica bem maior que os
 * outros dois arquivos, e como bd/ normalmente é uma pasta de rede, ler
 * esse arquivo tem um custo real (round-trip de rede a cada leitura). Por
 * isso carregarAutoLoad só busca notas.json/quadro.json nas páginas que
 * realmente usam DB.notas/DB.quadro (Admin, Quadro SFM, Relatórios) — o
 * restante (login, menu, passar/receber turno) carrega só dados.json.
 */

const DB = {
  dados: { usuarios: [], passagensTurno: [], eficiencia: [], confirmacoesTurno: [], eventosPassagem: [] },
  notas: [],
  /* quadro.registros: mapa "setor|YYYY-MM-DD" -> { setor, data, acidente, quaseAcidente,
   * retrabalho, falhaFornecedor }, cada campo true/false/undefined (undefined = não marcado
   * ainda). Preenchimento manual (ver quadro-sfm.html) — Delivery e Cost do mesmo quadro são
   * calculados automaticamente a partir de notas/passagensTurno e não usam este arquivo. */
  quadro: { registros: {} },
  autoLoadOk: false,

  async _buscar(chave) {
    const resp = await fetch(`/api/${chave}`);
    if (!resp.ok) throw new Error(`Falha ao carregar ${chave}`);
    return resp.json();
  },

  async _salvar(chave, valor) {
    const resp = await fetch(`/api/${chave}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(valor),
    });
    if (!resp.ok) throw new Error(`Falha ao salvar ${chave}`);
  },

  _ultimasOpcoesCarga: {},

  /**
   * Carrega bd/dados.json (sempre) e, sob pedido, bd/notas.json e/ou
   * bd/quadro.json — chamar (com await) no início de cada página, passando
   * { notas: true } e/ou { quadro: true } só se a página realmente usa
   * DB.notas/DB.quadro. Ver nota sobre notas.json no topo do arquivo.
   */
  async carregarAutoLoad(opcoes = {}) {
    this._ultimasOpcoesCarga = opcoes;
    try {
      const promessas = { dados: this._buscar("dados") };
      if (opcoes.notas) promessas.notas = this._buscar("notas");
      if (opcoes.quadro) promessas.quadro = this._buscar("quadro");

      const chaves = Object.keys(promessas);
      const resultados = await Promise.all(chaves.map((k) => promessas[k]));
      chaves.forEach((k, i) => { this[k] = resultados[i]; });

      this.autoLoadOk = true;
    } catch {
      this.autoLoadOk = false;
    }
    this._garantirEstrutura();
  },

  _garantirEstrutura() {
    if (!this.dados) this.dados = {};
    if (!Array.isArray(this.dados.usuarios)) this.dados.usuarios = [];
    if (!Array.isArray(this.dados.passagensTurno)) this.dados.passagensTurno = [];
    if (!Array.isArray(this.dados.eficiencia)) this.dados.eficiencia = [];
    if (!Array.isArray(this.dados.confirmacoesTurno)) this.dados.confirmacoesTurno = [];
    if (!Array.isArray(this.dados.eventosPassagem)) this.dados.eventosPassagem = [];
    if (!Array.isArray(this.notas)) this.notas = [];
    if (!this.quadro || typeof this.quadro !== "object") this.quadro = {};
    if (!this.quadro.registros || typeof this.quadro.registros !== "object") this.quadro.registros = {};
  },

  async salvarDados() {
    await this._salvar("dados", this.dados);
  },

  async salvarNotas() {
    await this._salvar("notas", this.notas);
  },

  async salvarQuadro() {
    await this._salvar("quadro", this.quadro);
  },

  /** Recarrega os bancos do servidor (os mesmos da última chamada a carregarAutoLoad), descartando alterações locais não salvas. */
  async recarregarDoDisco() {
    await this.carregarAutoLoad(this._ultimasOpcoesCarga);
  },

  // ---------- Consultas auxiliares ----------

  buscarUsuarioPorNome(nome) {
    const alvo = (nome || "").trim().toLowerCase();
    return this.dados.usuarios.find((u) => u.nome.trim().toLowerCase() === alvo) || null;
  },

  buscarNota(numeroNota) {
    return this.notas.find((n) => n.nota === numeroNota) || null;
  },

  /**
   * Importa notas da planilha do SAP em `DB.notas` (chave = Nota): insere
   * as que ainda não existem e ATUALIZA os campos vindos do SAP das que já
   * existiam — continua sendo uma linha só por Nota (nunca duplica), só
   * que os dados dela são atualizados com a nova leitura. Isso é
   * importante porque o SAP é a fonte de verdade: se uma nota tinha vindo
   * incompleta numa importação anterior (ex.: sem Data de entrada), uma
   * reimportação da mesma planilha corrige a linha existente em vez de
   * ficar presa com o dado velho para sempre.
   * Retorna {inseridas, atualizadas}.
   */
  mesclarNotasImportadas(notasImportadas) {
    const porNota = new Map(this.notas.map((n) => [n.nota, n]));
    let inseridas = 0;
    let atualizadas = 0;
    for (const nova of notasImportadas) {
      if (!nova.nota) continue;
      const existente = porNota.get(nova.nota);
      if (!existente) {
        this.notas.push(nova);
        porNota.set(nova.nota, nova);
        inseridas++;
      } else {
        Object.assign(existente, nova);
        atualizadas++;
      }
    }
    return { inseridas, atualizadas };
  },

  /** Chave usada no mapa quadro.registros. */
  _chaveQuadro(setor, dataISO) {
    return `${setor}|${dataISO}`;
  },

  buscarRegistroQuadro(setor, dataISO) {
    return this.quadro.registros[this._chaveQuadro(setor, dataISO)] || null;
  },

  /** Marca/desmarca um campo (acidente, quaseAcidente, retrabalho, falhaFornecedor) de um dia. valor: true, false ou null (limpar). */
  definirRegistroQuadro(setor, dataISO, campo, valor) {
    const chave = this._chaveQuadro(setor, dataISO);
    let registro = this.quadro.registros[chave];
    if (!registro) {
      registro = { setor, data: dataISO };
      this.quadro.registros[chave] = registro;
    }
    if (valor === null) delete registro[campo];
    else registro[campo] = valor;
  },

  /** Já existe confirmação de passagem de turno concluída para esse setor/turno/dia? */
  passagemTurnoConcluida(setor, turno, data) {
    return this.dados.confirmacoesTurno.some(
      (c) => c.tipo === "passagem" && c.setor === setor && c.turno === turno && c.data === data
    );
  },

  /** Já existe confirmação de SFM (assistente por etapas) concluída para esse setor, no dia de hoje (data da reunião, não dos dias cobertos)? */
  sfmConcluidaHoje(setor, data) {
    return this.dados.confirmacoesTurno.some(
      (c) => c.tipo === "sfm" && c.setor === setor && c.data === data
    );
  },

  /** Registra a conclusão da SFM de hoje (idempotente — não duplica se já existir a mesma chave). */
  confirmarSfm(usuarioNome, setor, data) {
    if (this.sfmConcluidaHoje(setor, data)) return;
    this.dados.confirmacoesTurno.push({
      id: gerarId("ct"),
      setor,
      turno: null,
      data,
      tipo: "sfm",
      usuario: usuarioNome,
      concluidoEm: new Date().toISOString(),
    });
  },

  /** Registra a conclusão da passagem de turno (idempotente — não duplica se já existir a mesma chave). */
  confirmarPassagemTurno(usuarioNome, setor, turno, data) {
    if (this.passagemTurnoConcluida(setor, turno, data)) return;
    this.dados.confirmacoesTurno.push({
      id: gerarId("ct"),
      setor,
      turno,
      data,
      tipo: "passagem",
      usuario: usuarioNome,
      concluidoEm: new Date().toISOString(),
    });
  },

  // ---------- Eventos de passagem de turno (log permanente, nunca sobrescrito) ----------

  /** Próximo número sequencial de evento de passagem (global, não por setor). */
  _proximoNumeroEventoPassagem() {
    return this.dados.eventosPassagem.reduce((max, e) => Math.max(max, e.numero || 0), 0) + 1;
  },

  /**
   * Registra um evento de passagem de turno: quem passou, do turno pra qual
   * turno, quando, e a lista de ordens incluídas com o tempo parado até
   * aquele momento (snapshot — continua correto no relatório mesmo que a
   * ordem seja repassada de novo ou finalizada depois). Chamado tanto ao
   * passar ordens novas (passar-turno.js: "Salvar passagem") quanto ao
   * repassar uma ordem recebida sem finalizar ("Continuar parada").
   */
  registrarEventoPassagem(setor, turnoOrigem, passadoPor, ordens) {
    const evento = {
      id: gerarId("ep"),
      numero: this._proximoNumeroEventoPassagem(),
      setor,
      turnoOrigem: turnoOrigem || null,
      turnoDestino: turnoOrigem ? proximoTurno(turnoOrigem) : null,
      passadoPor,
      passadoEm: new Date().toISOString(),
      recebidoPor: null,
      recebidoEm: null,
      ordens,
    };
    this.dados.eventosPassagem.push(evento);
    return evento;
  },

  /**
   * Fecha (marca como recebidos) todos os eventos de passagem ainda
   * pendentes do setor — chamado no "Receber tudo" de receber-turno.js, que
   * sempre recebe em lote tudo que está aberto no setor de uma vez.
   */
  marcarEventosPassagemRecebidos(setor, recebidoPor) {
    const agora = new Date().toISOString();
    const pendentes = this.dados.eventosPassagem.filter((e) => e.setor === setor && !e.recebidoEm);
    for (const e of pendentes) {
      e.recebidoPor = recebidoPor;
      e.recebidoEm = agora;
    }
  },
};
