# SFM — executável Python

Backend local (Flask) que serve a aplicação web do SFM (que continua em `../` — html, css, js
e `bd/`, sem nenhuma mudança de lugar) e abre numa janela própria via `pywebview` (WebView2),
com fallback pro navegador padrão se o WebView2 não estiver disponível na máquina.

Isso substitui a File System Access API do navegador (que exigia vincular/reconectar a pasta
"bd" manualmente): o Flask lê/escreve `bd/dados.json`, `bd/notas.json` e `bd/quadro.json` como
arquivos comuns do sistema, então não pede mais permissão nenhuma.

## Rodar em desenvolvimento

```
pip install -r requirements.txt
python main.py
```

Isso usa a `bd/` e os html/css/js de `../` (a raiz do projeto) diretamente — sem empacotar nada.

## Gerar o .exe

```
pip install -r requirements.txt
pyinstaller --onefile --name SFM --add-data "../css;css" --add-data "../js;js" --add-data "../login.html;." --add-data "../menu.html;." --add-data "../admin.html;." --add-data "../passar-turno.html;." --add-data "../quadro-sfm.html;." --add-data "../receber-turno.html;." --add-data "../relatorios.html;." main.py
```

O resultado fica em `dist/SFM.exe`. Esse único arquivo já contém o html/css/js empacotados.

## Distribuir na pasta de rede

1. Copie `dist/SFM.exe` para a pasta de rede.
2. Na primeira execução, o `.exe` cria sozinho uma pasta `bd/` ao lado dele (se ainda não
   existir) — copie pra lá o `bd/dados.json`, `bd/notas.json` e `bd/quadro.json` reais, se já
   existirem dados.
3. Cada pessoa roda o mesmo `SFM.exe` direto da pasta de rede, no seu próprio PC — não precisa
   instalar nada. Todos leem/escrevem os mesmos arquivos em `bd/`.
