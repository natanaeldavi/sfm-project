/* SFM — barra de status do banco de dados (reaproveitada em todas as páginas).
 *
 * A leitura (DB.carregarAutoLoad) já aconteceu antes desta barra existir —
 * ela só informa se dá pra SALVAR agora ou não, e oferece o botão para
 * vincular/reconectar a pasta "bd" antecipadamente, se o usuário quiser.
 * Isso é só conveniência: as próprias funções de salvar (DbUI.salvarDados /
 * DbUI.salvarNotas) já pedem a pasta sozinhas na hora, se precisar.
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
      this._renderSemAutoLoad();
      return;
    }
    if (!DB.suportaFS()) {
      this._renderSemSuporte();
      return;
    }
    const status = await DB.tentarReconectarPastaSilenciosa();
    this._renderStatus(status);
  },

  _renderSemAutoLoad() {
    this._container.className = "db-status";
    this._container.innerHTML = `<span class="ponto"></span><span>
      Não encontrei "bd/dados.js". Confirme que a pasta "bd" está junto com os arquivos do sistema, na mesma pasta de rede.
    </span>`;
  },

  _renderSemSuporte() {
    this._container.className = "db-status conectado";
    this._container.innerHTML = `<span class="ponto"></span><span>
      Leitura automática ativa. Seu navegador não permite salvar direto na pasta de rede — ao salvar, os arquivos atualizados serão baixados; substitua os arquivos correspondentes na pasta "bd".
    </span>`;
  },

  _renderStatus(status) {
    if (status === "conectada") {
      this._container.className = "db-status conectado";
      this._container.innerHTML = `<span class="ponto"></span><span>Pasta "bd" vinculada — alterações salvam direto na pasta de rede.</span> <button type="button" class="secundario" id="btnRecarregarBd">Recarregar do disco</button>`;
      this._container.querySelector("#btnRecarregarBd").addEventListener("click", async () => {
        await this.comCarregando(() => DB.recarregarDoDisco());
        if (this._aoRecarregar) this._aoRecarregar();
      });
    } else if (status === "precisa-permissao") {
      this._container.className = "db-status";
      this._container.innerHTML = `<span class="ponto"></span><span>Leitura automática ativa. Para salvar, confirme o acesso à pasta "bd".</span> <button type="button" id="btnReconectarBd">Reconectar</button>`;
      this._container.querySelector("#btnReconectarBd").addEventListener("click", async () => {
        const ok = await DB.pedirPermissaoPastaSalva();
        this._renderStatus(ok ? "conectada" : "precisa-permissao");
        if (ok && this._aoRecarregar) this._aoRecarregar();
      });
    } else {
      this._container.className = "db-status conectado";
      this._container.innerHTML = `<span class="ponto"></span><span>Leitura automática ativa. A pasta "bd" será vinculada automaticamente na primeira vez que você salvar algo nesta página.</span>`;
    }
  },

  async salvarDados(alertaContainer) {
    return this._salvarGenerico(alertaContainer, () => DB.salvarDados(), () => DB.baixarDadosManual());
  },

  async salvarNotas(alertaContainer) {
    return this._salvarGenerico(alertaContainer, () => DB.salvarNotas(), () => DB.baixarNotasManual());
  },

  async salvarQuadro(alertaContainer) {
    return this._salvarGenerico(alertaContainer, () => DB.salvarQuadro(), () => DB.baixarQuadroManual());
  },

  async _salvarGenerico(alertaContainer, fnSalvar, fnBaixarManual) {
    if (!DB.suportaFS()) {
      fnBaixarManual();
      mostrarAlerta(alertaContainer, "aviso",
        'Modo manual: os arquivos atualizados foram baixados. Substitua os arquivos correspondentes na pasta "bd" da rede.');
      return true;
    }

    try {
      await this.comCarregando(fnSalvar);
      limparAlerta(alertaContainer);
      if (this._container) this._renderStatus("conectada");
      return true;
    } catch (e) {
      if (e.message === "CONFLITO") {
        mostrarAlerta(alertaContainer, "erro",
          'Este arquivo foi alterado por outra pessoa desde a última leitura. Clique em "Recarregar do disco" na barra acima, refaça a alteração e tente salvar de novo.');
      } else if (e.message === "SEM_PASTA") {
        mostrarAlerta(alertaContainer, "erro",
          'Não foi possível vincular a pasta "bd" (talvez a seleção tenha sido cancelada). Clique em salvar de novo e escolha a pasta "bd".');
      } else {
        mostrarAlerta(alertaContainer, "erro", "Não foi possível salvar: " + e.message);
      }
      return false;
    }
  },
};
