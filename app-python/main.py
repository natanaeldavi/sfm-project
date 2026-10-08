"""SFM — backend local (Flask) + janela de app (pywebview).

Serve os arquivos estáticos (html/css/js) e expõe uma API simples para ler/escrever
a "bd/" como arquivos comuns do sistema — substitui a File System Access API do
navegador, que exigia vincular/reconectar a pasta "bd" manualmente e só funcionava
no Chrome/Edge.

Cada PC roda este executável localmente: o Flask sobe em 127.0.0.1 numa porta livre
e abre uma janela própria (pywebview, usando o WebView2 do Windows). Se o WebView2
não estiver disponível na máquina, cai para o navegador padrão.

Layout do banco (ver também js/db.js):
  bd/usuarios.json          — todos os usuários, global (poucas escritas, só Admin)
  bd/notas.json             — notas/ordens do SAP, global (alimentado por import manual
                               e por uma ferramenta externa de import automático — por
                               isso continua um arquivo só, sem dividir por setor)
  bd/dados-<Setor>.json     — passagensTurno/eficiencia/confirmacoesTurno/eventosPassagem
                               só daquele setor
  bd/quadro-<Setor>.json    — registros do quadro S/Q/D/C só daquele setor (chave = só a
                               data, sem o prefixo "Setor|" que bd/quadro.json usava)

Motivo da divisão por setor: antes, duas pessoas de setores diferentes editando ao
mesmo tempo (ex.: dois operadores preenchendo a SFM no mesmo horário) podiam
sobrescrever um o trabalho do outro — cada página carrega o arquivo inteiro pra
memória e regrava o arquivo inteiro ao salvar, sem checar se mudou nesse meio tempo.
Dividindo por setor, cada gravação só afeta o arquivo daquele setor — a corrida só
continua existindo se duas pessoas mexerem no MESMO setor ao mesmo tempo (bem mais
raro). Ver _migrar_para_por_setor() para a migração automática do formato antigo.

Onde fica a pasta "bd": por padrão, ao lado do .exe (BASE_DIR/bd) — mas isso é
configurável (ver _bd_dir_configurado()/config.json e a página escondida
configuracao.html, não linkada em nenhum lugar do app) pra cada PC poder rodar o
.exe copiado localmente e só apontar pra pasta "bd" compartilhada na rede, em vez
de rodar o .exe direto da rede (mais lento/instável de abrir).
"""

import json
import os
import socket
import sys
import threading
import webbrowser
from pathlib import Path

from flask import Flask, jsonify, request

SETORES_VALIDOS = ("Gasolina", "Diesel", "Controle", "Biela")

# Senha da página escondida de configuração (configuracao.html, não linkada em nenhum menu) —
# só ela protege a troca de pasta "bd", então é checada aqui no servidor também, não só na tela.
SENHA_CONFIGURACAO = "sfm2026@mahle"

PROJETO_DIR = Path(__file__).resolve().parent.parent  # raiz do repo: html/css/js/bd ficam lá, intocados


def diretorio_base() -> Path:
    """Pasta do .exe empacotado (onde fica a pasta "bd"), ou a raiz do projeto ao rodar via `python main.py`."""
    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parent
    return PROJETO_DIR


def diretorio_bundle() -> Path:
    """Pasta com os assets estáticos (html/css/js): extraídos pelo PyInstaller (empacotados a partir da raiz do projeto), ou a própria raiz do projeto em desenvolvimento."""
    if getattr(sys, "frozen", False):
        return Path(sys._MEIPASS)  # type: ignore[attr-defined]
    return PROJETO_DIR


BASE_DIR = diretorio_base()
BUNDLE_DIR = diretorio_bundle()


def _ler_json(caminho: Path, padrao):
    if not caminho.exists():
        return padrao
    with caminho.open("r", encoding="utf-8") as f:
        return json.load(f)


def _escrever_json(caminho: Path, valor) -> None:
    with caminho.open("w", encoding="utf-8") as f:
        json.dump(valor, f, ensure_ascii=False, indent=2)


def _caminho_config() -> Path:
    """config.json fica em C:\\ProgramData\\SFM — não ao lado do .exe nem dentro de "bd" —
    porque isso precisa sobreviver a trocar o .exe por uma versão nova (ex.: numa pasta nova),
    sem perder o caminho configurado da pasta "bd" e precisar configurar de novo. ProgramData é
    usado (não "Arquivos de Programas"/Program Files) porque é gravável por usuário comum sem
    precisar rodar como administrador; Program Files normalmente exige elevação de UAC."""
    base = Path(os.environ.get("PROGRAMDATA", r"C:\ProgramData")) / "SFM"
    base.mkdir(parents=True, exist_ok=True)
    return base / "config.json"


def _ler_config() -> dict:
    return _ler_json(_caminho_config(), {})


