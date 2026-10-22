#!/usr/bin/env python3
"""
consultas_supervisor.py — o catalogo das consultas do SUPERVISOR LUBE.

O app do supervisor (e do RCA e do gerente) le do DATA WAREHOUSE o que o BI
COMERCIAL ja carrega (venda faturada por nota, devolucoes, RCAs, supervisores)
e, daqui, so o que ainda faltava:

    Consulta      Origem no WinThor             Destino
    ------------  ----------------------------  ----------------------------
    cliente       PCCLIENT (+PCATIVI, PCPLPAG)   supervisor.cliente
    titulo        PCPREST em aberto (+PCCOB)     supervisor.titulo
    pedido        PCPEDC (pedido digitado)       supervisor.pedido
    venda_item    PCMOV operacao S, por mes      supervisor.venda_item_mes

Regras (todas repetidas no README):
1. Setor = supervisor ATUAL do RCA (PCUSUARI.CODSUPERVISOR), a mesma regra da
   comercial.fato_comissao_nf, que e recarregada inteira a cada carga. Assim um
   RCA que mudou de setor leva junto a venda, o pedido e o titulo dele.
2. Filiais de venda: 1, 7, 10, 11 e 12 (as mesmas da comissao). Os titulos das
   filiais 3 (SERMAR), 4 (L LOG) e 6 (IMPERIO LOG) nao sao de cliente da venda.
3. venda_item usa a MESMA conta da fato_comissao_nf: QT x (PUNIT - ST), sem
   CFOP 1949, sem cancelado, com os mesmos joins (que filtram). A conferencia do
   sync_supervisor prova que a soma do mes fechado bate com ela.
4. Pedido digitado: PCPEDC sem DTCANCEL e sem bonificacao (CONDVENDA 5).
5. Titulo: PCPREST sem DTPAG e sem DTCANCEL. O grupo separa o que e cobranca
   de cliente do que esta no juridico/perdas e do que nao e cobranca (bonificacao,
   devolucao, credito). A lista e escolha do Claude, a confirmar com o financeiro.
"""

from __future__ import annotations

import os
from datetime import date, datetime, timezone

from bi_comum import Consulta, inteiro, num, texto

AGORA = lambda: datetime.now(timezone.utc)  # noqa: E731


def _lista_env(chave: str, padrao: str) -> tuple[int, ...]:
    return tuple(int(f) for f in os.environ.get(chave, padrao).replace(";", ",").split(",") if f.strip())


FILIAIS = _lista_env("SUPERVISOR_FILIAIS", "1,7,10,11,12")
CFOP_EXCLUIDOS = (1949,)
# Meses de historia alem do mes corrente (o app compara mes atual, mes anterior e 3 meses).
MESES_ANTES = int(os.environ.get("SUPERVISOR_MESES_ANTES", "3"))

COB_JURIDICO = ("ELUS", "ELPR", "PER1", "PERD")
COB_FORA = ("BNF", "DEVT", "DEVF", "CRED", "0000", "TRMS")


def _num_lista(valores) -> str:
    return ", ".join(str(v) for v in valores)


def _txt_lista(valores) -> str:
    return ", ".join("'" + str(v) + "'" for v in valores)


def _data(v):
    return v.date() if isinstance(v, datetime) else v


def grupo_cobranca(codcob: str | None) -> str:
    c = (codcob or "").strip().upper()
    if c in COB_JURIDICO:
        return "juridico"
    if c in COB_FORA:
        return "fora"
    return "cobranca"


# ===========================================================================
# cliente -> supervisor.cliente
# ===========================================================================
SQL_CLIENTE = f"""
SELECT c.codcli, c.fantasia, c.cliente AS razao, c.cgcent AS cnpj, c.tipofj, c.codatv1 AS codativ, a.ramo,
       NVL(ci.nomecidade, TRIM(c.municent)) AS cidade, NVL(ci.uf, TRIM(c.estent)) AS uf, c.bairroent AS bairro,
       TRIM(c.enderent) || CASE WHEN TRIM(c.numeroent) IS NOT NULL THEN ', ' || TRIM(c.numeroent) END AS endereco,
       c.telent AS telefone, c.telcelent AS celular, c.codusur1, u.codsupervisor,
       c.codplpag, p.descricao AS plano, p.numdias AS prazo_dias, c.limcred AS limite,
       c.bloqueio, c.dtbloq, c.dtcadastro, c.dtprimcompra, c.dtultcomp
  FROM pcclient c, pcativi a, pccidade ci, pcusuari u, pcplpag p
 WHERE c.codatv1 = a.codativ (+)
   AND c.codcidade = ci.codcidade (+)
   AND c.codusur1 = u.codusur (+)
   AND c.codplpag = p.codplpag (+)
   AND (   (c.dtexclusao IS NULL AND (c.dtultcomp >= TRUNC(SYSDATE) - 400 OR c.dtcadastro >= TRUNC(SYSDATE) - 400))
        OR c.codcli IN (SELECT t.codcli FROM pcprest t
                         WHERE t.dtpag IS NULL AND t.dtcancel IS NULL
                           AND t.codfilial IN ({_txt_lista(FILIAIS)})))
"""


