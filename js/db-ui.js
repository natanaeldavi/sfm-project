/* SFM — barra de status do banco de dados (reaproveitada em todas as páginas).
 *
 * A leitura (DB.carregarAutoLoad) já aconteceu antes desta barra existir — ela só
 * informa se os dados carregaram do servidor local, e os métodos salvarDados/
 * salvarNotas/salvarQuadro mostram um alerta simples se o salvamento falhar
 * (ex.: o backend Python não está rodando).
 */

const DbUI = {
  _container: null,
  _aoRecarregar: null,
  _overlay: null,
  _overlayContagem: 0,

  definirCallbackRecarregar(fn) {
    this._aoRecarregar = fn;
  },

  /** Mostra os 3 pontos flutuantes sobre fundo esbranquiçado enquanto uma operação com delay roda. Suporta chamadas aninhadas. */
  mostrarCarregando() {
    this._overlayContagem++;
    if (this._overlay) return;
    const div = document.createElement("div");
    div.className = "carregando-overlay";
    div.innerHTML = `<span class="ponto-flutuante"></span><span class="ponto-flutuante"></span><span class="ponto-flutuante"></span>`;
    document.body.appendChild(div);
    this._overlay = div;
  },

  /** Esconde o overlay quando a última operação pendente termina (com sucesso ou não). */
  esconderCarregando() {
    this._overlayContagem = Math.max(0, this._overlayContagem - 1);
    if (this._overlayContagem > 0) return;
    if (this._overlay) {
      this._overlay.remove();
      this._overlay = null;
    }
  },

  /** Executa fn() mostrando o overlay de carregamento durante a espera, escondendo ao final (sucesso ou erro). */
  async comCarregando(fn) {
    this.mostrarCarregando();
    try {
      return await fn();
    } finally {
      this.esconderCarregando();
    }
  },

  async iniciar(container) {
    this._container = container;
    if (!DB.autoLoadOk) {
      this._renderSemConexao();
      return;
    }
    this._renderConectado();
  },

  _renderSemConexao() {
    this._container.hidden = false;
    this._container.className = "db-status";
    this._container.innerHTML = `<span class="ponto"></span><span>
      Não foi possível carregar os dados do servidor local. Confirme que o SFM.exe está rodando.
    </span> <button type="button" class="secundario" id="btnRecarregarBd">Tentar de novo</button>`;
    this._container.querySelector("#btnRecarregarBd").addEventListener("click", async () => {
      await this.comCarregando(() => DB.recarregarDoDisco());
      this.iniciar(this._container);
      if (DB.autoLoadOk && this._aoRecarregar) this._aoRecarregar();
    });
  },

  /** Conectado: não mostra nada — só a mensagem de erro (sem conexão) precisa de destaque. */
  _renderConectado() {
    this._container.className = "db-status";
    this._container.innerHTML = "";
    this._container.hidden = true;
  },

  async salvarDados(alertaContainer) {
    return this._salvarGenerico(alertaContainer, () => DB.salvarDados());
  },

  async salvarNotas(alertaContainer) {
    return this._salvarGenerico(alertaContainer, () => DB.salvarNotas());
  },

  async salvarQuadro(alertaContainer) {
    return this._salvarGenerico(alertaContainer, () => DB.salvarQuadro());
  },

  async _salvarGenerico(alertaContainer, fnSalvar) {
    try {
      await this.comCarregando(fnSalvar);
      limparAlerta(alertaContainer);
      return true;
    } catch (e) {
      mostrarAlerta(alertaContainer, "erro",
        "Não foi possível salvar: " + e.message + ". Confirme que o SFM.exe está rodando e tente de novo.");
      return false;
    }
  },
};
