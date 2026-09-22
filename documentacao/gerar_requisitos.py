# -*- coding: utf-8 -*-
"""Gera documentacao/requisitos_sfm.pdf — Documento Consolidado de Requisitos do SFM."""

from reportlab.lib.pagesizes import A4
from reportlab.lib.units import cm
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak,
    ListFlowable, ListItem, KeepTogether, HRFlowable
)
from reportlab.pdfgen import canvas

# ---------------------------------------------------------------------------
# Paleta — azul industrial + laranja (identidade de chão de fábrica / SQDC)
# ---------------------------------------------------------------------------
AZUL_ESCURO = colors.HexColor("#0B2E4F")
AZUL = colors.HexColor("#0B5CAB")
AZUL_CLARO = colors.HexColor("#EAF2FB")
LARANJA = colors.HexColor("#E8752C")
CINZA_TEXTO = colors.HexColor("#26313D")
CINZA_LINHA = colors.HexColor("#D9E2EC")
BRANCO = colors.white

PAGE_W, PAGE_H = A4
MARGIN = 2.0 * cm

styles = getSampleStyleSheet()
styles.add(ParagraphStyle(name="SFMTitle", fontName="Helvetica-Bold", fontSize=26,
                           textColor=AZUL_ESCURO, alignment=TA_CENTER, spaceAfter=6))
styles.add(ParagraphStyle(name="SFMSubtitle", fontName="Helvetica-Bold", fontSize=14,
                           textColor=CINZA_TEXTO, alignment=TA_CENTER, spaceAfter=4))
styles.add(ParagraphStyle(name="SFMH1", fontName="Helvetica-Bold", fontSize=16,
                           textColor=BRANCO, backColor=AZUL, spaceBefore=18, spaceAfter=10,
                           leftIndent=6, borderPadding=(6, 6, 6, 6)))
styles.add(ParagraphStyle(name="SFMH2", fontName="Helvetica-Bold", fontSize=12.5,
                           textColor=AZUL_ESCURO, spaceBefore=12, spaceAfter=6))
styles.add(ParagraphStyle(name="SFMBody", fontName="Helvetica", fontSize=9.7,
                           textColor=CINZA_TEXTO, leading=13.5, alignment=TA_LEFT, spaceAfter=6))
styles.add(ParagraphStyle(name="SFMBullet", fontName="Helvetica", fontSize=9.7,
                           textColor=CINZA_TEXTO, leading=13.5, spaceAfter=2))
styles.add(ParagraphStyle(name="SFMCell", fontName="Helvetica", fontSize=8.6,
                           textColor=CINZA_TEXTO, leading=11.5))
styles.add(ParagraphStyle(name="SFMCellHead", fontName="Helvetica-Bold", fontSize=8.8,
                           textColor=BRANCO, leading=11.5))
styles.add(ParagraphStyle(name="SFMCover", fontName="Helvetica", fontSize=10.5,
                           textColor=CINZA_TEXTO, alignment=TA_CENTER, spaceAfter=4))
styles.add(ParagraphStyle(name="SFMSumario", fontName="Helvetica", fontSize=10.3,
                           textColor=CINZA_TEXTO, leading=18))

def P(text, style="SFMBody"):
    return Paragraph(text, styles[style])

def CH(text):
    return Paragraph(text, styles["SFMCellHead"])

def C(text):
    return Paragraph(text, styles["SFMCell"])

def make_table(header, rows, col_widths, header_bg=AZUL, zebra=AZUL_CLARO, span_first_bold=False):
    data = [[CH(h) for h in header]] + [[C(cell) for cell in row] for row in rows]
    t = Table(data, colWidths=col_widths, repeatRows=1)
    style = [
        ("BACKGROUND", (0, 0), (-1, 0), header_bg),
        ("TEXTCOLOR", (0, 0), (-1, 0), BRANCO),
        ("GRID", (0, 0), (-1, -1), 0.6, CINZA_LINHA),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ]
    for i in range(1, len(data)):
        if i % 2 == 0:
            style.append(("BACKGROUND", (0, i), (-1, i), zebra))
        else:
            style.append(("BACKGROUND", (0, i), (-1, i), BRANCO))
    t.setStyle(TableStyle(style))
    return t

def bullets(items):
    return ListFlowable(
        [ListItem(P(i), leftIndent=6, spaceAfter=3) for i in items],
        bulletType="bullet", start="•", leftIndent=14,
    )

def section(num, title):
    return Paragraph(f"{num}. {title}", styles["SFMH1"])

def subsection(title):
    return Paragraph(title, styles["SFMH2"])


class FooterCanvas(canvas.Canvas):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._saved_states = []

    def showPage(self):
        self._saved_states.append(dict(self.__dict__))
        canvas.Canvas.showPage(self)

    def save(self):
        for state in self._saved_states:
            self.__dict__.update(state)
            self.draw_footer()
            canvas.Canvas.showPage(self)
        canvas.Canvas.save(self)

    def draw_footer(self):
        self.setStrokeColor(CINZA_LINHA)
        self.setLineWidth(0.6)
        self.line(MARGIN, 1.4 * cm, PAGE_W - MARGIN, 1.4 * cm)
        self.setFont("Helvetica", 8)
        self.setFillColor(colors.HexColor("#6B7A89"))
        self.drawCentredString(PAGE_W / 2, 1.0 * cm,
                                "SFM — Documento Consolidado de Requisitos | Uso interno")
        self.drawRightString(PAGE_W - MARGIN, 1.0 * cm, f"Página {self._pageNumber}")


story = []

# ---------------------------------------------------------------------------
# Capa
# ---------------------------------------------------------------------------
story.append(Spacer(1, 2.2 * cm))
story.append(Paragraph("SFM", ParagraphStyle(
    name="Logo", fontName="Helvetica-Bold", fontSize=44, textColor=AZUL,
    alignment=TA_CENTER, spaceAfter=0)))
story.append(Paragraph("Shop Floor Management", ParagraphStyle(
    name="LogoSub", fontName="Helvetica", fontSize=13, textColor=LARANJA,
    alignment=TA_CENTER, spaceAfter=24)))
story.append(Spacer(1, 0.3 * cm))
story.append(Paragraph("Sistema de Passagem de Turno e Painel SQDC", styles["SFMSubtitle"]))
story.append(Paragraph("Documento Consolidado de Requisitos", ParagraphStyle(
    name="MainTitle", fontName="Helvetica-Bold", fontSize=20, textColor=AZUL_ESCURO,
    alignment=TA_CENTER, spaceBefore=6, spaceAfter=18)))
