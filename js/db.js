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

  /** Carrega os três bancos do servidor local. Chamar (com await) no início de cada página. */
  async carregarAutoLoad() {
    try {
      const [dados, notas, quadro] = await Promise.all([
        this._buscar("dados"),
        this._buscar("notas"),
        this._buscar("quadro"),
      ]);
      this.dados = dados;
      this.notas = notas;
      this.quadro = quadro;
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

  /** Recarrega os três bancos do servidor, descartando alterações locais não salvas. */
  async recarregarDoDisco() {
    await this.carregarAutoLoad();
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
