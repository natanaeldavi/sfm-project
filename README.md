# SFM — Shop Floor Management

Aplicação 100% local para apoiar a reunião diária de SFM: passagem/recebimento
de turno e painel com ordens/eficiência do dia anterior. Não tem servidor —
roda inteira no navegador (Chrome ou Edge), lendo e gravando os arquivos da
pasta `bd/` na pasta de rede.

## Como colocar em produção

1. Copie a pasta inteira (`login.html`, `menu.html`, `css/`, `js/`, `bd/`,
   etc.) para a pasta de rede que todo mundo vai acessar. Mantenha todos os
   arquivos juntos, na mesma estrutura — não mova só o `.html` sem os
   outros.
2. Cada pessoa acessa abrindo `login.html` direto no Chrome ou Edge (duplo
   clique, ou "Abrir com..."). Não precisa instalar nada nem ter internet,
   e **não precisa vincular nem escolher nenhum arquivo pra começar** — o
   login e todas as telas de consulta (quadro SFM, receber turno,
   relatórios) já leem os dados de `bd/` sozinhos, automaticamente.
3. Só na primeira vez que alguém **salvar** alguma coisa (importar uma
   planilha, criar um usuário, passar turno, finalizar uma passagem), o
   Chrome/Edge vai pedir pra confirmar o acesso: escolha a
   pasta **`bd`** no seletor que abrir. Depois disso o navegador lembra
   (fica guardado no perfil do navegador) e não pede de novo nas próximas
   vezes — só se a permissão expirar (confirmação de segurança do próprio
   navegador, não tem como evitar) ou você usar outro perfil/computador,
   caso em que ele pede a pasta `bd` de novo.
4. Se aparecer a mensagem "seu navegador não permite salvar direto na pasta
   de rede" (acontece em navegadores mais antigos ou fora do Chrome/Edge),
   ao clicar em salvar os arquivos atualizados são baixados automaticamente
   — substitua os arquivos correspondentes dentro da pasta `bd` da rede por
   eles.

## Contas de teste (já vêm no `bd/dados.json`)

| usuário | senha | papel | setor |
|---|---|---|---|
| admin | admin | admin | — |
| gestor | gestor | gestor | — |
| user1 | user1 | operador | Gasolina |
| user2 | user2 | operador | Diesel |
| user3 | user3 | operador | Controle |
| user4 | user4 | operador | Biela |

**Troque essas senhas (ou crie usuários novos e apague estes) antes de usar
de verdade** — são só para teste. Use a tela de Administração (login como
`admin`) para gerenciar usuários. Nenhum usuário (nem os de teste, nem os
que você já tinha criado) vem com **turno** definido — configure o turno de
cada operador em Administração antes de usar o fluxo de passar/receber
turno, senão as passagens ficam sem turno registrado.

## Avisos importantes

- **Isso não é segurança de verdade.** O login organiza o uso normal do
  sistema (evita erro operacional, registra quem passou/recebeu cada
  ordem), mas qualquer pessoa com acesso à pasta de rede e algum
  conhecimento técnico pode ler os arquivos em `bd/` ou alterar o
  JavaScript das páginas. Não guarde informação sensível aqui, e não
  reaproveite estas senhas em outros sistemas.
- **Duas pessoas salvando ao mesmo tempo:** o sistema detecta se o arquivo
  mudou desde a última leitura e avisa antes de deixar sobrescrever. Se
  aparecer o aviso de conflito, clique em "Recarregar do disco" na barra do
  topo, refaça a última ação e salve de novo.
- **"Atendidas"/"Não atendidas" (usadas no cálculo de Delivery do quadro
  SQDC) são calculadas automaticamente** a partir da coluna "Status sistema"
  da planilha do SAP:
  nota com status contendo "MSPN" conta como "Não atendida" (ainda sem ordem
  gerada no SAP); qualquer outro status conta como "Atendida". Não há
  lançamento manual — reimportar a planilha já atualiza os números.
- **Importar planilha nunca duplica nota, mas atualiza a que já existe.** A
  chave é o número da Nota: continua sendo sempre uma linha só por nota
  (nunca cria duplicata), mas se ela já existir no banco, os campos vindos
  do SAP são atualizados com a nova leitura da planilha (o SAP é a fonte de
  verdade). Isso é o que permite corrigir uma nota que tinha vindo
  incompleta numa importação anterior — basta reimportar a planilha.

## Ciclo de vida de uma passagem de turno

Cada máquina parada passada de turno é **um único registro** que muda de
status ao longo do tempo (não cria um registro novo a cada troca de turno):