story.append(Paragraph("Versão 1.0", styles["SFMCover"]))
story.append(Paragraph("Data do documento: 18/09/2026", styles["SFMCover"]))
story.append(Spacer(1, 1.0 * cm))

resumo_tbl = Table([[Paragraph(
    "<b>Resumo</b><br/>"
    "O SFM (Shop Floor Management) é uma aplicação web 100% local, sem servidor, que apoia a "
    "reunião diária de chão de fábrica: passagem e recebimento de turno das máquinas paradas "
    "(ordens do SAP) e o painel SQDC (Segurança, Qualidade, Delivery, Custo) de cada setor. "
    "O sistema roda inteiramente no navegador (Chrome/Edge), lendo e gravando os arquivos de "
    "dados diretamente numa pasta de rede compartilhada, sem necessidade de instalação, banco "
    "de dados externo ou conexão com internet.", styles["SFMBody"])]], colWidths=[17 * cm])
resumo_tbl.setStyle(TableStyle([
    ("BOX", (0, 0), (-1, -1), 1, LARANJA),
    ("BACKGROUND", (0, 0), (-1, -1), AZUL_CLARO),
    ("LEFTPADDING", (0, 0), (-1, -1), 12),
    ("RIGHTPADDING", (0, 0), (-1, -1), 12),
    ("TOPPADDING", (0, 0), (-1, -1), 10),
    ("BOTTOMPADDING", (0, 0), (-1, -1), 10),
]))
story.append(resumo_tbl)
story.append(Spacer(1, 0.8 * cm))

story.append(make_table(
    ["Versão", "Data", "Descrição", "Responsável"],
    [
        ["0.1", "08/09/2026", "Primeira versão em produção: login, menu, passar/receber turno "
                               "e importação da planilha do SAP.", "Equipe do projeto"],
        ["0.2", "10/09/2026", "Inclusão do quadro SQDC por setor (folha S/Q/D/C) e dos "
                               "relatórios de ordens e passagens.", "Equipe do projeto"],
        ["0.3", "11/09/2026", "Importação dos dados reais de setembro; ajuste da coluna usada "
                               "como data de abertura da corretiva; remoção do campo Área.", "Equipe do projeto"],
        ["0.4", "17/09/2026", "Remoção do \"Responsável SFM\" único — qualquer operador do "
                               "turno Manhã passa a poder marcar S/Q; edição de setor do usuário "
                               "liberada na Administração.", "Equipe do projeto"],
        ["1.0", "18/09/2026", "Consolidação da documentação de requisitos para referência de "
                               "manutenção e evolução do sistema.", "Equipe do projeto"],
    ],
    col_widths=[1.7 * cm, 2.3 * cm, 9.5 * cm, 3.5 * cm],
))
story.append(PageBreak())

# ---------------------------------------------------------------------------
# Sumário
# ---------------------------------------------------------------------------
story.append(Paragraph("Sumário", styles["SFMH1"]))
sumario_itens = [
    "1. Visão geral do projeto",
    "2. Objetivos e resultados esperados",
    "3. Escopo do produto",
    "4. Stakeholders e perfis de usuário",
    "5. Glossário e siglas",
    "6. Processo atual e processo futuro",
    "7. Regras de negócio",
    "8. Módulos do sistema",
    "9. Requisitos funcionais",
    "10. Requisitos não funcionais",
    "11. Requisitos de dados e dicionário de dados",
    "12. Segurança, acesso e auditoria",
    "13. Importação de dados do SAP",
    "14. Relatórios e indicadores",
    "15. Riscos, limitações e pontos de atenção",
    "16. Critérios de aceite",
    "17. Roadmap e próximos passos",
]
story.append(bullets(sumario_itens))
story.append(PageBreak())

# ---------------------------------------------------------------------------
# 1. Visão geral
# ---------------------------------------------------------------------------
story.append(section("1", "Visão geral do projeto"))
story.append(P(
    "O SFM (Shop Floor Management) é uma solução de uso interno, operada no chão de fábrica, "
    "para organizar a passagem de turno das máquinas paradas e apoiar a reunião diária de SFM "
    "com o painel SQDC (Segurança, Qualidade, Delivery, Custo) de cada setor produtivo."
))
story.append(P(
    "O projeto resolve um problema concreto de operação: hoje a informação sobre qual máquina "
    "está parada, há quanto tempo, e o que já foi feito para resolver, se perde entre turnos e "
    "depende de comunicação verbal ou anotações soltas. O SFM torna esse histórico contínuo, "
    "rastreável e visível para todos os turnos e setores, além de automatizar o cálculo dos "
    "indicadores de Delivery (corretivas atendidas) e Custo (quebras graves) a partir da "
    "planilha de ordens do SAP."
))
story.append(subsection("Diretriz central"))
diretriz = Table([[P(
    "O sistema é local por decisão de projeto: não há servidor, banco de dados externo, nuvem "
    "ou autenticação corporativa. Todos os dados vivem em arquivos JSON dentro da pasta "
    "<b>bd/</b>, compartilhada por rede. Essa escolha prioriza simplicidade de implantação "
    "(basta copiar a pasta e abrir no navegador) em troca de segurança formal — ver seção 12."
)]], colWidths=[17 * cm])
diretriz.setStyle(TableStyle([
    ("BOX", (0, 0), (-1, -1), 1, LARANJA), ("BACKGROUND", (0, 0), (-1, -1), AZUL_CLARO),
    ("LEFTPADDING", (0, 0), (-1, -1), 12), ("RIGHTPADDING", (0, 0), (-1, -1), 12),
    ("TOPPADDING", (0, 0), (-1, -1), 8), ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
]))
story.append(diretriz)

story.append(subsection("1.1 Contexto do problema"))
story.append(bullets([
    "Máquinas paradas e o que já foi tentado ficam registrados de forma dispersa (papel, "
    "conversa, memória do operador), sem histórico entre turnos.",
    "O cálculo de indicadores como \"corretivas atendidas\" e \"quebras graves\" era manual, "
    "feito olhando a planilha do SAP linha por linha.",
    "O quadro SQDC físico, pendurado em cada setor, dependia de atualização manual e não tinha "
    "versão digital nem histórico consultável por dia.",
    "Não havia registro de quem passou e quem recebeu cada máquina parada, nem de quanto "
    "tempo ela ficou parada de fato.",
]))
story.append(subsection("1.2 Público-alvo do sistema"))
story.append(P(
    "Operadores de produção (papel <b>operador</b>, com setor e turno fixos), gestores da "
    "planta (papel <b>gestor</b>) e administradores do sistema (papel <b>admin</b>). O acesso é "
    "segregado por papel e, para operadores, também pelo setor de que fazem parte."
))

