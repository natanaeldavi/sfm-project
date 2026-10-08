/* SFM — funções utilitárias compartilhadas (classificação, datas, formatação). */

const SETORES = ["Gasolina", "Diesel", "Controle", "Biela"];

/** Rótulo de exibição de cada papel — o valor interno (`usuario.papel`, salvo em
 * bd/usuarios.json) continua "operador"/"gestor"/"admin"/"mestre"; só o texto mostrado mudou. */
const ROLE_LABELS = { operador: "Manutentor", gestor: "Gestor", admin: "Admin", mestre: "Mestre" };
function rotuloPapel(papel) {
  return ROLE_LABELS[papel] || papel;
}

/** Papéis com setor fixo (sem seletor livre de setor, e com acesso restrito aos dados só
 * daquele setor em Relatórios/SFM): Manutentor (operador) e Mestre. Gestor e Admin continuam
 * escolhendo o setor ativo livremente e vendo todos os setores. */
function papelTemSetorFixo(papel) {
  return papel === "operador" || papel === "mestre";
}
const TURNOS = ["Manhã", "Tarde", "Noite"];
const LIMITE_PARADA_MINUTOS = 10 * 60; // 10 horas -> entra no top problemas do próximo SFM

/** Login/senha fixos da página escondida de configuração da pasta "bd" (ver
 * configuracao.html) — não vêm de bd/usuarios.json (essa tela existe justamente pra
 * configurar onde esse arquivo fica, então não pode depender dele). Entra-se digitando o
 * "número pessoal" especial abaixo direto na tela de login normal (ver js/login.js); a senha
 * é conferida de novo no servidor (SENHA_CONFIGURACAO em app-python/main.py) antes de aceitar
 * qualquer troca de caminho, não só no cliente. */
const CONFIG_LOGIN_ESCONDIDO = "sfmadmin123";
const CONFIG_SENHA_ESCONDIDA = "sfm2026@mahle";
const CONFIG_SESSAO_CHAVE = "sfm_config_autenticado";

/** Horário oficial (início/fim) de cada turno — usado para as janelas obrigatórias de passar/receber turno. */
const TURNO_HORARIOS = {
  "Manhã": { inicio: "05:50", fim: "14:10" },
  "Tarde": { inicio: "13:50", fim: "23:10" },
  "Noite": { inicio: "22:50", fim: "06:10" },
};
/** Duração (em minutos) da janela obrigatória de passagem (antes do fim do turno) e de recebimento (depois do início). */
const JANELA_TURNO_MINUTOS = 40;

/** Turno seguinte na rotação Manhã -> Tarde -> Noite -> Manhã — usado como turno de destino ao registrar uma passagem. */
function proximoTurno(turno) {
  const i = TURNOS.indexOf(turno);
  return i === -1 ? null : TURNOS[(i + 1) % TURNOS.length];
}

