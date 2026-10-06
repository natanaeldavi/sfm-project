/* SFM — camada de "banco de dados".
 *
 * Dentro de bd/, ao lado dos .html:
 *   bd/usuarios.json          — todos os usuários, global (poucas escritas, só Admin)
 *   bd/notas.json             — notas/ordens do SAP, global (alimentado por import manual
 *                               e por uma ferramenta externa — continua um arquivo só)
 *   bd/dados-<Setor>.json     — passagensTurno/eficiencia/confirmacoesTurno/eventosPassagem
 *                               só daquele setor
 *   bd/quadro-<Setor>.json    — registros do quadro S/Q/D/C só daquele setor
 *
 * Leitura e escrita passam pelo backend local (Flask, ver ../app-python/) via
 * /api/usuarios, /api/notas, /api/dados/<setor>, /api/quadro/<setor> — o servidor
 * lê/escreve esses arquivos como arquivos comuns do sistema, então não pede
 * nenhuma permissão de pasta ao navegador.
 *
 * Por que por setor: antes era um dados.json/quadro.json único pra todos os
 * setores — cada página carrega o arquivo inteiro e regrava o arquivo inteiro ao
 * salvar, sem checar se mudou nesse meio tempo, então duas pessoas de setores
 * diferentes salvando por perto (ex.: dois operadores preenchendo a SFM no mesmo
 * horário) podiam sobrescrever o trabalho uma da outra. Dividido por setor, cada
 * gravação só toca o arquivo daquele setor. `DB.dados`/`DB.quadro` continuam com
 * a MESMA forma de sempre (usuarios/passagensTurno/etc., registros por
 * "Setor|data") — só a origem/destino dos dados mudou, pro resto do app ler/
 * escrever DB.dados/DB.quadro continua idêntico a antes.
 *
 * `bd/notas.json` fica de fora dessa divisão de propósito: quem escreve nele não
 * são pessoas usando o app ao mesmo tempo (é uma ferramenta externa de import
 * automático, que escreve direto no arquivo — ver bd/ no README), então não tem
 * a mesma concorrência que motivou dividir dados/quadro. Dividir ele também
 * quebraria essa ferramenta externa sem necessidade.
 */