# ---------------------------------------------------------------------------
# 2. Objetivos
# ---------------------------------------------------------------------------
story.append(section("2", "Objetivos e resultados esperados"))
story.append(subsection("2.1 Objetivo geral"))
story.append(P(
    "Centralizar e padronizar o controle de passagem de turno das máquinas paradas e o "
    "acompanhamento diário do quadro SQDC por setor, eliminando cálculo manual de indicadores "
    "e dando rastreabilidade completa a cada parada e a cada passagem entre turnos."
))
story.append(subsection("2.2 Objetivos específicos"))
story.append(bullets([
    "Registrar cada máquina parada como um único caso que evolui de status (aberta → recebida "
    "→ finalizada), sem duplicar registros a cada troca de turno.",
    "Calcular automaticamente o tempo parado de cada ordem, a partir do primeiro momento em "
    "que ela foi passada de turno.",
    "Importar a planilha de ordens do SAP, reconhecendo colunas por nome (mesmo com variações) "
    "e atualizando notas já existentes sem duplicar linhas.",
    "Classificar automaticamente o setor de cada nota a partir da coluna Loc.instalação.",
    "Calcular automaticamente os indicadores de Delivery (% de corretivas atendidas) e Custo "
    "(quebras graves ≥ 10h) do quadro SQDC, sem lançamento manual.",
    "Registrar manualmente as ocorrências de Segurança e Qualidade do quadro SQDC, quando não "
    "há fonte de dados automática disponível.",
    "Manter histórico permanente de cada passagem de turno (eventos de passagem), mesmo que a "
    "ordem em si seja repassada várias vezes depois.",
    "Impedir operação fora de hora: obrigar recebimento e passagem de turno dentro de janelas "
    "de tempo definidas, e restringir marcação do SQDC à janela de dias que a SFM do dia cobre.",
]))
story.append(subsection("2.3 Resultados esperados"))
story.append(bullets([
    "Fim do cálculo manual de indicadores de Delivery e Custo — hoje automáticos a partir da "
    "reimportação da planilha do SAP.",
    "Histórico confiável de quanto tempo cada máquina ficou parada e quem tratou cada etapa.",
    "Reunião de SFM mais objetiva, com o quadro SQDC de cada setor disponível na tela em "
    "segundos, incluindo dias passados.",
    "Redução de erro operacional por acesso fora de hora ou por pessoa sem permissão para o "
    "setor.",
]))

# ---------------------------------------------------------------------------
# 3. Escopo
# ---------------------------------------------------------------------------
story.append(section("3", "Escopo do produto"))
story.append(subsection("3.1 Dentro do escopo atual"))
story.append(bullets([
    "Autenticação local por usuário/senha (hash PBKDF2), com papel e setor fixos.",
    "Passagem e recebimento de turno de máquinas paradas, com ciclo de status completo.",
    "Importação da planilha de ordens do SAP (formato .xlsx), com reconhecimento flexível de "
    "colunas e deduplicação por número de Nota.",
    "Quadro SQDC por setor (S, Q, D, C) com granularidade diária e visão mensal, incluindo "
    "impressão de folha por setor.",
    "Relatórios de ordens, passagens de turno e eventos de passagem, para gestor e admin, com "
    "visão de todos os setores.",
    "Administração de usuários: criação, edição de papel/setor/turno, e marcação de quem pode "
    "atuar no turno Manhã.",
]))
story.append(subsection("3.2 Fora do escopo atual"))
story.append(bullets([
    "Servidor, banco de dados relacional/nuvem, autenticação corporativa (SSO/Active "
    "Directory) ou acesso fora da rede local.",
    "Aplicativo mobile dedicado.",
    "Integração automática/API com o SAP — a entrada de dados é sempre por importação manual "
    "de planilha .xlsx exportada pelo usuário.",
    "Fonte automática de dados de Segurança e Qualidade (S e Q do SQDC) — hoje são sempre "
    "lançamentos manuais, por não existir hoje um sistema/planilha de origem.",
    "Controle de acesso por criptografia de dados em repouso ou trilha de auditoria formal de "
    "leitura (ver seção 12 sobre limitações de segurança).",
]))
story.append(subsection("3.3 Premissas"))
story.append(bullets([
    "Todos os usuários operam no mesmo Chrome/Edge, com acesso de escrita à pasta de rede "
    "onde vive a pasta bd/.",
    "A planilha do SAP é exportada manualmente pelo usuário fora do sistema e depois "
    "importada em Passar Turno.",
    "O horário do computador de cada usuário está correto, pois todas as janelas obrigatórias "
    "(passar/receber turno, marcar SQDC) dependem do relógio local.",
]))
story.append(subsection("3.4 Restrições conhecidas"))
story.append(bullets([
    "Sem servidor, dois usuários salvando ao mesmo tempo podem gerar conflito — o sistema "
    "detecta e avisa, mas a resolução (recarregar e refazer a ação) é manual.",
    "Navegadores fora de Chrome/Edge, ou versões antigas, não suportam gravação direta na "
    "pasta de rede (File System Access API); nesse caso os arquivos são baixados e precisam "
    "ser copiados manualmente para bd/.",
    "A confiabilidade dos indicadores automáticos (D e C do SQDC) depende da planilha do SAP "
    "trazer as colunas de data/hora esperadas — ver seção 13.",
]))

# ---------------------------------------------------------------------------
# 4. Stakeholders
# ---------------------------------------------------------------------------
story.append(section("4", "Stakeholders e perfis de usuário"))
story.append(make_table(
    ["Perfil", "Papel no sistema", "Restrições"],
    [
        ["Operador", "Passa e recebe turno das máquinas do próprio setor; se estiver no turno "
                      "Manhã, pode marcar S/Q do quadro SQDC do próprio setor.",
         "Só enxerga e opera o próprio setor; janelas obrigatórias de passar/receber turno se "
         "aplicam; não acessa Relatórios nem Administração."],
        ["Gestor", "Acompanha o quadro SQDC de qualquer setor durante a reunião diária, "
                   "podendo alternar entre setores; acessa Relatórios consolidados.",
         "Pode corrigir qualquer dia/setor no SQDC quando necessário; não tem janela "
         "obrigatória de passar/receber turno."],
        ["Administrador", "Gerencia usuários (criar, editar papel/setor/turno, senha) e tem os "
                           "mesmos acessos do gestor.",
         "Acesso mais amplo do sistema; não há papel de auditoria separado hoje."],
    ],
    col_widths=[3.2 * cm, 8.3 * cm, 5.5 * cm],
))
story.append(Spacer(1, 0.3 * cm))
story.append(P(
    "<b>Observação:</b> o campo <i>responsavelSfm</i> existente no cadastro do usuário é um "
    "resquício do modelo antigo, em que só uma pessoa por setor podia marcar o SQDC. Hoje "
    "qualquer operador do turno Manhã do setor pode marcar (ver seção 7, RN-06), então esse "
    "campo não é mais usado para bloquear a ação — só o turno e o setor importam."
))

