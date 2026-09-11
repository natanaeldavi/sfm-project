/* SFM — camada de "banco de dados".
 *
 * Agora são DOIS arquivos de banco, dentro da pasta bd/, ao lado dos .html:
 *   bd/dados.json  -> usuarios, passagensTurno, eficiencia
 *   bd/notas.json  -> notas/ordens importadas do SAP (arquivo separado,
 *                      porque cresce muito mais rápido que o resto e é
 *                      importado de planilha, então convém isolar)
 *
 * LEITURA nunca pede permissão nem "vincular" nada: cada página carrega
 * automaticamente bd/dados.js e bd/notas.js via <script src>. Esses .js são
 * "espelhos" dos .json, gerados automaticamente a cada salvamento — cada um
 * só contém `window.__SFM_DADOS__ = {...}` / `window.__SFM_NOTAS__ = [...]`.
 * Um <script src> não passa pelas mesmas restrições de segurança que
 * fetch()/XHR têm para arquivos abertos com file://, então funciona sem
 * pedir nada, em qualquer navegador. É por isso que cada banco tem dois
 * arquivos (o .json "de verdade", legível/editável à mão se precisar, e o
 * .js "espelho" que o app usa pra ler) — eles são escritos juntos sempre
 * que o app salva. NÃO edite os arquivos .js na mão (edite o .json e depois
 * abra o sistema uma vez com a pasta "bd" vinculada para regenerar o .js).
 *
 * ESCRITA (salvar) continua exigindo permissão do navegador — não tem como
 * uma página aberta localmente escrever num arquivo sem o usuário autorizar
 * explicitamente antes; é proteção de segurança do próprio navegador, não
 * dá pra contornar. Mas agora isso só é pedido na hora em que alguém
 * realmente salva algo pela primeira vez (importar planilha, criar
 * usuário, passar turno, etc.) — nunca mais para simplesmente abrir e
 * olhar as telas. Depois da primeira vez, o navegador lembra (o handle da
 * pasta fica guardado no IndexedDB) e não pede de novo, a não ser que a
 * permissão expire (comportamento do navegador).
 */

const BD_NOME_DADOS_JSON = "dados.json";
const BD_NOME_DADOS_JS = "dados.js";
const BD_NOME_NOTAS_JSON = "notas.json";
const BD_NOME_NOTAS_JS = "notas.js";
const BD_NOME_QUADRO_JSON = "quadro.json";
const BD_NOME_QUADRO_JS = "quadro.js";

const BD_IDB_NOME = "sfm-db";
const BD_IDB_STORE = "handles";
const BD_IDB_CHAVE_DIR = "bdDirHandle";