def _bd_dir_configurado() -> Path:
    """Pasta "bd" a usar: a configurada em config.json (ver página escondida de configuração,
    configuracao.html), ou BASE_DIR/bd por padrão — mesmo comportamento de sempre quando
    ninguém mexeu na configuração ainda (instalação nova, ou .exe rodando direto da rede)."""
    caminho = _ler_config().get("bd_dir")
    return Path(caminho) if caminho else (BASE_DIR / "bd")


BD_DIR = _bd_dir_configurado()
try:
    # Só cria automaticamente a pasta padrão (BASE_DIR/bd, sempre local e sob controle do
    # programa) — uma pasta configurada na página escondida pode ser um caminho de rede
    # momentaneamente fora do ar (VPN caída, servidor desligado etc.); nesse caso o programa
    # ainda assim precisa SUBIR (pra pelo menos abrir e mostrar "sem conexão", ou deixar
    # corrigir o caminho na página escondida), não travar aqui na inicialização.
    if not _ler_config().get("bd_dir"):
        BD_DIR.mkdir(exist_ok=True)
except OSError:
    pass


def _caminho_usuarios() -> Path:
    return BD_DIR / "usuarios.json"


def _caminho_notas() -> Path:
    return BD_DIR / "notas.json"


def _caminho_dados_setor(setor: str) -> Path:
    return BD_DIR / f"dados-{setor}.json"


def _caminho_quadro_setor(setor: str) -> Path:
    return BD_DIR / f"quadro-{setor}.json"


def _migrar_para_por_setor() -> None:
    """Primeira vez que o .exe nesse formato novo roda numa pasta "bd/" ainda no formato
    antigo (dados.json/quadro.json únicos, com "setor" dentro de cada registro): separa
    tudo nos arquivos por setor e renomeia os antigos pra ".pre-split.bak" (nunca apaga).
    Idempotente — se bd/usuarios.json já existir, não faz nada (assume que já migrou, ou
    que é uma instalação nova que já nasce no formato novo). Não faz nada também se BD_DIR
    não existir/não estiver acessível agora (ex.: caminho de rede configurado fora do ar) —
    não é hora de criar nada nem migrar, só deixar o programa subir mesmo assim.
    """
    if not BD_DIR.exists() or _caminho_usuarios().exists():
        return

    dados_antigo_path = BD_DIR / "dados.json"
    quadro_antigo_path = BD_DIR / "quadro.json"
    dados_antigo = _ler_json(dados_antigo_path, {})
    quadro_antigo = _ler_json(quadro_antigo_path, {})

    _escrever_json(_caminho_usuarios(), dados_antigo.get("usuarios", []))

    for setor in SETORES_VALIDOS:
        dados_setor = {
            "passagensTurno": [p for p in dados_antigo.get("passagensTurno", []) if p.get("setor") == setor],
            "eficiencia": [e for e in dados_antigo.get("eficiencia", []) if e.get("setor") == setor],
            "confirmacoesTurno": [c for c in dados_antigo.get("confirmacoesTurno", []) if c.get("setor") == setor],
            "eventosPassagem": [e for e in dados_antigo.get("eventosPassagem", []) if e.get("setor") == setor],
        }
        _escrever_json(_caminho_dados_setor(setor), dados_setor)

        registros_setor = {}
        for chave, registro in quadro_antigo.get("registros", {}).items():
            if "|" not in chave:
                continue
            setor_chave, data_chave = chave.split("|", 1)
            if setor_chave == setor:
                registros_setor[data_chave] = registro
        _escrever_json(_caminho_quadro_setor(setor), {"registros": registros_setor})

    if dados_antigo_path.exists() and not (BD_DIR / "dados.json.pre-split.bak").exists():
        dados_antigo_path.rename(BD_DIR / "dados.json.pre-split.bak")
    if quadro_antigo_path.exists() and not (BD_DIR / "quadro.json.pre-split.bak").exists():
        quadro_antigo_path.rename(BD_DIR / "quadro.json.pre-split.bak")


_migrar_para_por_setor()

# Um lock por arquivo (nome -> Lock), criado sob demanda — mais simples que prever
# todas as combinações de setor de antemão.
_locks: dict[str, threading.Lock] = {}
_locks_guarda = threading.Lock()


def _lock_para(nome: str) -> threading.Lock:
    with _locks_guarda:
        if nome not in _locks:
            _locks[nome] = threading.Lock()
        return _locks[nome]


app = Flask(__name__, static_folder=str(BUNDLE_DIR), static_url_path="")


def _listar_arquivos(pasta: Path) -> list[str]:
    try:
        return sorted(p.name for p in pasta.iterdir() if p.is_file())
    except OSError:
        return []