# ---------------------------------------------------------------------------
# 5. Glossário
# ---------------------------------------------------------------------------
story.append(section("5", "Glossário e siglas"))
story.append(make_table(
    ["Termo", "Significado"],
    [
        ["SFM", "Shop Floor Management. Também é o nome da reunião diária e da tela do "
                "quadro (quadro-sfm.html)."],
        ["SQDC", "Safety, Quality, Delivery, Cost — os quatro blocos do quadro de indicadores "
                 "diários por setor."],
        ["Nota / Ordem", "Identificadores da corretiva no SAP. A Nota é a chave usada para "
                          "evitar duplicidade na importação; a Ordem é gerada depois, quando o "
                          "reparo é de fato tratado."],
        ["Setor", "Um de Gasolina, Diesel, Controle ou Biela — classificado automaticamente a "
                  "partir da coluna Loc.instalação da planilha do SAP."],
        ["Turno", "Manhã (05:50–14:10), Tarde (13:50–23:10) ou Noite (22:50–06:10)."],
        ["Passagem de turno", "Ato de registrar uma máquina parada para o próximo turno tratar, "
                               "ou de decidir se uma máquina já recebida continua parada ou foi "
                               "finalizada."],
        ["Atendida / Não atendida", "Classificação automática da corretiva a partir do \"Status "
                                     "sistema\" da planilha do SAP: contém \"MSPN\" → Não "
                                     "atendida; qualquer outro valor → Atendida."],
        ["Quebra grave", "Máquina finalizada com 10 horas ou mais de tempo parado — conta no "
                          "indicador Custo (C) do SQDC e na tabela Top problemas do dia."],
        ["Janela da SFM", "Conjunto de dias que a reunião de hoje cobre — normalmente só ontem; "
                           "numa segunda-feira, cobre sexta, sábado e domingo."],
    ],
    col_widths=[3.5 * cm, 13.5 * cm],
))

story.append(PageBreak())

# ---------------------------------------------------------------------------
# 6. Processo atual e futuro
# ---------------------------------------------------------------------------
story.append(section("6", "Processo atual e processo futuro"))
story.append(subsection("6.1 Processo antes do SFM — AS IS"))
story.append(bullets([
    "Operador identifica máquina parada e comunica verbalmente ou por anotação ao próximo "
    "turno.",
    "Não há registro estruturado de quando a parada começou nem de quem já tratou o quê.",
    "O gestor calcula manualmente, olhando a planilha do SAP, quantas corretivas foram "
    "atendidas e quais quebras passaram de 10h.",
    "O quadro SQDC físico é preenchido à mão no papel, sem histórico digital.",
]))
story.append(subsection("6.2 Processo com o SFM — TO BE (implementado)"))
story.append(bullets([
    "Operador abre o sistema (login.html), que já lê os dados de bd/ automaticamente.",
    "Se houver passagem pendente de recebimento dentro da janela de 40 min do início do "
    "turno, o sistema redireciona obrigatoriamente para Receber Turno.",
    "Ao final do turno, dentro da janela de 40 min antes do fim, o sistema redireciona "
    "obrigatoriamente para Passar Turno: primeiro decide o destino de cada ordem já recebida "
    "(continuar parada ou finalizar), depois registra as ordens novas do setor.",
    "A planilha do SAP é importada em Passar Turno: os dados são validados, o setor de cada "
    "nota é classificado automaticamente e as notas já existentes são atualizadas (nunca "
    "duplicadas).",
    "Na reunião diária das 07:40, o gestor abre quadro-sfm.html e navega pelos setores, "
    "acompanhando S, Q, D e C do dia, incluindo a tabela de Top problemas.",
    "Um operador do turno Manhã do setor marca S/Q para o(s) dia(s) que a janela da SFM "
    "cobre, se ainda não tiver sido marcado.",
]))

# ---------------------------------------------------------------------------
# 7. Regras de negócio
# ---------------------------------------------------------------------------
story.append(section("7", "Regras de negócio"))
story.append(make_table(
    ["ID", "Regra de negócio", "Observação"],
    [
        ["RN-01", "Uma máquina parada é um único registro (passagensTurno) que muda de status "
                  "ao longo do tempo: aberta → recebida → (aberta de novo ou finalizada).",
         "Não é permitido criar um novo registro a cada troca de turno."],
        ["RN-02", "O tempo parado é calculado como a diferença entre inicioParadaEm (fixado na "
                  "primeira vez que a ordem foi passada) e finalizadaEm.",
         "inicioParadaEm nunca muda, mesmo que a ordem seja repassada várias vezes."],
        ["RN-03", "Toda ordem finalizada com 10h ou mais de parada conta como quebra grave no "
                  "indicador C do SQDC e aparece no Top problemas do dia.",
         "Constante LIMITE_PARADA_MINUTOS em js/util.js."],
        ["RN-04", "\"Atendida\"/\"Não atendida\" são sempre calculadas a partir do Status "
                  "sistema da planilha do SAP — nota com \"MSPN\" no status é Não atendida.",
         "Não existe lançamento manual dessas classificações."],
        ["RN-05", "Importar a planilha nunca duplica uma nota: a chave é o número da Nota. Se "
                  "já existir, os campos são atualizados com a nova leitura.",
         "Permite corrigir uma nota incompleta reimportando a planilha."],
        ["RN-06", "Qualquer operador do turno Manhã do setor pode marcar S/Q do quadro SQDC; "
                  "gestor e admin podem marcar/corrigir qualquer setor e qualquer dia.",
         "Não existe mais um \"responsável SFM\" único por setor."],
        ["RN-07", "A marcação de S/Q só é permitida para os dias que a janela da SFM do dia "
                  "real cobre (calcularJanelaSfm) — nunca dias fora dessa janela.",
         "Visualizar um dia passado no quadro não libera editá-lo."],
        ["RN-08", "Operador com turno definido é obrigatoriamente redirecionado para Receber "
                  "Turno se houver passagem aberta pendente, dentro dos 40 min iniciais do "
                  "turno; e para Passar Turno, dentro dos 40 min finais.",
         "Admin/gestor não têm esse bloqueio; fora da janela, a pendência não bloqueia o "
         "operador."],
        ["RN-09", "Todo evento de passagem de turno é numerado sequencialmente e nunca é "
                  "apagado ou sobrescrito — é histórico permanente, separado do registro "
                  "\"atual\" da ordem.",
         "Consultável em Relatórios → Eventos de passagem de turno."],
        ["RN-10", "O setor de cada nota é classificado automaticamente pela coluna "
                  "Loc.instalação (classificarSetor), nunca digitado manualmente.",
         "Ver regras de classificação na seção 13."],
    ],
    col_widths=[1.6 * cm, 10.2 * cm, 5.2 * cm],
))