/** "HH:MM" -> minutos desde a meia-noite. */
function minutosDoDia(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

/** Minutos desde a meia-noite, agora (horário local). */
function minutosAgora() {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
}

/** ini/fim em minutos-do-dia -> soma com módulo 1440 (permite valores negativos ou > 1440). */
function somarMinutosDoDia(m, delta) {
  return ((m + delta) % 1440 + 1440) % 1440;
}

/**
 * `agora` está entre `ini` e `fim` (minutos-do-dia)? Se `ini > fim`, o
 * intervalo cruza a meia-noite (ex.: 23:50–00:10) e a checagem vira "agora
 * >= ini OU agora <= fim".
 */
function dentroIntervaloMinutos(agora, ini, fim) {
  if (ini <= fim) return agora >= ini && agora <= fim;
  return agora >= ini || agora <= fim;
}

/** Janela obrigatória de passagem do turno: os últimos JANELA_TURNO_MINUTOS antes do horário final. */
function janelaPassarTurno(turno) {
  const cfg = TURNO_HORARIOS[turno];
  if (!cfg) return null;
  const fim = minutosDoDia(cfg.fim);
  const inicio = somarMinutosDoDia(fim, -JANELA_TURNO_MINUTOS);
  return { inicio, fim };
}

/** Janela obrigatória de recebimento do turno: os primeiros JANELA_TURNO_MINUTOS depois do horário inicial. */
function janelaReceberTurno(turno) {
  const cfg = TURNO_HORARIOS[turno];
  if (!cfg) return null;
  const inicio = minutosDoDia(cfg.inicio);
  const fim = somarMinutosDoDia(inicio, JANELA_TURNO_MINUTOS);
  return { inicio, fim };
}

function estaNaJanelaPassar(turno) {
  const j = janelaPassarTurno(turno);
  if (!j) return false;
  return dentroIntervaloMinutos(minutosAgora(), j.inicio, j.fim);
}

function estaNaJanelaReceber(turno) {
  const j = janelaReceberTurno(turno);
  if (!j) return false;
  return dentroIntervaloMinutos(minutosAgora(), j.inicio, j.fim);
}

/**
 * Data ISO "dona" do turno que está em andamento agora, para turnos que
 * cruzam a meia-noite (Noite): se já estamos na madrugada (antes do horário
 * final do turno, ex.: 05:30 pertence ao turno Noite que começou ontem às
 * 22:50), o turno "pertence" a ontem. Usado como chave de "passagem de
 * turno concluída hoje" (ver DB.confirmarPassagemTurno).
 */
function dataDoTurnoAtual(turno) {
  const cfg = TURNO_HORARIOS[turno];
  if (!cfg) return hojeISO();
  const inicioMin = minutosDoDia(cfg.inicio);
  const fimMin = minutosDoDia(cfg.fim);
  const cruzaMeiaNoite = inicioMin > fimMin;
  if (cruzaMeiaNoite && minutosAgora() <= fimMin) return ontemISO();
  return hojeISO();
}

/**
 * Classifica o setor a partir da coluna "Loc.instalação" do SAP.
 * Regras (nesta ordem de prioridade):
 *  - contém TRASU ou CONQU              -> Controle (TRS e CQG)
 *  - contém APOIO-FERPIS                -> Biela (Bielas e Sal)
 *  - USPIS-CEL + número 003..019        -> Gasolina
 *  - USPIS-CEL + número 021..038        -> Diesel
 *  - contém USPIS, sem CEL nenhum       -> Gasolina (ex.: "1012-PISTA-USPIS")
 *  - qualquer outro local                -> Biela (Bielas e Sal)
 */
function classificarSetor(locInstalacao) {
  const loc = (locInstalacao || "").toString().toUpperCase();
  if (!loc) return "Biela";

  if (loc.includes("TRASU") || loc.includes("CONQU")) return "Controle";
  if (loc.includes("APOIO-FERPIS")) return "Biela";

  const m = loc.match(/USPIS-CEL\D{0,3}(\d{3})/);
  if (m) {
    const n = parseInt(m[1], 10);
    if (n >= 3 && n <= 19) return "Gasolina";
    if (n >= 21 && n <= 38) return "Diesel";
  }

  if (loc.includes("USPIS") && !loc.includes("CEL")) return "Gasolina";

  return "Biela";
}

/**
 * Classifica o tipo de manutenção a partir da coluna "Centrab.respon." do SAP (campo `centrab`
 * da nota — ver MAPA_CABECALHOS_SAP em js/quadro-sfm.js): MUPELE -> Eletrica, MUPMEC -> Mecanica.
 * Retorna null se o código não bater com nenhuma das duas (ex.: notas antigas/de teste que
 * trazem só o centro de custo nesse campo) — exibir como "—" nesse caso, não travar a tela.
 * Valor sem acento de propósito (usado também como sufixo de classe CSS, ver .tag.tipo-* em
 * css/style.css) — o rótulo acentuado pra exibição vem de TIPOS_MANUTENCAO_ROTULOS.
 */
function tipoManutencaoPorCentrab(centrab) {
  const c = (centrab || "").toString().toUpperCase();
  if (c.includes("MUPELE")) return "Eletrica";
  if (c.includes("MUPMEC")) return "Mecanica";
  return null;
}

const TIPOS_MANUTENCAO_ROTULOS = { Eletrica: "Elétrica", Mecanica: "Mecânica" };

/** HTML da tag colorida de tipo de manutenção (ver .tag.tipo-* em css/style.css), ou "—" quando
 * o `centrab` da nota não classifica em nenhum dos dois tipos conhecidos. */
function tagTipoManutencaoHtml(centrab) {
  const tipo = tipoManutencaoPorCentrab(centrab);
  if (!tipo) return "—";
  return `<span class="tag tipo-${tipo}">${TIPOS_MANUTENCAO_ROTULOS[tipo]}</span>`;
}

/** Converte um valor de célula do SAP (Date, serial Excel ou string dd.mm.aaaa) para "YYYY-MM-DD". */
function paraDataISO(valor) {
  if (valor === null || valor === undefined || valor === "") return null;

  if (valor instanceof Date && !isNaN(valor)) {
    return formatarDataISO(valor);
  }

  const s = valor.toString().trim();
  if (!s) return null;

  let m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/); // dd.mm.aaaa (padrão SAP)
  if (m) {
    const [, d, mo, y] = m;
    return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }

  m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/); // já em ISO
  if (m) {
    const [, y, mo, d] = m;
    return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }

  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/); // dd/mm/aaaa
  if (m) {
    const [, d, mo, y] = m;
    return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }

  return null;
}