const DB = {
  dados: { usuarios: [], passagensTurno: [], eficiencia: [], confirmacoesTurno: [], eventosPassagem: [] },
  notas: [],
  /* quadro.registros: mapa "setor|YYYY-MM-DD" -> { setor, data, acidente, quaseAcidente,
   * retrabalho, falhaFornecedor }, cada campo true/false/undefined (undefined = não marcado
   * ainda). Preenchimento manual (ver quadro-sfm.html) — Delivery e Cost do mesmo quadro são
   * calculados automaticamente a partir de notas/passagensTurno e não usam este arquivo. */
  quadro: { registros: {} },
  autoLoadOk: false,

  dirHandle: null,
  lastReadDados: null,
  lastReadNotas: null,
  lastReadQuadro: null,

  suportaFS() {
    return typeof window.showDirectoryPicker === "function";
  },

  /** Pede armazenamento persistente ao navegador: reduz a chance de o Chrome
   * revogar sozinho a permissão da pasta "bd" (e limpar o IndexedDB onde o
   * handle fica salvo) por falta de uso ou pressão de espaço em disco.
   * Não substitui rodar via servidor local — só ajuda dentro do file://. */
  pedirArmazenamentoPersistente() {
    if (navigator.storage && navigator.storage.persist) {
      navigator.storage.persist().catch(() => {});
    }
  },

  /** Lê os dados carregados via <script src="bd/dados.js"> / <script src="bd/notas.js">. Síncrono, sem nenhuma permissão. */
  carregarAutoLoad() {
    this.pedirArmazenamentoPersistente();
    if (window.__SFM_DADOS__) {
      this.dados = window.__SFM_DADOS__;
      this.autoLoadOk = true;
    }
    if (window.__SFM_NOTAS__) {
      this.notas = window.__SFM_NOTAS__;
    }
    if (window.__SFM_QUADRO__) {
      this.quadro = window.__SFM_QUADRO__;
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

  // ---------- IndexedDB (guarda só o handle da pasta "bd", não os dados) ----------
  _abrirIdb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(BD_IDB_NOME, 1);
      req.onupgradeneeded = () => { req.result.createObjectStore(BD_IDB_STORE); };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  },

  async _salvarDirHandleIdb(handle) {
    const idb = await this._abrirIdb();
    return new Promise((resolve, reject) => {
      const tx = idb.transaction(BD_IDB_STORE, "readwrite");
      tx.objectStore(BD_IDB_STORE).put(handle, BD_IDB_CHAVE_DIR);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  },

  async _lerDirHandleIdb() {
    const idb = await this._abrirIdb();
    return new Promise((resolve, reject) => {
      const tx = idb.transaction(BD_IDB_STORE, "readonly");
      const req = tx.objectStore(BD_IDB_STORE).get(BD_IDB_CHAVE_DIR);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  },

  // ---------- Vínculo da pasta "bd" (só necessário para SALVAR) ----------

  /** Chamado no carregamento de cada página: tenta reconectar à pasta já vinculada antes, sem interação do usuário. */
  async tentarReconectarPastaSilenciosa() {
    if (!this.suportaFS()) return "sem-suporte";
    let handle;
    try { handle = await this._lerDirHandleIdb(); } catch { return "nao-vinculada"; }
    if (!handle) return "nao-vinculada";
    this.dirHandle = handle;
    const permissao = await handle.queryPermission({ mode: "readwrite" });
    return permissao === "granted" ? "conectada" : "precisa-permissao";
  },

  /** Chamado a partir de um clique do usuário (botão "Reconectar"). */
  async pedirPermissaoPastaSalva() {
    if (!this.dirHandle) return false;
    const p = await this.dirHandle.requestPermission({ mode: "readwrite" });
    return p === "granted";
  },

  /** Abre o seletor de pasta. Precisa ser chamado a partir de um gesto do usuário (clique). */
  async vincularNovaPasta() {
    const dir = await window.showDirectoryPicker({ id: "sfm-bd", mode: "readwrite" });
    await this._salvarDirHandleIdb(dir);
    this.dirHandle = dir;
    return true;
  },

  /**
   * Garante que há uma pasta vinculada com permissão de escrita, pedindo
   * (handle salvo -> permissão -> seletor de pasta, nessa ordem) se
   * necessário. Deve ser chamado a partir de um clique do usuário (ex.:
   * dentro do handler de um botão "Salvar"), senão o navegador recusa abrir
   * o seletor de pasta.
   */
  async garantirPastaParaEscrita() {
    if (!this.suportaFS()) return false;

    if (!this.dirHandle) {
      try { this.dirHandle = await this._lerDirHandleIdb(); } catch { /* segue sem handle salvo */ }
    }

    if (this.dirHandle) {
      const p = await this.dirHandle.queryPermission({ mode: "readwrite" });
      if (p === "granted") return true;
      const p2 = await this.dirHandle.requestPermission({ mode: "readwrite" });
      if (p2 === "granted") return true;
    }

    try {
      await this.vincularNovaPasta();
      return true;
    } catch {
      return false;
    }
  },

  // ---------- Escrita ----------

  async _lerArquivoDoDir(nome) {
    const fh = await this.dirHandle.getFileHandle(nome, { create: true });
    const file = await fh.getFile();
    return { fh, file };
  },

  async _escreverParJsonJs(nomeJson, nomeJs, valor, chaveGlobal, chaveLastRead) {
    const { fh, file } = await this._lerArquivoDoDir(nomeJson);
    if (this[chaveLastRead] !== null && file.size > 0 && file.lastModified !== this[chaveLastRead]) {
      throw new Error("CONFLITO");
    }

    const writable = await fh.createWritable();
    await writable.write(JSON.stringify(valor, null, 2));
    await writable.close();

    const fhJs = await this.dirHandle.getFileHandle(nomeJs, { create: true });
    const writableJs = await fhJs.createWritable();
    const jsonSeguro = JSON.stringify(valor).replace(/</g, "\\u003C");
    await writableJs.write(`window.${chaveGlobal} = ${jsonSeguro};\n`);
    await writableJs.close();

    const fileNovo = await fh.getFile();
    this[chaveLastRead] = fileNovo.lastModified;
  },

  async salvarDados() {
    const ok = await this.garantirPastaParaEscrita();
    if (!ok) throw new Error("SEM_PASTA");
    await this._escreverParJsonJs(BD_NOME_DADOS_JSON, BD_NOME_DADOS_JS, this.dados, "__SFM_DADOS__", "lastReadDados");
  },

  async salvarNotas() {
    const ok = await this.garantirPastaParaEscrita();
    if (!ok) throw new Error("SEM_PASTA");
    await this._escreverParJsonJs(BD_NOME_NOTAS_JSON, BD_NOME_NOTAS_JS, this.notas, "__SFM_NOTAS__", "lastReadNotas");
  },

  async salvarQuadro() {
    const ok = await this.garantirPastaParaEscrita();
    if (!ok) throw new Error("SEM_PASTA");
    await this._escreverParJsonJs(BD_NOME_QUADRO_JSON, BD_NOME_QUADRO_JS, this.quadro, "__SFM_QUADRO__", "lastReadQuadro");
  },

  /** Recarrega os dois arquivos direto da pasta vinculada, descartando alterações locais não salvas. */
  async recarregarDoDisco() {
    if (!this.dirHandle) throw new Error("SEM_PASTA");
    const { file: fDados } = await this._lerArquivoDoDir(BD_NOME_DADOS_JSON);
    if (fDados.size > 0) {
      this.dados = JSON.parse(await fDados.text());
      this.lastReadDados = fDados.lastModified;
    }
    const { file: fNotas } = await this._lerArquivoDoDir(BD_NOME_NOTAS_JSON);
    if (fNotas.size > 0) {
      this.notas = JSON.parse(await fNotas.text());
      this.lastReadNotas = fNotas.lastModified;
    }
    const { file: fQuadro } = await this._lerArquivoDoDir(BD_NOME_QUADRO_JSON);
    if (fQuadro.size > 0) {
      this.quadro = JSON.parse(await fQuadro.text());
      this.lastReadQuadro = fQuadro.lastModified;
    }
    this._garantirEstrutura();
  },

  // ---------- Modo manual (navegador sem File System Access API) ----------

  baixarDadosManual() {
    this._baixarArquivo(BD_NOME_DADOS_JSON, JSON.stringify(this.dados, null, 2));
    this._baixarArquivo(BD_NOME_DADOS_JS, `window.__SFM_DADOS__ = ${JSON.stringify(this.dados).replace(/</g, "\\u003C")};\n`);
  },

  baixarNotasManual() {
    this._baixarArquivo(BD_NOME_NOTAS_JSON, JSON.stringify(this.notas, null, 2));
    this._baixarArquivo(BD_NOME_NOTAS_JS, `window.__SFM_NOTAS__ = ${JSON.stringify(this.notas).replace(/</g, "\\u003C")};\n`);
  },

  baixarQuadroManual() {
    this._baixarArquivo(BD_NOME_QUADRO_JSON, JSON.stringify(this.quadro, null, 2));
    this._baixarArquivo(BD_NOME_QUADRO_JS, `window.__SFM_QUADRO__ = ${JSON.stringify(this.quadro).replace(/</g, "\\u003C")};\n`);
  },

  /** Baixa uma cópia das notas/ordens atuais com data/hora no nome (backup manual, não mexe em bd/notas.json). */
  baixarBackupNotas() {
    const agora = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    const carimbo = `${agora.getFullYear()}-${pad(agora.getMonth() + 1)}-${pad(agora.getDate())}_${pad(agora.getHours())}${pad(agora.getMinutes())}`;
    this._baixarArquivo(`backup-notas_${carimbo}.json`, JSON.stringify(this.notas, null, 2));
  },

  _baixarArquivo(nome, conteudo) {
    const blob = new Blob([conteudo], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = nome;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
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