story.append(PageBreak())

# ---------------------------------------------------------------------------
# 8. Módulos
# ---------------------------------------------------------------------------
story.append(section("8", "Módulos do sistema"))
story.append(make_table(
    ["Módulo", "Tela(s)", "Finalidade"],
    [
        ["Autenticação", "login.html", "Login local por usuário/senha (hash PBKDF2) e início "
                          "de sessão."],
        ["Menu / navegação", "menu.html", "Escolha de setor (para admin/gestor) e da ação "
                              "(Passar/Receber Turno, SFM)."],
        ["Passagem de turno", "passar-turno.html", "Importação da planilha do SAP e registro "
                               "de novas máquinas paradas e decisões sobre as já recebidas."],
        ["Recebimento de turno", "receber-turno.html", "Lista e recebe em lote as passagens "
                                  "abertas do setor."],
        ["Quadro SQDC", "quadro-sfm.html", "Folha SQDC mensal por setor, com seletor de dia, "
                         "marcação manual de S/Q, cálculo automático de D/C e impressão."],
        ["Relatórios", "relatorios.html", "Visão consolidada de ordens, passagens de turno e "
                        "eventos de passagem de todos os setores (gestor/admin)."],
        ["Administração", "admin.html", "Cadastro e edição de usuários: papel, setor, turno e "
                           "senha (só admin)."],
    ],
    col_widths=[3.3 * cm, 3.7 * cm, 10.0 * cm],
))

# ---------------------------------------------------------------------------
# 9. Requisitos funcionais
# ---------------------------------------------------------------------------
story.append(section("9", "Requisitos funcionais"))
story.append(P(
    "A tabela consolida os requisitos funcionais implementados. Prioridade em MoSCoW; status "
    "reflete a implementação atual (todos os itens \"Feito\" já estão em produção)."
))
rf_rows = [
    ["RF-01", "Autenticar usuário local por nome e senha, com hash PBKDF2 e salt.", "Must", "Feito"],
    ["RF-02", "Definir papel (operador/gestor/admin) e, para operador, setor e turno fixos.", "Must", "Feito"],
    ["RF-03", "Redirecionar obrigatoriamente para Receber Turno quando houver passagem aberta "
              "pendente dentro da janela de 40 min inicial do turno.", "Must", "Feito"],
    ["RF-04", "Redirecionar obrigatoriamente para Passar Turno dentro da janela de 40 min "
              "final do turno, exigindo decisão sobre cada ordem recebida antes de liberar "
              "novas ordens.", "Must", "Feito"],
    ["RF-05", "Registrar nova máquina parada com nota, descrição e datas/horários.", "Must", "Feito"],
    ["RF-06", "Permitir decidir, ao passar turno de novo, se cada ordem recebida continua "
              "parada (volta a aberta) ou é finalizada (calcula tempo parado).", "Must", "Feito"],
    ["RF-07", "Receber em lote todas as passagens abertas do setor com um único clique.", "Must", "Feito"],
    ["RF-08", "Importar planilha .xlsx do SAP reconhecendo variações de nome de coluna "
              "(Data da nota, Dt.referência, Data de entrada, Hora da nota, "
              "HoraInícioAvar., etc.).", "Must", "Feito"],
    ["RF-09", "Classificar automaticamente o setor de cada nota pela coluna Loc.instalação.", "Must", "Feito"],
    ["RF-10", "Atualizar nota já existente ao reimportar a planilha, sem duplicar linha "
              "(chave: número da Nota).", "Must", "Feito"],
    ["RF-11", "Exibir diagnóstico dos cabeçalhos lidos da planilha quando a data de referência "
              "não for reconhecida em nenhuma nota.", "Should", "Feito"],
    ["RF-12", "Calcular automaticamente \"Atendida\"/\"Não atendida\" a partir do Status "
              "sistema (contém \"MSPN\" → Não atendida).", "Must", "Feito"],
    ["RF-13", "Exibir quadro SQDC por setor e por dia, com S, Q, D e C, no layout da folha "
              "impressa.", "Must", "Feito"],
    ["RF-14", "Calcular D (Delivery) automaticamente: Realizadas/Abertas/Pendentes por "
              "Dt.referência, meta 70%.", "Must", "Feito"],
    ["RF-15", "Calcular C (Cost) automaticamente: quebras graves (≥10h de parada).", "Must", "Feito"],
    ["RF-16", "Permitir marcação manual de S e Q (acidente, quase acidente, retrabalho, falha "
              "de fornecedor) por operador do turno Manhã do setor, ciclando "
              "em branco/ocorrência.", "Must", "Feito"],
    ["RF-17", "Restringir a marcação de S/Q aos dias definidos pela janela da SFM do dia "
              "corrente.", "Must", "Feito"],
    ["RF-18", "Permitir que gestor/admin editem S/Q de qualquer setor e qualquer dia.", "Must", "Feito"],
    ["RF-19", "Exibir tabela \"Top problemas do dia\" com as quebras graves do setor/dia "
              "selecionado.", "Should", "Feito"],
    ["RF-20", "Permitir impressão de uma folha por setor do quadro SQDC.", "Could", "Feito"],
    ["RF-21", "Consolidar relatórios de ordens, passagens de turno e eventos de passagem de "
              "todos os setores para gestor/admin.", "Must", "Feito"],
    ["RF-22", "Manter histórico permanente de eventos de passagem (nunca sobrescritos), "
              "distinto do registro atual da ordem.", "Must", "Feito"],
    ["RF-23", "Marcar em lote os eventos de passagem como recebidos quando o setor recebe "
              "tudo.", "Must", "Feito"],
    ["RF-24", "Gerenciar usuários (criar, editar papel, setor, turno e senha) em uma única "
              "tela de Administração.", "Must", "Feito"],
    ["RF-25", "Detectar conflito de gravação (arquivo mudado desde a última leitura) e avisar "
              "antes de sobrescrever.", "Must", "Feito"],
    ["RF-26", "Baixar arquivo atualizado automaticamente quando o navegador não suportar "
              "gravação direta na pasta de rede.", "Should", "Feito"],
]
story.append(make_table(
    ["ID", "Requisito", "Prioridade", "Status"],
    rf_rows,
    col_widths=[1.5 * cm, 11.7 * cm, 2.2 * cm, 1.6 * cm],
))