const DB = {
  dados: { usuarios: [], passagensTurno: [], eficiencia: [], confirmacoesTurno: [], eventosPassagem: [] },
  notas: [],
  /* quadro.registros: mapa "setor|YYYY-MM-DD" -> { setor, data, acidente, quaseAcidente,
   * retrabalho, falhaFornecedor }, cada campo true/false/undefined (undefined = não marcado
   * ainda). Preenchimento manual (ver quadro-sfm.html) — Delivery e Cost do mesmo quadro são
   * calculados automaticamente a partir de notas/passagensTurno e não usam este arquivo. Em
   * memória continua unificado (prefixo "setor|"), mesmo vindo de arquivos separados por
   * setor — ver carregarAutoLoad/salvarQuadro. */
  quadro: { registros: {} },
  autoLoadOk: false,

  /** Setores cujo dados-<setor>.json/quadro-<setor>.json estão carregados em DB.dados/DB.quadro
   * nesta sessão — salvarDados/salvarQuadro só escrevem os arquivos desses setores, nunca os
   * outros (escrever um setor que não foi carregado sobrescreveria o arquivo dele com dados
   * vazios/parciais). Ver _escopoSetores. */
  _setoresCarregados: [],

  async _buscar(caminho) {
    const resp = await fetch(`/api/${caminho}`);
    if (!resp.ok) throw new Error(`Falha ao carregar ${caminho}`);
    return resp.json();
  },

  async _salvar(caminho, valor) {
    const resp = await fetch(`/api/${caminho}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(valor),
    });
    if (!resp.ok) throw new Error(`Falha ao salvar ${caminho}`);
  },

  _ultimasOpcoesCarga: {},

  /**
   * `opcoes.setor` decide quais setores de dados/quadro carregar:
   *  - omitido (undefined): todos os setores (usado por telas que precisam ver todos de uma
   *    vez, ex.: Relatórios) — é o padrão mais seguro quando não se sabe o escopo certo.
   *  - null: nenhum (usado por telas que só mexem em dados globais, ex.: Admin/usuarios).
   *  - "Gasolina" (um nome de SETORES): só aquele setor (o caso comum — cada operador só
   *    mexe no próprio setor).
   */
  _escopoSetores(setorOpcao) {
    if (setorOpcao === null) return [];
    if (setorOpcao === undefined) return SETORES.slice();
    return [setorOpcao];
  },

  /**
   * Carrega bd/usuarios.json (sempre) e, sob pedido, bd/notas.json e/ou
   * bd/quadro-<setor>.json, mais bd/dados-<setor>.json (sempre, mas só dos
   * setores em `opcoes.setor` — ver _escopoSetores) — chamar (com await) no
   * início de cada página, passando { notas: true } e/ou { quadro: true } só se
   * a página realmente usa DB.notas/DB.quadro, e { setor } com o setor relevante
   * (ou null se a página não usa setor nenhum). Ver nota sobre notas.json no
   * topo do arquivo.
   */
  async carregarAutoLoad(opcoes = {}) {
    this._ultimasOpcoesCarga = opcoes;
    const setores = this._escopoSetores(opcoes.setor);
    this._setoresCarregados = setores;
    try {
      const promessas = { usuarios: this._buscar("usuarios") };
      if (opcoes.notas) promessas.notas = this._buscar("notas");
      for (const s of setores) {
        promessas[`dados:${s}`] = this._buscar(`dados/${s}`);
        if (opcoes.quadro) promessas[`quadro:${s}`] = this._buscar(`quadro/${s}`);
      }

      const chaves = Object.keys(promessas);
      const resultados = await Promise.all(chaves.map((k) => promessas[k]));
      const porChave = {};
      chaves.forEach((k, i) => { porChave[k] = resultados[i]; });

      this.dados = { usuarios: porChave.usuarios || [], passagensTurno: [], eficiencia: [], confirmacoesTurno: [], eventosPassagem: [] };
      for (const s of setores) {
        const d = porChave[`dados:${s}`] || {};
        this.dados.passagensTurno.push(...(d.passagensTurno || []));
        this.dados.eficiencia.push(...(d.eficiencia || []));
        this.dados.confirmacoesTurno.push(...(d.confirmacoesTurno || []));
        this.dados.eventosPassagem.push(...(d.eventosPassagem || []));
      }

      if (opcoes.notas) this.notas = porChave.notas || [];

      if (opcoes.quadro) {
        this.quadro = { registros: {} };
        for (const s of setores) {
          const q = porChave[`quadro:${s}`] || { registros: {} };
          for (const [data, registro] of Object.entries(q.registros || {})) {
            this.quadro.registros[this._chaveQuadro(s, data)] = registro;
          }
        }
      }

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

  /** Só grava bd/usuarios.json e os bd/dados-<setor>.json dos setores carregados nesta sessão
   * (ver _setoresCarregados) — nunca os outros setores, pra não sobrescrevê-los com dados que
   * esta sessão nunca carregou de verdade. */
  async salvarDados() {
    await this._salvar("usuarios", this.dados.usuarios);
    for (const s of this._setoresCarregados) {
      await this._salvar(`dados/${s}`, {
        passagensTurno: this.dados.passagensTurno.filter((p) => p.setor === s),
        eficiencia: this.dados.eficiencia.filter((e) => e.setor === s),
        confirmacoesTurno: this.dados.confirmacoesTurno.filter((c) => c.setor === s),
        eventosPassagem: this.dados.eventosPassagem.filter((e) => e.setor === s),
      });
    }
  },

  async salvarNotas() {
    await this._salvar("notas", this.notas);
  },

  /** Só grava os bd/quadro-<setor>.json dos setores carregados nesta sessão (mesma lógica de salvarDados). */
  async salvarQuadro() {
    for (const s of this._setoresCarregados) {
      const prefixo = this._chaveQuadro(s, "");
      const registros = {};
      for (const [chave, registro] of Object.entries(this.quadro.registros)) {
        if (chave.startsWith(prefixo)) registros[chave.slice(prefixo.length)] = registro;
      }
      await this._salvar(`quadro/${s}`, { registros });
    }
  },

  /** Recarrega os bancos do servidor (os mesmos da última chamada a carregarAutoLoad), descartando alterações locais não salvas. */
  async recarregarDoDisco() {
    await this.carregarAutoLoad(this._ultimasOpcoesCarga);
  },

  // ---------- Consultas auxiliares ----------

  /** Número pessoal = identificador de login (único), diferente do nome (só exibição). */
  buscarUsuarioPorCodigo(codigo) {
    const alvo = (codigo || "").trim().toLowerCase();
    return this.dados.usuarios.find((u) => (u.codigo || "").trim().toLowerCase() === alvo) || null;
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

  /**
   * Próximo número sequencial de evento de passagem. Antes da divisão por setor (ver topo do
   * arquivo) isso era global entre todos os setores; agora, como cada sessão só carrega os
   * eventos do(s) setor(es) em DB._setoresCarregados, a numeração vira efetivamente por
   * setor (cada setor tem sua própria sequência, podendo repetir número com outro setor) —
   * é só um número de referência pra exibição (Relatórios), não uma chave de verdade (essa é
   * o `id`), então essa mudança é segura.
   */
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
