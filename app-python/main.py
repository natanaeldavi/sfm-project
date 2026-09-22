"""SFM — backend local (Flask) + janela de app (pywebview).

Serve os arquivos estáticos (html/css/js) e expõe uma API simples para ler/escrever
bd/dados.json, bd/notas.json e bd/quadro.json como arquivos comuns do sistema —
substitui a File System Access API do navegador, que exigia vincular/reconectar a
pasta "bd" manualmente e só funcionava no Chrome/Edge.

Cada PC roda este executável localmente: o Flask sobe em 127.0.0.1 numa porta livre
e abre uma janela própria (pywebview, usando o WebView2 do Windows). Se o WebView2
não estiver disponível na máquina, cai para o navegador padrão.
"""

import json
import socket
import sys
import threading
import webbrowser
from pathlib import Path

from flask import Flask, jsonify, request

ARQUIVOS_BD = {
    "dados": "dados.json",
    "notas": "notas.json",
    "quadro": "quadro.json",
}

_locks = {chave: threading.Lock() for chave in ARQUIVOS_BD}


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
BD_DIR = BASE_DIR / "bd"
BD_DIR.mkdir(exist_ok=True)

app = Flask(__name__, static_folder=str(BUNDLE_DIR), static_url_path="")


def _caminho_bd(chave: str) -> Path:
    return BD_DIR / ARQUIVOS_BD[chave]


def _ler_bd(chave: str):
    caminho = _caminho_bd(chave)
    if not caminho.exists():
        return {} if chave != "notas" else []
    with caminho.open("r", encoding="utf-8") as f:
        return json.load(f)


def _escrever_bd(chave: str, valor) -> None:
    caminho = _caminho_bd(chave)
    with _locks[chave]:
        with caminho.open("w", encoding="utf-8") as f:
            json.dump(valor, f, ensure_ascii=False, indent=2)


@app.get("/api/<chave>")
def api_get(chave):
    if chave not in ARQUIVOS_BD:
        return jsonify(erro="desconhecido"), 404
    return jsonify(_ler_bd(chave))


@app.post("/api/<chave>")
def api_post(chave):
    if chave not in ARQUIVOS_BD:
        return jsonify(erro="desconhecido"), 404
    valor = request.get_json(force=True, silent=False)
    _escrever_bd(chave, valor)
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