story.append(PageBreak())

# ---------------------------------------------------------------------------
# 10. Requisitos não funcionais
# ---------------------------------------------------------------------------
story.append(section("10", "Requisitos não funcionais"))
rnf_rows = [
    ["RNF-01", "Implantação", "Rodar 100% no navegador (Chrome/Edge), sem instalação nem "
               "servidor.", "Must"],
    ["RNF-02", "Persistência", "Ler e gravar dados diretamente em arquivos JSON na pasta de "
               "rede bd/, via File System Access API.", "Must"],
    ["RNF-03", "Compatibilidade", "Funcionar em Chrome e Edge; degradar para download manual "
               "de arquivo em navegadores sem suporte à gravação direta.", "Must"],
    ["RNF-04", "Concorrência", "Detectar quando o arquivo foi alterado por outra pessoa desde "
               "a última leitura e impedir sobrescrita silenciosa.", "Must"],
    ["RNF-05", "Desempenho", "Telas de consulta (quadro, relatórios) devem responder de forma "
               "fluida com o volume de notas atual (dezenas de milhares de "
               "linhas em notas.json).", "Should"],
    ["RNF-06", "Usabilidade", "Interface simples, adequada para uso em chão de fábrica "
               "(desktop/tablet), sem necessidade de treinamento extenso.", "Must"],
    ["RNF-07", "Confiabilidade dos dados", "bd/dados.js e bd/notas.js (espelhos lidos via "
               "&lt;script&gt;) devem ser sempre regenerados junto com o .json "
               "correspondente, nunca editados à mão.", "Must"],
    ["RNF-08", "Rastreabilidade mínima", "Toda passagem/recebimento de turno registra quem fez "
               "e quando (registradoPor, recebidoPor, datas).", "Must"],
    ["RNF-09", "Consistência de horário", "As janelas obrigatórias de turno e a janela da SFM "
               "dependem do relógio local do computador de cada usuário "
               "estar correto.", "Should"],
    ["RNF-10", "Portabilidade", "Todo o sistema deve poder ser copiado como pasta única para "
               "outra rede/servidor de arquivos sem alteração de código.", "Should"],
]
story.append(make_table(
    ["ID", "Categoria", "Requisito", "Prioridade"],
    rnf_rows,
    col_widths=[1.7 * cm, 3.3 * cm, 10.5 * cm, 1.5 * cm],
))

# ---------------------------------------------------------------------------
# 11. Dados
# ---------------------------------------------------------------------------
story.append(section("11", "Requisitos de dados e dicionário de dados"))
story.append(P(
    "O SFM não usa banco de dados relacional: cada \"tabela\" é uma coleção dentro de um "
    "arquivo JSON. Cada arquivo .json tem um espelho .js (window.__SFM_*__) regenerado "
    "automaticamente a cada gravação, usado para leitura inicial sem exigir permissão do "
    "navegador."
))
story.append(subsection("11.1 Visão geral dos arquivos"))
story.append(make_table(
    ["Arquivo", "Coleções", "Conteúdo"],
    [
        ["bd/dados.json", "usuarios, passagensTurno, eventosPassagem, confirmacoesTurno",
         "Usuários do sistema, estado atual de cada máquina parada, histórico permanente de "
         "eventos de passagem e registro de conclusão de turno por dia."],
        ["bd/notas.json", "(lista de notas)", "Notas/ordens importadas da planilha do SAP — "
         "uma linha por número de Nota, atualizada a cada reimportação."],
        ["bd/quadro.json", "registros (chave setor|data)", "Marcações manuais de Segurança e "
         "Qualidade do quadro SQDC por setor e dia."],
    ],
    col_widths=[3.3 * cm, 5.0 * cm, 8.7 * cm],
))

story.append(subsection("11.2 Entidade: Usuário (usuarios)"))
story.append(make_table(
    ["Campo", "Obrig.", "Tipo / domínio", "Observação"],
    [
        ["id", "Automático", "Texto (\"u-\" + nome/uuid)", "Identificador interno, gerado na criação."],
        ["nome", "Obrigatório", "Texto único", "Usado como login."],
        ["senhaHash / senhaSalt", "Obrigatório", "Base64 (PBKDF2)", "Senha nunca armazenada em texto puro."],
        ["papel", "Obrigatório", "admin, gestor, operador", "Define as telas e ações permitidas."],
        ["setor", "Condicional", "Gasolina, Diesel, Controle, Biela ou null", "Obrigatório para operador; null para admin/gestor (escolhem no menu)."],
        ["turno", "Condicional", "Manhã, Tarde, Noite", "Só operador; define as janelas obrigatórias e se pode marcar SQDC."],
        ["responsavelSfm", "Opcional", "Booleano", "Campo legado — não bloqueia mais a marcação do SQDC (ver seção 4)."],
    ],
    col_widths=[3.3 * cm, 1.9 * cm, 4.8 * cm, 7.0 * cm],
))

story.append(subsection("11.3 Entidade: Passagem de turno (passagensTurno)"))
story.append(make_table(
    ["Campo", "Obrig.", "Tipo / domínio", "Observação"],
    [
        ["id", "Automático", "Texto (\"pt-\" + uuid)", "Identificador interno."],
        ["nota", "Obrigatório", "Texto", "Número da nota/ordem, referência à planilha do SAP."],
        ["setor", "Obrigatório", "Domínio de setores", "Define quem pode ver/tratar a ordem."],
        ["turno", "Obrigatório", "Domínio de turnos", "Turno de origem do registro."],
        ["descricao", "Opcional", "Texto", "Observação livre sobre a parada."],
        ["dataHora", "Automático", "Data/hora ISO", "Momento do registro inicial."],
        ["status", "Obrigatório", "aberta, recebida, finalizada", "Controla o ciclo de vida (RN-01)."],
        ["inicioParadaEm", "Automático", "Data/hora ISO", "Fixado na primeira passagem; base do cálculo de tempo parado (RN-02)."],
        ["finalizadaEm", "Condicional", "Data/hora ISO", "Preenchido ao finalizar; editável para ajustar o horário real."],
        ["registradoPor / recebidoPor", "Automático", "Nome de usuário", "Rastreabilidade de quem passou e quem recebeu."],
        ["recebidoEm", "Condicional", "Data/hora ISO", "Momento do recebimento."],
    ],
    col_widths=[3.3 * cm, 1.9 * cm, 4.4 * cm, 7.4 * cm],
))