/**
 * Extrai o horário (HH:mm) de um valor de célula do SAP, quando a célula
 * tem data E hora juntas (ex.: "Data de entrada" com timestamp completo).
 * Retorna null se não houver horário (célula só com data, ou meia-noite
 * exata — que normalmente indica que não tinha horário mesmo).
 */
function extrairHoraDeData(valor) {
  if (valor === null || valor === undefined || valor === "") return null;

  if (valor instanceof Date && !isNaN(valor)) {
    const h = valor.getHours();
    const m = valor.getMinutes();
    if (h === 0 && m === 0) return null;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  }

  const s = valor.toString().trim();
  const m = s.match(/(\d{1,2}):(\d{2})(?::\d{2})?\s*$/);
  if (m) return `${m[1].padStart(2, "0")}:${m[2]}`;

  return null;
}

function formatarDataISO(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** "YYYY-MM-DD" -> "DD/MM/AAAA" para exibição. */
function formatarDataBR(isoStr) {
  if (!isoStr) return "—";
  const m = isoStr.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return isoStr;
  return `${m[3]}/${m[2]}/${m[1]}`;
}

function dataHoraAgoraBR() {
  const d = new Date();
  return d.toLocaleString("pt-BR");
}

function hojeISO() {
  return formatarDataISO(new Date());
}

function ontemISO() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return formatarDataISO(d);
}

/** Soma/subtrai dias de uma data ISO "YYYY-MM-DD". */
function somarDiasISO(isoStr, dias) {
  const [y, m, d] = isoStr.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + dias);
  return formatarDataISO(dt);
}

/**
 * Calcula quais dias o SFM de hoje deve cobrir, seguindo a regra:
 *  - terça a sexta: cobre só o dia anterior (ontem)
 *  - segunda-feira: cobre sexta + sábado + domingo (os 3 dias sem reunião)
 *  - sábado/domingo: não tem reunião de SFM -> retorna null
 * Retorna um array de datas ISO ("YYYY-MM-DD"), mais antiga primeiro, ou null.
 */
function calcularJanelaSfm(dataRef) {
  const ref = dataRef || new Date();
  const diaSemana = ref.getDay(); // 0=domingo ... 6=sábado
  if (diaSemana === 0 || diaSemana === 6) return null;

  const hoje = formatarDataISO(ref);
  if (diaSemana === 1) {
    // segunda-feira: sexta, sábado e domingo anteriores
    return [somarDiasISO(hoje, -3), somarDiasISO(hoje, -2), somarDiasISO(hoje, -1)];
  }
  return [somarDiasISO(hoje, -1)];
}

/**
 * "Hoje" na SFM nunca se refere ao dia real de hoje — a folha de hoje cobre o
 * dia (ou dias) anterior, ver calcularJanelaSfm. Esta função dá o dia que a
 * tela deve mostrar quando o usuário pede "hoje": o último dia coberto pela
 * janela de hoje, ou ontem, se hoje não tem janela (sábado/domingo).
 */
function diaReferenciaSfmHoje() {
  const janela = calcularJanelaSfm();
  return janela ? janela[janela.length - 1] : ontemISO();
}

/** Quantos dias existem entre duas datas ISO (inclusive nas duas pontas). */
function diasEntreISO(de, ate) {
  const [y1, m1, d1] = de.split("-").map(Number);
  const [y2, m2, d2] = ate.split("-").map(Number);
  const ms = new Date(y2, m2 - 1, d2) - new Date(y1, m1 - 1, d1);
  return Math.round(ms / 86400000) + 1;
}

/** Lista todas as datas ISO entre duas datas, inclusive nas duas pontas. */
function expandirIntervaloISO(de, ate) {
  const datas = [];
  let atual = de;
  let guarda = 0;
  while (atual <= ate && guarda++ < 400) {
    datas.push(atual);
    atual = somarDiasISO(atual, 1);
  }
  return datas;
}

/** Próxima segunda-feira a partir de uma data (para mensagem de "sem reunião hoje"). */
function proximaSegundaISO(dataRef) {
  const ref = dataRef || new Date();
  const diaSemana = ref.getDay();
  const diasAteSegunda = (8 - diaSemana) % 7 || 7;
  return somarDiasISO(formatarDataISO(ref), diasAteSegunda);
}

/** Date -> "YYYY-MM-DDTHH:mm" em horário local, formato esperado por <input type="datetime-local">. */
function paraDatetimeLocal(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Minutos -> "Xh Ymin" (ou só "Ymin" se menos de 1h) para exibição. */
function formatarDuracaoMinutos(minutos) {
  if (minutos === null || minutos === undefined || isNaN(minutos)) return "—";
  const m = Math.max(0, Math.round(minutos));
  const h = Math.floor(m / 60);
  const resto = m % 60;
  return h > 0 ? `${h}h ${resto}min` : `${resto}min`;
}

function gerarId(prefixo) {
  const aleatorio = (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36));
  return prefixo ? `${prefixo}-${aleatorio}` : aleatorio;
}

