/* SFM — admin.html (somente papel admin) */

(function () {
  const usuario = Auth.exigirPapel(["admin"]);
  if (!usuario) return;
  montarTopbar(document.getElementById("topbar"), usuario, "Administração");

  const alerta = document.getElementById("alerta");
  const conteudo = document.getElementById("conteudo");
  const form = document.getElementById("formNovoUsuario");
  const campoPapel = document.getElementById("campoPapel");
  const campoSetorWrap = document.getElementById("campoSetorWrap");
  const campoSetor = document.getElementById("campoSetor");
  const campoTurnoWrap = document.getElementById("campoTurnoWrap");
  const campoTurno = document.getElementById("campoTurno");

  campoSetor.innerHTML = SETORES.map((s) => `<option value="${s}">${s}</option>`).join("");
  campoTurno.innerHTML = TURNOS.map((t) => `<option value="${t}">${t}</option>`).join("");

  function atualizarVisibilidadeSetor() {
    const mostrar = campoPapel.value === "operador";
    campoSetorWrap.style.display = mostrar ? "" : "none";
    campoTurnoWrap.style.display = mostrar ? "" : "none";
  }
  campoPapel.addEventListener("change", atualizarVisibilidadeSetor);
  atualizarVisibilidadeSetor();

  // ---------- Dados de ordens (notas do SAP): backup e exclusão ----------

  const btnBackupNotas = document.getElementById("btnBackupNotas");
  const btnExcluirNotas = document.getElementById("btnExcluirNotas");
  const contagemNotasAdmin = document.getElementById("contagemNotasAdmin");

  function renderNotasAdmin() {
    contagemNotasAdmin.textContent = `${DB.notas.length} nota(s)/ordem(ns) atualmente no banco.`;
    btnExcluirNotas.disabled = DB.notas.length === 0;
  }

  btnBackupNotas.addEventListener("click", () => {
    DB.baixarBackupNotas();
    mostrarAlerta(alerta, "ok", `Backup baixado com ${DB.notas.length} nota(s).`);
  });

  btnExcluirNotas.addEventListener("click", async () => {
    const total = DB.notas.length;
    if (total === 0) return;

    if (!confirm(`Isso vai excluir todas as ${total} nota(s)/ordem(ns) do banco, sem afetar usuários ou passagens de turno. Já baixou o backup? Esta ação não pode ser desfeita por aqui.`)) return;

    const digitado = prompt(`Para confirmar, digite EXCLUIR (em maiúsculas):`);
    if (digitado !== "EXCLUIR") {
      if (digitado !== null) mostrarAlerta(alerta, "erro", "Texto de confirmação não confere — nada foi excluído.");
      return;
    }

    DB.notas = [];
    btnExcluirNotas.disabled = true;
    const ok = await DbUI.salvarNotas(alerta);
    if (ok) {
      mostrarAlerta(alerta, "ok", `${total} nota(s) excluída(s).`);
      renderNotasAdmin();
    } else {
      btnExcluirNotas.disabled = false;
    }
  });

  const btnSalvarUsuarios = document.getElementById("btnSalvarUsuarios");
  const msgSalvarUsuarios = document.getElementById("msgSalvarUsuarios");
  let usuariosSujo = false; // há mudanças de turno/responsável ainda não salvas

  DB.carregarAutoLoad();
  Auth.atualizarUsuarioDoBanco(usuario);
  if (Auth.aplicarGatePassagemObrigatoria(usuario)) return;
  if (Auth.aplicarGateRecebimento(usuario)) return;
  conteudo.hidden = false;
  renderTabela();
  renderNotasAdmin();
  DbUI.definirCallbackRecarregar(() => {
    usuariosSujo = false;
    msgSalvarUsuarios.textContent = "";
    renderTabela();
    renderNotasAdmin();
  });
  DbUI.iniciar(document.getElementById("dbStatus"));

  window.addEventListener("beforeunload", (ev) => {
    if (usuariosSujo) { ev.preventDefault(); ev.returnValue = ""; }
  });

  function marcarUsuariosSujo() {
    usuariosSujo = true;
    msgSalvarUsuarios.textContent = "Há alterações não salvas.";
    msgSalvarUsuarios.style.color = "var(--texto-suave)";
  }

  /**
   * Tabela de usuários: turno e "Responsável SFM" são editados livremente
   * na tela (só em memória) e só viram alteração de verdade em
   * "Salvar alterações" — sem botão de salvar por linha/campo.
   */
  function renderTabela() {
    const corpo = document.getElementById("corpoTabelaUsuarios");
    corpo.innerHTML = DB.dados.usuarios.map((u) => {
      const setorCelula = u.papel === "operador"
        ? `<select class="seletorSetorLinha" style="display:inline-block;width:auto;">` +
            SETORES.map((s) => `<option value="${s}" ${u.setor === s ? "selected" : ""}>${s}</option>`).join("") +
          `</select>`
        : "—";
      const turnoCelula = u.papel === "operador"
        ? `<select class="seletorTurnoLinha" style="display:inline-block;width:auto;">` +
            `<option value="">— sem turno —</option>` +
            TURNOS.map((t) => `<option value="${t}" ${u.turno === t ? "selected" : ""}>${t}</option>`).join("") +
          `</select>`
        : "—";
      const podeSerResponsavel = u.papel === "operador" && u.turno === "Manhã";
      const responsavelCelula = u.papel === "operador"
        ? `<label class="checkbox-linha" title="${podeSerResponsavel ? "" : "Só operadores do turno Manhã podem ser responsáveis pela SFM"}">` +
            `<input type="checkbox" class="chkResponsavelSfm" ${u.responsavelSfm ? "checked" : ""} ${podeSerResponsavel ? "" : "disabled"}>` +
          `</label>`
        : "—";
      return `
      <tr data-id="${escaparHtml(u.id)}">
        <td>${escaparHtml(u.nome)}</td>
        <td>${escaparHtml(u.papel)}</td>
        <td>${setorCelula}</td>
        <td>${turnoCelula}</td>
        <td>${responsavelCelula}</td>
        <td><button type="button" class="perigo btnExcluir" ${u.id === usuario.id ? "disabled title='Você não pode excluir seu próprio usuário'" : ""}>Excluir</button></td>
      </tr>`;
    }).join("");

    corpo.querySelectorAll(".chkResponsavelSfm").forEach((chk) => {
      chk.addEventListener("change", () => {
        const tr = chk.closest("tr");
        const id = tr.dataset.id;
        const alvo = DB.dados.usuarios.find((u) => u.id === id);
        if (!alvo) return;

        if (chk.checked) {
          for (const u of DB.dados.usuarios) {
            if (u.id !== alvo.id && u.papel === "operador" && u.setor === alvo.setor) u.responsavelSfm = false;
          }
        }
        alvo.responsavelSfm = chk.checked;
        marcarUsuariosSujo();
        renderTabela();
      });
    });

    corpo.querySelectorAll(".seletorTurnoLinha").forEach((sel) => {
      sel.addEventListener("change", () => {
        const tr = sel.closest("tr");
        const id = tr.dataset.id;
        const alvo = DB.dados.usuarios.find((u) => u.id === id);
        if (!alvo) return;
        alvo.turno = sel.value || null;
        if (alvo.turno !== "Manhã") alvo.responsavelSfm = false; // só quem é do turno Manhã pode ser responsável pela SFM
        marcarUsuariosSujo();
        renderTabela();
      });
    });

    corpo.querySelectorAll(".seletorSetorLinha").forEach((sel) => {
      sel.addEventListener("change", () => {
        const tr = sel.closest("tr");
        const id = tr.dataset.id;
        const alvo = DB.dados.usuarios.find((u) => u.id === id);
        if (!alvo) return;
        alvo.setor = sel.value;
        alvo.responsavelSfm = false; // responsável é por setor — trocar de setor exige marcar de novo (evita duplicar responsável no setor novo)
        marcarUsuariosSujo();
        renderTabela();
      });
    });

    corpo.querySelectorAll(".btnExcluir").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const tr = btn.closest("tr");
        const id = tr.dataset.id;
        const alvo = DB.dados.usuarios.find((u) => u.id === id);
        if (!alvo) return;

        if (alvo.papel === "admin" && DB.dados.usuarios.filter((u) => u.papel === "admin").length <= 1) {
          mostrarAlerta(alerta, "erro", "Não é possível excluir o último usuário admin.");
          return;
        }
        if (!confirm(`Excluir o usuário "${alvo.nome}"?`)) return;

        DB.dados.usuarios = DB.dados.usuarios.filter((u) => u.id !== id);
        btn.disabled = true;
        const ok = await DbUI.salvarDados(alerta);
        if (ok) renderTabela(); else btn.disabled = false;
      });
    });
  }

  btnSalvarUsuarios.addEventListener("click", async () => {
    btnSalvarUsuarios.disabled = true;
    const ok = await DbUI.salvarDados(alerta);
    btnSalvarUsuarios.disabled = false;
    if (ok) {
      usuariosSujo = false;
      msgSalvarUsuarios.textContent = "Alterações salvas.";
      msgSalvarUsuarios.style.color = "var(--verde-ok)";
    }
  });

  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    limparAlerta(alerta);

    const nome = document.getElementById("campoNome").value.trim();
    const papel = campoPapel.value;
    const setor = papel === "operador" ? campoSetor.value : null;
    const turno = papel === "operador" ? campoTurno.value : null;
    const senha = document.getElementById("campoSenha").value;
    const confirmar = document.getElementById("campoConfirmar").value;

    if (!nome) { mostrarAlerta(alerta, "erro", "Informe o nome de usuário."); return; }
    if (DB.buscarUsuarioPorNome(nome)) { mostrarAlerta(alerta, "erro", "Já existe um usuário com esse nome."); return; }
    if (senha.length < 3) { mostrarAlerta(alerta, "erro", "A senha deve ter ao menos 3 caracteres."); return; }
    if (senha !== confirmar) { mostrarAlerta(alerta, "erro", "As senhas não conferem."); return; }

    const { senhaHash, senhaSalt } = await gerarHashSenha(senha);
    DB.dados.usuarios.push({ id: gerarId("u"), nome, senhaHash, senhaSalt, papel, setor, turno });

    const ok = await DbUI.salvarDados(alerta);
    if (ok) {
      form.reset();
      atualizarVisibilidadeSetor();
      mostrarAlerta(alerta, "ok", `Usuário "${nome}" criado.`);
      renderTabela();
    }
  });
})();