story.append(subsection("11.4 Entidade: Nota/ordem (bd/notas.json)"))
story.append(make_table(
    ["Campo", "Obrig.", "Tipo / domínio", "Observação"],
    [
        ["nota", "Obrigatório", "Texto (chave única)", "Chave de deduplicação na importação (RN-05)."],
        ["ordem", "Opcional", "Texto", "Número da ordem gerada no SAP, quando existir."],
        ["statusSistema / statusUsuario", "Condicional", "Texto (domínio SAP)", "statusSistema alimenta o cálculo de Atendida/Não atendida (RN-04)."],
        ["loc", "Condicional", "Texto (Loc.instalação)", "Base da classificação automática de setor."],
        ["setor", "Automático", "Domínio de setores", "Resultado de classificarSetor(loc)."],
        ["dataEntrada / horaEntrada", "Condicional", "Data ISO / HH:mm", "Data/hora de abertura da nota, usada como referência do D do SQDC (ver seção 13)."],
        ["textoBreve", "Opcional", "Texto", "Descrição da ocorrência."],
        ["centroCusto, centrab, equipamento, criadoPor", "Opcional", "Texto", "Campos informativos vindos direto da planilha do SAP."],
        ["atualizadoEm", "Automático", "Data/hora ISO", "Última vez que a linha foi atualizada por importação."],
    ],
    col_widths=[3.6 * cm, 1.9 * cm, 4.1 * cm, 7.4 * cm],
))

story.append(subsection("11.5 Entidade: Registro do quadro SQDC (bd/quadro.json)"))
story.append(make_table(
    ["Campo", "Obrig.", "Tipo / domínio", "Observação"],
    [
        ["setor / data", "Obrigatório", "Domínio de setores / data ISO", "Compõem a chave do registro (\"Setor|AAAA-MM-DD\")."],
        ["acidente / quaseAcidente", "Obrigatório", "Booleano", "Marcações manuais de Segurança (S)."],
        ["retrabalho / falhaFornecedor", "Obrigatório", "Booleano", "Marcações manuais de Qualidade (Q)."],
    ],
    col_widths=[4.5 * cm, 2.1 * cm, 5.0 * cm, 5.4 * cm],
))

story.append(PageBreak())

# ---------------------------------------------------------------------------
# 12. Segurança
# ---------------------------------------------------------------------------
story.append(section("12", "Segurança, acesso e auditoria"))
story.append(P(
    "O SFM organiza o uso normal do sistema, mas <b>não é uma solução de segurança de "
    "verdade</b> — essa limitação é conhecida e aceita pelo projeto, dado o modelo 100% local. "
    "Qualquer pessoa com acesso de leitura à pasta de rede e algum conhecimento técnico pode "
    "ler os arquivos em bd/ ou alterar o JavaScript das páginas."
))
story.append(subsection("12.1 Controles existentes"))
story.append(bullets([
    "Senhas armazenadas como hash PBKDF2 com salt (nunca em texto puro).",
    "Papel (admin/gestor/operador) e setor controlam quais telas e ações cada usuário vê.",
    "Cada passagem/recebimento de turno registra quem executou a ação e quando.",
    "Detecção de conflito de gravação concorrente entre dois usuários salvando ao mesmo "
    "tempo, com aviso antes de sobrescrever.",
]))
story.append(subsection("12.2 Limitações conhecidas (aceitas pelo projeto)"))
story.append(bullets([
    "Não há criptografia dos dados em repouso — os arquivos JSON ficam legíveis por quem "
    "tiver acesso à pasta de rede.",
    "Não há trilha de auditoria de leitura/consulta — apenas ações de escrita (passar, "
    "receber, marcar SQDC, editar usuário) ficam registradas.",
    "Não há expiração de sessão ou autenticação multifator.",
    "Recomenda-se não guardar informação sensível no sistema e trocar as senhas de teste "
    "(admin/admin, gestor/gestor, etc.) antes do uso real."
]))
story.append(subsection("12.3 Matriz de acesso"))
story.append(make_table(
    ["Funcionalidade", "Operador", "Gestor", "Admin"],
    [
        ["Passar/receber turno do próprio setor", "Sim", "Sim (qualquer setor)", "Sim (qualquer setor)"],
        ["Marcar S/Q do quadro SQDC", "Só se turno Manhã, só dias da janela SFM, só o próprio setor", "Sim, qualquer setor e dia", "Sim, qualquer setor e dia"],
        ["Visualizar quadro SQDC", "Só o próprio setor", "Qualquer setor", "Qualquer setor"],
        ["Relatórios consolidados", "Não", "Sim", "Sim"],
        ["Administração de usuários", "Não", "Não", "Sim"],
    ],
    col_widths=[5.5 * cm, 4.5 * cm, 3.7 * cm, 3.3 * cm],
))

# ---------------------------------------------------------------------------
# 13. Importação SAP
# ---------------------------------------------------------------------------
story.append(section("13", "Importação de dados do SAP"))
story.append(P(
    "A entrada de dados de ordens/notas é sempre por importação manual de uma planilha .xlsx "
    "exportada do SAP, feita na tela Passar Turno."
))
story.append(subsection("13.1 Reconhecimento de colunas"))
story.append(bullets([
    "Data de referência do D do SQDC: prioriza \"Data da nota\"; na ausência, tenta "
    "\"Dt.referência\" (aceita variações como \"Data referência\"/\"Data de referência\"); por "
    "último, \"Data de entrada\".",
    "Horário: acompanha a mesma coluna via \"Hora da nota\"; na ausência, tenta "
    "\"HoraInícioAvar.\" (aceita variações); por último, um horário embutido na própria célula "
    "de data.",
    "Demais colunas: Ordem, Nota, Status sistema, Status usuário, Tipo de ordem, "
    "Cen.p/cen.trab. (aceita \"CenTrab respon.\"), Equipamento, Loc.instalação, Descrição "
    "(aceita \"Texto breve\"), Data-base iníc., Data-base fim, Centro custo, Criado por.",
]))
story.append(subsection("13.2 Regras de validação e diagnóstico"))
story.append(bullets([
    "Se nenhuma nota da planilha tiver data de referência reconhecida, o sistema exibe um "
    "aviso e disponibiliza um diagnóstico com os cabeçalhos efetivamente lidos.",
    "A reimportação da mesma planilha (ou de uma corrigida) atualiza os campos das notas já "
    "existentes, sem nunca duplicar linha — a chave é sempre o número da Nota.",
]))