function escaparHtml(texto) {
  if (texto === null || texto === undefined) return "";
  return texto.toString()
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

// ---------- Tabelas com cabeçalho clicável pra ordenar (ver css/style.css, th[data-sort]) ----------
// Usado em todas as telas com tabela de ordens/passagens (Relatórios, Passar Turno, Receber
// Turno): cada tabela tem seu próprio `estado` ({campo, dir}), iniciado com a ordenação padrão
// daquela tela (normalmente a mais recente primeiro) — clicar num `<th data-sort="campo">` troca
// pra ordenar por ele (clicar de novo na mesma coluna inverte asc/desc).

/** Liga o clique nos `<th data-sort="campo">` de uma `<thead>`: `estado` ({campo, dir}) é mutado
 * in-place e `aoMudar` é chamado pra re-renderizar a tabela com a nova ordenação. */
function tornarOrdenavel(thead, estado, aoMudar) {
  thead.querySelectorAll("th[data-sort]").forEach((th) => {
    th.addEventListener("click", () => {
      if (estado.campo === th.dataset.sort) {
        estado.dir = estado.dir === "asc" ? "desc" : "asc";
      } else {
        estado.campo = th.dataset.sort;
        estado.dir = "asc";
      }
      atualizarSetasOrdenacao(thead, estado);
      aoMudar();
    });
  });
  atualizarSetasOrdenacao(thead, estado);
}

function atualizarSetasOrdenacao(thead, estado) {
  thead.querySelectorAll("th[data-sort]").forEach((th) => {
    const ativo = th.dataset.sort === estado.campo;
    th.classList.toggle("ordenado", ativo);
    const seta = th.querySelector(".seta-ordenacao");
    if (seta) seta.textContent = ativo ? (estado.dir === "asc" ? "▲" : "▼") : "⇅";
  });
}

/** Ordena `lista` in-place conforme `estado` ({campo, dir}) — `getters` (opcional) cobre colunas
 * cujo valor de ordenação não é um campo direto do objeto (ex.: um campo calculado a partir de
 * dois outros). Compara numericamente quando os dois valores são number, senão como texto
 * (localeCompare em pt-BR, com `numeric` pra "10" vir depois de "2"). */
function ordenarPorEstado(lista, estado, getters) {
  const obterValor = (getters && getters[estado.campo]) || ((item) => item[estado.campo]);
  const sinal = estado.dir === "asc" ? 1 : -1;
  lista.sort((a, b) => {
    const va = obterValor(a);
    const vb = obterValor(b);
    if (typeof va === "number" && typeof vb === "number") return (va - vb) * sinal;
    const sa = (va ?? "").toString();
    const sb = (vb ?? "").toString();
    return sa.localeCompare(sb, "pt-BR", { numeric: true }) * sinal;
  });
}

// ---------- Menu flutuante (modal) — ver .modal-* em css/style.css ----------

/** Abre um menu flutuante com `tituloTexto` no cabeçalho e `corpoHtml` como conteúdo — fecha
 * clicando no X, clicando fora da caixa (no fundo escurecido) ou apertando Esc. Só um por vez:
 * abrir um novo fecha o anterior, se houver. */
function abrirModal(tituloTexto, corpoHtml) {
  fecharModal();

  const fundo = document.createElement("div");
  fundo.className = "modal-fundo";
  fundo.id = "modalFundoAtivo";
  fundo.innerHTML = `
    <div class="modal-caixa">
      <div class="modal-cabecalho">
        <h3>${escaparHtml(tituloTexto)}</h3>
        <button type="button" class="modal-fechar" aria-label="Fechar">✕</button>
      </div>
      <div class="modal-corpo">${corpoHtml}</div>
    </div>`;

  fundo.addEventListener("click", (ev) => { if (ev.target === fundo) fecharModal(); });
  fundo.querySelector(".modal-fechar").addEventListener("click", fecharModal);
  document.addEventListener("keydown", _fecharModalNoEsc);

  document.body.appendChild(fundo);
  return fundo;
}

function _fecharModalNoEsc(ev) {
  if (ev.key === "Escape") fecharModal();
}

function fecharModal() {
  document.getElementById("modalFundoAtivo")?.remove();
  document.removeEventListener("keydown", _fecharModalNoEsc);
}

function mostrarAlerta(container, tipo, mensagem) {
  container.innerHTML = `<div class="alerta ${tipo}">${escaparHtml(mensagem)}</div>`;
  container.hidden = false;
}

function limparAlerta(container) {
  container.innerHTML = "";
  container.hidden = true;
}