def _mapear_cliente(r: dict) -> tuple:
    return (
        inteiro(r["codcli"]), texto(r["fantasia"]), texto(r["razao"]), texto(r["cnpj"]), texto(r["tipofj"]),
        inteiro(r["codativ"]), texto(r["ramo"]), texto(r["cidade"]), texto(r["uf"]), texto(r["bairro"]),
        texto(r["endereco"]), texto(r["telefone"]), texto(r["celular"]),
        inteiro(r["codusur1"]), inteiro(r["codsupervisor"]), inteiro(r["codplpag"]), texto(r["plano"]),
        inteiro(r["prazo_dias"]), r["limite"], (r["bloqueio"] or "").strip().upper() == "S",
        _data(r["dtbloq"]), _data(r["dtcadastro"]), _data(r["dtprimcompra"]), _data(r["dtultcomp"]),
        AGORA(),
    )


# ===========================================================================
# titulo -> supervisor.titulo
# ===========================================================================
SQL_TITULO = f"""
SELECT TO_NUMBER(p.codfilial) AS codfilial, p.duplic, p.prest, p.numtransvenda, p.codcli, p.codusur,
       u.codsupervisor, p.codsupervisor AS codsupervisor_titulo, p.codcob, b.cobranca,
       p.dtemissao, p.dtvenc, p.valor
  FROM pcprest p, pcusuari u, pccob b
 WHERE p.codusur = u.codusur (+)
   AND p.codcob = b.codcob (+)
   AND p.dtpag IS NULL
   AND p.dtcancel IS NULL
   AND p.codfilial IN ({_txt_lista(FILIAIS)})
"""


def _mapear_titulo(r: dict) -> tuple:
    return (
        inteiro(r["codfilial"]), inteiro(r["duplic"]), texto(r["prest"]), inteiro(r["numtransvenda"]),
        inteiro(r["codcli"]), inteiro(r["codusur"]), inteiro(r["codsupervisor"]), inteiro(r["codsupervisor_titulo"]),
        texto(r["codcob"]), texto(r["cobranca"]), grupo_cobranca(r["codcob"]),
        _data(r["dtemissao"]), _data(r["dtvenc"]), num(r["valor"], 0), AGORA(),
    )


# Conferencia do titulo, na mesma foto do WinThor: quantos e quanto, por grupo.
def sql_conferencia_titulo() -> str:
    return f"""
SELECT p.codcob, COUNT(*), NVL(SUM(p.valor), 0)
  FROM pcprest p
 WHERE p.dtpag IS NULL AND p.dtcancel IS NULL AND p.codfilial IN ({_txt_lista(FILIAIS)})
 GROUP BY p.codcob
"""


# ===========================================================================
# pedido -> supervisor.pedido
# ===========================================================================
SQL_PEDIDO = f"""
SELECT p.numped, TRUNC(p.data) AS data, p.hora, p.minuto, p.codcli, p.codusur, u.codsupervisor,
       TO_NUMBER(p.codfilial) AS codfilial, p.condvenda, p.posicao, p.origemped, p.vltotal, p.numitens,
       TRUNC(p.dtfat) AS dtfat
  FROM pcpedc p, pcusuari u
 WHERE p.codusur = u.codusur (+)
   AND p.dtcancel IS NULL
   AND NVL(p.condvenda, 0) <> 5
   AND p.codfilial IN ({_txt_lista(FILIAIS)})
   AND p.data >= ADD_MONTHS(TRUNC(SYSDATE, 'MM'), -{MESES_ANTES})
"""


def _mapear_pedido(r: dict) -> tuple:
    return (
        inteiro(r["numped"]), _data(r["data"]), inteiro(r["hora"]), inteiro(r["minuto"]), inteiro(r["codcli"]),
        inteiro(r["codusur"]), inteiro(r["codsupervisor"]), inteiro(r["codfilial"]), inteiro(r["condvenda"]),
        texto(r["posicao"]), texto(r["origemped"]), num(r["vltotal"], 0), inteiro(r["numitens"]), _data(r["dtfat"]),
        AGORA(),
    )