@app.get("/api/config")
def api_get_config():
    """Usado pela página escondida configuracao.html pra mostrar o caminho atual da pasta
    "bd" e os arquivos encontrados nela (confirma visualmente se é a pasta certa)."""
    return jsonify(bd_dir=str(BD_DIR), existe=BD_DIR.exists(), arquivos=_listar_arquivos(BD_DIR))


@app.post("/api/config")
def api_post_config():
    """Troca a pasta "bd" em uso — grava em config.json (ver _caminho_config) e já atualiza
    BD_DIR nesta mesma execução do servidor, sem precisar reiniciar o programa. Exige a senha
    da página escondida mesmo aqui no servidor (não só na tela), já que troca de onde TODOS os
    dados são lidos/gravados dali em diante."""
    global BD_DIR
    valor = request.get_json(force=True, silent=False) or {}

    if valor.get("senha") != SENHA_CONFIGURACAO:
        return jsonify(erro="Senha incorreta."), 403

    novo_caminho = (valor.get("bd_dir") or "").strip()
    if not novo_caminho:
        return jsonify(erro="Informe um caminho."), 400

    caminho = Path(novo_caminho)
    try:
        criada = not caminho.exists()
        caminho.mkdir(parents=True, exist_ok=True)
    except OSError as e:
        return jsonify(erro=f"Não consegui acessar/criar esse caminho: {e}"), 400

    BD_DIR = caminho
    _escrever_json(_caminho_config(), {"bd_dir": str(BD_DIR)})

    return jsonify(ok=True, bd_dir=str(BD_DIR), existe=True, criada=criada, arquivos=_listar_arquivos(BD_DIR))


@app.get("/api/usuarios")
def api_get_usuarios():
    return jsonify(_ler_json(_caminho_usuarios(), []))


@app.post("/api/usuarios")
def api_post_usuarios():
    valor = request.get_json(force=True, silent=False)
    with _lock_para("usuarios"):
        _escrever_json(_caminho_usuarios(), valor)
    return jsonify(ok=True)


@app.get("/api/notas")
def api_get_notas():
    return jsonify(_ler_json(_caminho_notas(), []))


@app.post("/api/notas")
def api_post_notas():
    valor = request.get_json(force=True, silent=False)
    with _lock_para("notas"):
        _escrever_json(_caminho_notas(), valor)
    return jsonify(ok=True)


@app.get("/api/dados/<setor>")
def api_get_dados_setor(setor: str):
    if setor not in SETORES_VALIDOS:
        return jsonify(erro="setor desconhecido"), 404
    padrao = {"passagensTurno": [], "eficiencia": [], "confirmacoesTurno": [], "eventosPassagem": []}
    return jsonify(_ler_json(_caminho_dados_setor(setor), padrao))


@app.post("/api/dados/<setor>")
def api_post_dados_setor(setor: str):
    if setor not in SETORES_VALIDOS:
        return jsonify(erro="setor desconhecido"), 404
    valor = request.get_json(force=True, silent=False)
    with _lock_para(f"dados-{setor}"):
        _escrever_json(_caminho_dados_setor(setor), valor)
    return jsonify(ok=True)


@app.get("/api/quadro/<setor>")
def api_get_quadro_setor(setor: str):
    if setor not in SETORES_VALIDOS:
        return jsonify(erro="setor desconhecido"), 404
    return jsonify(_ler_json(_caminho_quadro_setor(setor), {"registros": {}}))


@app.post("/api/quadro/<setor>")
def api_post_quadro_setor(setor: str):
    if setor not in SETORES_VALIDOS:
        return jsonify(erro="setor desconhecido"), 404
    valor = request.get_json(force=True, silent=False)
    with _lock_para(f"quadro-{setor}"):
        _escrever_json(_caminho_quadro_setor(setor), valor)
    return jsonify(ok=True)


@app.get("/")
def index():
    return app.send_static_file("login.html")


def _porta_livre() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _abrir_janela(url: str) -> bool:
    """Tenta abrir a janela pywebview (bloqueia até ela ser fechada). Retorna True se conseguiu usar o pywebview, False se caiu no fallback do navegador padrão (nesse caso não bloqueia sozinha)."""
    try:
        import webview

        webview.create_window("SFM", url, width=1280, height=800)
        webview.start()
        return True
    except Exception:
        webbrowser.open(url)
        return False


def main() -> None:
    porta = _porta_livre()
    url = f"http://127.0.0.1:{porta}"

    thread = threading.Thread(
        target=lambda: app.run(host="127.0.0.1", port=porta, threaded=True, use_reloader=False),
        daemon=True,
    )
    thread.start()

    usou_webview = _abrir_janela(url)
    if not usou_webview:
        # Sem janela própria para "segurar" o processo: mantém o servidor no ar
        # (fica rodando até a tarefa ser encerrada manualmente, ex.: pelo Gerenciador de Tarefas).
        thread.join()


if __name__ == "__main__":
    main()