# ---------------------------------------------------------------------------
# 14. Relatórios
# ---------------------------------------------------------------------------
story.append(section("14", "Relatórios e indicadores"))
story.append(make_table(
    ["Indicador / relatório", "Fonte", "Cálculo"],
    [
        ["D — Controle de Corretivas Realizadas", "bd/notas.json", "Realizadas/Abertas/"
         "Pendentes por Dt. referência, usando Atendida/Não atendida (RN-04). Meta: 70%."],
        ["C — Controle de Quebras Graves", "bd/dados.json (passagensTurno finalizadas)", "Toda "
         "máquina finalizada com tempo parado ≥ 10h conta como quebra grave (RN-03)."],
        ["S e Q do quadro SQDC", "bd/quadro.json", "Marcação manual por dia/setor — sem fonte "
         "automática hoje."],
        ["Top problemas do dia", "bd/dados.json", "Lista as quebras graves do setor/dia "
         "selecionado no quadro SQDC."],
        ["Relatório de ordens", "bd/notas.json", "Visão consolidada de todas as notas "
         "importadas, filtrável por setor."],
        ["Relatório de passagens de turno", "bd/dados.json", "Estado atual de cada ordem em "
         "passagensTurno, todos os setores."],
        ["Eventos de passagem de turno", "bd/dados.json (eventosPassagem)", "Histórico "
         "permanente de cada ato de passar turno, com snapshot do tempo parado no momento."],
    ],
    col_widths=[4.8 * cm, 4.5 * cm, 7.7 * cm],
))

# ---------------------------------------------------------------------------
# 15. Riscos
# ---------------------------------------------------------------------------
story.append(section("15", "Riscos, limitações e pontos de atenção"))
story.append(make_table(
    ["Risco / limitação", "Impacto", "Mitigação atual / sugerida"],
    [
        ["Ausência de servidor/backup central — tudo depende da pasta de rede.", "Alto",
         "Garantir backup regular da pasta de rede pela TI local; não depender só do "
         "navegador."],
        ["Dois usuários salvando ao mesmo tempo podem gerar conflito.", "Médio",
         "Detecção de conflito já existe; resolução ainda é manual (recarregar e refazer)."],
        ["Coluna de data de referência ausente ou com nome diferente na planilha do SAP zera "
         "o indicador D.", "Alto",
         "Diagnóstico de cabeçalhos lidos já disponível na tela de importação; reimportar "
         "corrige sem duplicar."],
        ["Falta de criptografia e trilha de auditoria de leitura.", "Médio",
         "Aceito como limitação do modelo 100% local; não guardar dados sensíveis no sistema."],
        ["Navegador sem suporte a gravação direta obriga download manual e cópia para a "
          "pasta bd/.", "Médio",
         "Padronizar Chrome/Edge atualizado em todos os postos de trabalho."],
        ["Relógio do computador incorreto quebra as janelas obrigatórias de turno e SFM.", "Médio",
         "Sincronização automática de hora pela TI local (NTP)."],
        ["Campo responsavelSfm legado pode confundir quem administra usuários.", "Baixo",
         "Documentado nesta seção 4; candidato a remoção em versão futura."],
    ],
    col_widths=[6.3 * cm, 2.2 * cm, 8.5 * cm],
))

story.append(PageBreak())

# ---------------------------------------------------------------------------
# 16. Critérios de aceite
# ---------------------------------------------------------------------------
story.append(section("16", "Critérios de aceite"))
story.append(make_table(
    ["Fluxo validado", "Critério de aceite"],
    [
        ["Acesso e perfil", "Usuário só acessa telas e setores permitidos pelo próprio papel; "
         "operador não enxerga outro setor."],
        ["Passagem de turno", "Máquina passada aparece para o próximo turno; ao ser recebida, "
         "muda de status; ao ser finalizada, calcula corretamente o tempo parado desde "
         "inicioParadaEm."],
        ["Janelas obrigatórias", "Operador com pendência dentro da janela de 40 min é "
         "redirecionado e não consegue navegar para outra tela até concluir a ação."],
        ["Importação de planilha", "Planilha com colunas reconhecidas gera/atualiza notas sem "
         "duplicar; planilha sem data de referência reconhecida gera aviso e diagnóstico."],
        ["Quadro SQDC", "D e C do dia selecionado batem com o cálculo manual feito a partir da "
         "mesma planilha do SAP; S/Q só editáveis pelos usuários e dias corretos."],
        ["Relatórios", "Gestor/admin visualizam ordens, passagens e eventos de todos os "
         "setores; operador não tem acesso à tela."],
        ["Concorrência", "Ao salvar com o arquivo alterado por outra pessoa, o sistema avisa "
         "antes de sobrescrever."],
    ],
    col_widths=[3.8 * cm, 13.2 * cm],
))

# ---------------------------------------------------------------------------
# 17. Roadmap
# ---------------------------------------------------------------------------
story.append(section("17", "Roadmap e próximos passos"))
story.append(make_table(
    ["Fase", "Objetivo", "Itens sugeridos"],
    [
        ["Consolidação (atual)", "Estabilizar o que já está em produção.",
         "Documentar (este documento), treinar novos usuários, trocar senhas de teste."],
        ["Qualidade de dados", "Reduzir dependência de nomes exatos de coluna do SAP.",
         "Ampliar diagnóstico de importação; validar planilha antes de salvar."],
        ["Fonte automática de S/Q", "Eliminar lançamento manual de Segurança/Qualidade.",
         "Avaliar integração com planilha do SESMT/qualidade, se existir, ou cálculo de "
         "retrabalho por notas repetidas no mesmo equipamento."],
        ["Robustez operacional", "Reduzir risco de conflito e perda de dados.",
         "Explorar bloqueio otimista mais amigável; rotina de backup automática da pasta bd/."],
        ["Limpeza técnica", "Reduzir dívida técnica de campos legados.",
         "Remover ou re-explicar o campo responsavelSfm; revisar campo eficiencia legado em "
         "dados.json."],
    ],
    col_widths=[3.5 * cm, 5.0 * cm, 8.5 * cm],
))
story.append(Spacer(1, 0.4 * cm))
story.append(P(
    "<b>Próximos passos imediatos:</b> validar esta documentação com quem conduz a reunião de "
    "SFM (gestor) e com os operadores-chave de cada setor; revisar a lista de usuários e "
    "senhas de teste antes de qualquer expansão para novas linhas/plantas."
))

# ---------------------------------------------------------------------------
doc = SimpleDocTemplate(
    "requisitos_sfm.pdf", pagesize=A4,
    leftMargin=MARGIN, rightMargin=MARGIN, topMargin=1.6 * cm, bottomMargin=2.0 * cm,
    title="SFM — Documento Consolidado de Requisitos",
    author="Equipe do projeto SFM",
)
doc.build(story, canvasmaker=FooterCanvas)
print("OK: requisitos_sfm.pdf gerado")