```
aberta  --[próximo turno clica "Receber turno"]-->  recebida
recebida --[continuar parada]--> aberta (volta pro início do ciclo)
recebida --[finalizar]--> finalizada  (calcula o tempo parado)
```

- **Horário dos turnos**: Manhã 05:50–14:10, Tarde 13:50–23:10, Noite
  22:50–06:10 (definidos em `TURNO_HORARIOS`, `js/util.js`).
- **Janela obrigatória de recebimento**: nos primeiros 40 minutos do início
  do próprio turno, se existir alguma passagem `aberta` no setor, o
  operador é obrigatoriamente redirecionado para "Receber Turno" e não
  consegue acessar mais nada do sistema até clicar em "Receber turno" (ação
  em lote, recebe tudo que está aguardando no setor de uma vez). Fora dessa
  janela de 40 min, mesmo com pendência, o operador não é forçado — pode
  receber quando quiser. Isso vale só para operadores com turno definido —
  admin/gestor não têm esse bloqueio.
- **Janela obrigatória de passagem**: nos últimos 40 minutos do fim do
  próprio turno, o operador é obrigatoriamente redirecionado para "Passar
  Turno" e não consegue acessar mais nada do sistema até clicar em
  **"Salvar passagem de turno"** (botão único da tela — não existe mais um
  botão separado só pra "concluir") — mesmo que não tenha nenhuma ordem pra
  passar: nesse caso o botão pede confirmação ("não há nada pra passar
  neste turno?") antes de liberar. A conclusão fica registrada em
  `bd/dados.json` (`confirmacoesTurno`) e vale só para aquele turno/dia —
  no turno seguinte a trava volta a valer.
- **Ao passar turno de novo**: a tela de Passar Turno mostra primeiro as
  ordens que você já tinha recebido, pedindo pra decidir cada uma:
  **Continuar parada** (volta pra `aberta`, pronta pro próximo turno
  receber) ou **Finalizar** (calcula o tempo parado e fecha). Só depois
  disso aparece a lista de ordens novas do setor pra passar (notas que
  ainda não têm nenhuma passagem em andamento).
- **Tempo parado**: calculado como a diferença entre a primeira vez que a
  ordem foi passada (`inicioParadaEm`, que não muda enquanto ela continua
  sendo passada de turno em turno) e o horário de finalização. O horário de
  finalização vem preenchido com "agora" mas pode ser alterado (para o caso
  de a máquina ter voltado a funcionar antes).
- **Mais de 10h parada**: ao finalizar, se o tempo parado passar de 10h, a
  ordem conta como quebra grave no **C** do quadro SQDC (ver seção abaixo) e
  aparece na tabela "Top problemas do mês", no final do `quadro-sfm.html`
  (setor e mês selecionados).

### Eventos de passagem de turno (log permanente)

Diferente do registro de `passagensTurno` acima (que é **um só por ordem**,
sobrescrito a cada troca de turno), `bd/dados.json` (`eventosPassagem`)
guarda **um evento por ação de passar**, numerado sequencialmente e nunca
apagado ou sobrescrito — histórico completo, mesmo que a ordem em si seja
repassada várias vezes depois. Um evento é criado:

- ao **salvar uma passagem** de ordens novas (uma por clique em "Salvar
  passagem", bundle com todas as ordens marcadas daquela vez);
- ao clicar **"Continuar parada"** em Passar Turno (cada clique é um evento
  próprio, com 1 ordem).

Cada evento guarda: número, setor, turno de origem e de destino (calculado
automaticamente pela rotação Manhã → Tarde → Noite → Manhã, `proximoTurno()`
em `js/util.js`), quem passou e quando, e a lista de ordens incluídas com o
**tempo parado até aquele momento** (snapshot — não muda depois, mesmo que a
ordem seja finalizada ou repassada de novo). Quando alguém clica "Receber
tudo" em Receber Turno, todos os eventos ainda pendentes do setor são
marcados com quem recebeu e quando (`DB.marcarEventosPassagemRecebidos`) —
como o recebimento já é em lote por setor, um único clique pode fechar mais
de um evento de uma vez, se houver mais de uma passagem aguardando. Consulta
completa, com o detalhe de cada evento, em Relatórios → "Eventos de
passagem de turno".

## Regra da janela da SFM (janela de datas)

A SFM cobre, de terça a sexta, só o dia anterior. Como não há reunião aos
sábados e domingos, a de **segunda-feira cobre os três dias acumulados:
sexta, sábado e domingo**. `calcularJanelaSfm()` (`js/util.js`) calcula essa
janela sozinha a partir do dia da semana atual — é ela quem limita quais
dias o responsável pode marcar em S/Q no `quadro-sfm.html` (ver seção
abaixo).

## Estrutura do projeto

```
login.html               – autenticação (lê bd/ sozinho, sem vincular nada)
menu.html                – escolha de setor e da ação (Passar/Receber Turno, SFM)
passar-turno.html        – importa a planilha do SAP e registra passagem de turno
receber-turno.html       – lista e finaliza passagens abertas do setor
quadro-sfm.html          – folha SQDC do mês por setor, no mesmo layout da folha impressa
                           que fica exposta no quadro (ver seção própria abaixo)
admin.html               – gestão de usuários (só admin)
relatorios.html          – ordens e passagens de todos os setores (gestor/admin)

bd/dados.json            – usuários, passagens de turno, eventos de passagem de turno
                           (o "banco de dados"; o campo "eficiencia" é legado de quando
                           "não atendidas" era lançada manualmente e não é mais lido —
                           hoje é calculado automaticamente)
bd/dados.js              – espelho de dados.json, gerado automaticamente a cada salvamento
bd/notas.json            – notas/ordens importadas do SAP (outro arquivo de banco de dados)
bd/notas.js              – espelho de notas.json, gerado automaticamente a cada salvamento
bd/quadro.json           – marcações manuais de Segurança e Qualidade do quadro-sfm.html
                           (acidente, quase acidente, retrabalho, falha fornecedor por
                           setor/dia — ver seção "Quadro SQDC" abaixo)
bd/quadro.js             – espelho de quadro.json, gerado automaticamente a cada salvamento

css/style.css             – estilo compartilhado
css/quadro.css            – estilo específico da folha SQDC (quadro-sfm.html)
js/util.js                – classificação de setor/área, datas, formatação
js/auth.js                – hash de senha (PBKDF2) e sessão
js/db.js                  – leitura automática e escrita (File System Access API) de bd/
js/db-ui.js                – barra de status + vínculo da pasta bd (reaproveitada em cada página)
js/quadro-sfm.js           – lógica da folha SQDC (quadro-sfm.html)
js/xlsx.full.min.js        – SheetJS, vendorizado (leitura da planilha do SAP)
js/chart.umd.min.js         – Chart.js, vendorizado (gráficos do quadro SQDC)
```

## Quadro SQDC por setor (`quadro-sfm.html`)

Reproduz, tela por tela, a folha impressa que fica exposta no quadro de cada
setor (modelo em `quadro-sfm.jpeg`): um bloco por letra — **S**afety,
**Q**uality, **D**elivery, **C**ost — válido para o mês inteiro selecionado.
Tem botão de impressão (uma folha por setor) para quem ainda quiser pendurar
a versão em papel.

- **D e C são automáticos**, sem nenhum lançamento manual:
  - **D — Controle de Corretivas Realizadas**: "Realizadas"/"Abertas"/"Pendentes"
    usam a classificação de "Atendida/Não atendida" pelo campo "Status sistema"
    da planilha do SAP, agrupada por "Dt. referência". Meta: 70%.
  - **C — Controle de Quebra Graves**: conta como quebra grave toda máquina
    finalizada em "Receber/Passar Turno" com 10h ou mais de parada — a mesma
    regra que alimenta a tabela "Top problemas do mês" no final desta página.
- **S e Q ainda não têm fonte automática** (não há hoje nenhuma planilha ou
  sistema de segurança/qualidade integrado), então cada dia é marcado à mão
  clicando na célula (cicla: em branco → sem ocorrência, verde → ocorrência,
  vermelho → em branco de novo) e salvo em `bd/quadro.json`. Alternativas para
  automatizar essas duas linhas no futuro, se algum dia existir uma fonte de
  dados: importar uma planilha do SESMT/qualidade por mês (do mesmo jeito que
  a planilha do SAP é importada hoje), ou calcular retrabalho automaticamente
  a partir de notas repetidas no mesmo equipamento em até 2 semanas, se o SAP
  expuser essa informação.
- **Quem pode marcar S/Q**: só o **responsável pela SFM** do setor —
  definido em Administração, um checkbox por usuário (só disponível para
  operadores do turno Manhã; marcar um novo responsável desmarca
  automaticamente o anterior do mesmo setor, sempre no máximo 1 por setor).
  Esse responsável só marca o(s) dia(s) que a reunião de hoje cobre
  (`calcularJanelaSfm()`, a mesma regra da seção abaixo — normalmente só
  ontem, ou sexta+sábado+domingo numa segunda-feira), nunca dias fora
  dessa janela. **Gestor e admin podem editar qualquer dia**, de qualquer
  setor (usado pelo gestor pra conduzir a reunião, alternando entre os
  quadros dos setores sem travar em nenhum). Outros operadores (não
  responsáveis) só visualizam.

## SFM: quem faz o quê

- **Levantamento da SFM** (preencher o quadro SQDC do dia, tela "SFM" =
  `quadro-sfm.html`): sempre feito por alguém do turno **Manhã**, o
  responsável designado pelo admin (ver acima) — e só depois de ter
  recebido o turno (se houver passagem `aberta` pendente dentro da janela
  de recebimento, o sistema já redireciona pra "Receber Turno" antes de
  deixar acessar a SFM).
- **Reunião de SFM**: diária, de segunda a sexta, às 07:40. Quem comanda é
  o gestor, que acompanha o quadro SQDC de cada setor (`quadro-sfm.html`,
  com seletor de setor) — sem precisar editar nada, mas com permissão pra
  corrigir qualquer dia caso necessário.

### Por que dois arquivos por banco (`.json` e `.js`)?

`bd/dados.json` e `bd/notas.json` são os arquivos "de verdade" — legíveis e
editáveis à mão se algum dia precisar. Só que abrir um arquivo local sem
pedir permissão nenhuma (nem pra ler) é uma coisa que os navegadores só
deixam fazer com `<script src="...">`, não com um "carregar arquivo JSON"
comum — por isso cada banco também tem um `.js` gêmeo (`window.__SFM_DADOS__
= {...}`), que é o que as páginas realmente carregam ao abrir, sem pedir
nada. Os dois são escritos juntos, sempre, toda vez que o app salva alguma
coisa. **Não edite os arquivos `.js` na mão** — se precisar editar os dados
manualmente, edite o `.json` e depois abra o sistema uma vez com a pasta
`bd` vinculada e salve qualquer coisa, pra regenerar o `.js` correspondente.

## Classificação automática

- **Setor**, a partir de `Loc.instalação`:
  - contém `TRASU` ou `CONQU` → Controle
  - `USPIS-CEL` + número 003–019 → Gasolina
  - `USPIS-CEL` + número 021–038 → Diesel
  - qualquer outro local → Biela
- **Área**, a partir de `CenTrab respon.`: `MUPMEC` → Mecânica,
  `MUPELE` → Elétrica, outro valor → Outros.

## Sobre a escolha de setor no menu

Operadores têm setor fixo (o próprio) e não escolhem. Admin/gestor escolhem
um setor específico no menu (usado por Passar/Receber Turno e pelo
`quadro-sfm.html`) e podem trocar de setor a qualquer momento, inclusive
dentro do próprio `quadro-sfm.html` (setas ao lado do seletor de setor).

## Colunas usadas na importação da planilha do SAP

A data usada como referência para o cálculo de "Atendidas"/"Não atendidas"
(D do quadro SQDC) vem da coluna **"Dt.
referência"** (aceita variações como "Data referência"/"Data de
referência" e, em planilhas mais antigas, "Data de entrada" ou "Data da
nota" — nessa ordem de prioridade). O horário vem de uma coluna separada,
**"HoraInícioAvar."** (aceita variações como "Hora início avaria"/"Hora de
início da avaria"); se essa coluna não existir, tenta "Hora da nota" e,
por último, um horário embutido na própria célula de data.

As outras colunas continuam: `Ordem`, `Nota`, `Status sistema` (também usado
para calcular "Atendidas"/"Não atendidas" — ver acima), `Status usuário`,
`Tipo de ordem`, `Cen.p/cen.trab.` (aceita também "CenTrab respon."; define
a Área — Mecânica/Elétrica/Outros), `Equipamento`, `Loc.instalação` (define
o Setor), `Descrição` (aceita também "Texto breve"), `Data-base iníc.`,
`Data-base fim`, `Centro custo`, `Criado por`.

**Se o D do quadro SQDC não mostrar nada pra um período que você sabe que tem
ordem**, o motivo quase sempre é a data de referência vindo vazia. Ao
importar, se nenhuma nota da planilha tiver essa data reconhecida, aparece
um aviso na tela — e tem um link "Ver cabeçalhos lidos da planilha
(diagnóstico)" que mostra exatamente quais colunas foram encontradas no
arquivo e quais o sistema conseguiu reconhecer. Se o nome de alguma coluna
na sua planilha for diferente do que o sistema espera, é só nesse
diagnóstico que dá pra confirmar e ajustar. Como a importação atualiza os
campos de uma nota que já existe (nunca duplica a linha), corrigir o
mapeamento e reimportar a mesma planilha conserta as notas que ficaram
incompletas.