# ===========================================================================
# venda_item -> supervisor.venda_item_mes
# ===========================================================================
SQL_VENDA_ITEM = f"""
SELECT TRUNC(a.dtmov, 'MM') AS mes, a.codcli, a.codprod, a.codusur, f.codsupervisor,
       NVL(SUM(a.qt), 0)                         AS qt,
       NVL(SUM(a.qt * (a.punit - a.st)), 0)      AS venda,
       NVL(SUM(a.qt * a.custofin), 0)            AS cmv,
       MAX(TRUNC(a.dtmov))                       AS ultima,
       COUNT(DISTINCT a.numped)                  AS pedidos
  FROM pcmov a, pcprodut b, pcfornec c, pcusuari e, pcsuperv f, pcclient g
 WHERE a.codprod = b.codprod
   AND b.codfornec = c.codfornec
   AND a.codusur = e.codusur
   AND e.codsupervisor = f.codsupervisor
   AND a.codcli = g.codcli
   AND a.codfiscal NOT IN ({_num_lista(CFOP_EXCLUIDOS)})
   AND a.codfilial IN ({_num_lista(FILIAIS)})
   AND a.dtcancel IS NULL
   AND a.codoper = 'S'
   AND a.dtmov >= ADD_MONTHS(TRUNC(SYSDATE, 'MM'), -{MESES_ANTES})
 GROUP BY TRUNC(a.dtmov, 'MM'), a.codcli, a.codprod, a.codusur, f.codsupervisor
"""


def _mapear_venda_item(r: dict) -> tuple:
    return (
        _data(r["mes"]), inteiro(r["codcli"]), inteiro(r["codprod"]), inteiro(r["codusur"]),
        inteiro(r["codsupervisor"]), num(r["qt"], 0), num(r["venda"], 0), num(r["cmv"], 0),
        _data(r["ultima"]), inteiro(r["pedidos"]), AGORA(),
    )


# ===========================================================================
# Catalogo
# ===========================================================================
def catalogo() -> list[Consulta]:
    return [
        Consulta(
            nome="cliente", descricao="Cadastro do cliente: carteira, endereco, prazo, limite e bloqueio",
            pagina="Carteira / Cliente", sql=SQL_CLIENTE, destino="supervisor.cliente",
            colunas=("codcli", "fantasia", "razao", "cnpj", "tipofj", "codativ", "ramo", "cidade", "uf", "bairro",
                     "endereco", "telefone", "celular", "codusur1", "codsupervisor", "codplpag", "plano",
                     "prazo_dias", "limite", "bloqueio", "dtbloq", "dtcadastro", "dtprimcompra", "dtultcomp",
                     "data_carga"),
            mapear=_mapear_cliente, grupo="completo",
        ),
        Consulta(
            nome="titulo", descricao="Titulos em aberto (PCPREST) das filiais de venda",
            pagina="Inadimplencia / Cliente", sql=SQL_TITULO, destino="supervisor.titulo",
            colunas=("codfilial", "duplic", "prest", "numtransvenda", "codcli", "codusur", "codsupervisor",
                     "codsupervisor_titulo", "codcob", "cobranca", "grupo", "dtemissao", "dtvenc", "valor",
                     "data_carga"),
            mapear=_mapear_titulo, grupo="completo",
        ),
        Consulta(
            nome="venda_item", descricao="Venda faturada por mes x cliente x produto x RCA (PCMOV S)",
            pagina="Curva ABC / Cliente", sql=SQL_VENDA_ITEM, destino="supervisor.venda_item_mes",
            colunas=("mes", "codcli", "codprod", "codusur", "codsupervisor", "qt", "venda", "cmv", "ultima",
                     "pedidos", "data_carga"),
            mapear=_mapear_venda_item, grupo="completo", streaming=True,
        ),
        Consulta(
            nome="pedido", descricao="Pedido digitado (PCPEDC), sem cancelado e sem bonificacao",
            pagina="Vendas", sql=SQL_PEDIDO, destino="supervisor.pedido",
            colunas=("numped", "data", "hora", "minuto", "codcli", "codusur", "codsupervisor", "codfilial",
                     "condvenda", "posicao", "origem", "vltotal", "numitens", "dtfat", "data_carga"),
            mapear=_mapear_pedido, grupo="pedidos",
        ),
    ]


def selecionar(nomes: list[str] | None, grupo: str | None) -> list[Consulta]:
    """Sem nomes: o grupo pedido ('pedidos' roda so o pedido; 'completo' roda tudo)."""
    todas = catalogo()
    if nomes:
        desconhecidas = set(nomes) - {c.nome for c in todas}
        if desconhecidas:
            raise SystemExit("Consulta desconhecida: " + ", ".join(sorted(desconhecidas)))
        return [c for c in todas if c.nome in nomes]
    if grupo == "pedidos":
        return [c for c in todas if c.grupo == "pedidos"]
    return todas


def mes_fechado_anterior() -> date:
    hoje = date.today()
    return date(hoje.year - (hoje.month == 1), 12 if hoje.month == 1 else hoje.month - 1, 1)
