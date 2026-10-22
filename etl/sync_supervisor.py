#!/usr/bin/env python3
"""
sync_supervisor.py — orquestrador do SUPERVISOR LUBE (app do supervisor, do RCA e do gerente).

Leva para o Supabase (projeto DATA WAREHOUSE, schema `supervisor`) o que o BI
COMERCIAL ainda nao carrega — cadastro do cliente, titulos em aberto, pedido
digitado e venda por item —, confere e monta o pacote de cada setor que o app
baixa.

Dois ritmos (duas tarefas agendadas):
  --grupo pedidos    so o pedido digitado + pacotes   (de 30 em 30 min)
  --grupo completo   tudo + conferencias + pacotes    (4 vezes ao dia)

Passos:
  1. cada consulta, isolada: se uma falhar, as outras seguem;
  2. conferencias:
       titulo      banco x PCPREST na mesma foto do WinThor (quantos e quanto, por cobranca);
       venda_item  soma do mes fechado anterior, setor a setor, x comercial.fato_comissao_nf
                   (a mesma conta: tem que bater no centavo);
  3. pacotes: supervisor.pacote_setor(cod) de cada setor com RCA ativo e o resumo do
     gerente (pacote_resumo), comprimidos em gzip em supervisor.pacote. A API so le essas
     linhas; o RCA recebe o do setor dele filtrado.

O resultado de cada passo fica em supervisor.controle_carga: e essa tabela, nao o log na
tela, que responde "a carga entrou?".

Como usar
---------
    python sync_supervisor.py                      # completo
    python sync_supervisor.py --grupo pedidos      # so pedido + pacotes
    python sync_supervisor.py --consulta titulo    # so uma consulta (os pacotes sao refeitos)
    python sync_supervisor.py --so-pacote          # so refaz os pacotes
    python sync_supervisor.py --listar             # mostra o catalogo e sai
"""

from __future__ import annotations

import argparse
import gzip
import hashlib
import sys
from datetime import datetime

import bi_comum as bi

log = bi.configurar_log("sync_supervisor.log")

# Sem isto o bi_comum gravaria o controle_carga no schema do BI COMPRAS.
bi.definir_schema("supervisor")


def _argumentos() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Sincroniza SUPERVISOR LUBE (Oracle/WinThor -> Supabase).")
    p.add_argument("--grupo", choices=("pedidos", "completo"), default="completo")
    p.add_argument("--consulta", nargs="+", metavar="NOME", help="Roda apenas as consultas indicadas.")
    p.add_argument("--so-pacote", action="store_true", help="Nao le o WinThor: so refaz os pacotes.")
    p.add_argument("--listar", action="store_true", help="Mostra o catalogo de consultas e sai.")
    return p.parse_args()


def _f(n: int | float | None) -> str:
    return "-" if n is None else f"{n:,.0f}".replace(",", ".")


def _r(v: float) -> str:
    return "R$ " + f"{v:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")


class _Passo:
    """Um passo que nao e consulta, mas tambem vai para o controle_carga."""

    def __init__(self, nome: str, destino: str):
        self.nome, self.destino, self.linhas_esperadas = nome, destino, None


# ---------------------------------------------------------------------------
# Conferencias
# ---------------------------------------------------------------------------
def conferir_titulo(conn_ora, conn_pg) -> tuple[str, str]:
    from consultas_supervisor import sql_conferencia_titulo
    with conn_ora.cursor() as cur:
        cur.execute(sql_conferencia_titulo())
        ora = {(r[0] or "").strip(): (int(r[1]), round(float(r[2]), 2)) for r in cur.fetchall()}
    with conn_pg.cursor() as cur:
        cur.execute("SELECT coalesce(codcob, ''), count(*), coalesce(sum(valor), 0) FROM supervisor.titulo GROUP BY 1")
        pg = {(r[0] or "").strip(): (int(r[1]), round(float(r[2]), 2)) for r in cur.fetchall()}
    conn_pg.rollback()
    dif = []
    for cob in sorted(set(ora) | set(pg)):
        o, p = ora.get(cob, (0, 0.0)), pg.get(cob, (0, 0.0))
        if o[0] != p[0] or abs(o[1] - p[1]) > 0.005:
            dif.append(f"{cob or '(sem)'}: banco {p[0]} / {_r(p[1])} x WinThor {o[0]} / {_r(o[1])}")
    n, v = sum(x[0] for x in ora.values()), sum(x[1] for x in ora.values())
    resumo = f"{_f(n)} titulos em aberto, {_r(v)}, {len(ora)} cobrancas"
    if not dif:
        return "OK", "Banco igual ao WinThor: " + resumo
    return "AVISO", f"{len(dif)} cobranca(s) diferente(s) ({resumo}): " + "; ".join(dif[:8])


def conferir_venda_item(conn_pg) -> tuple[str, str]:
    """Mes fechado anterior, setor a setor: venda_item_mes x comercial.fato_comissao_nf."""
    from consultas_supervisor import mes_fechado_anterior
    mes = mes_fechado_anterior()
    with conn_pg.cursor() as cur:
        cur.execute(
            """WITH a AS (SELECT codsupervisor, sum(venda) v FROM supervisor.venda_item_mes WHERE mes = %s GROUP BY 1),
                    b AS (SELECT codsupervisor, sum(venda) v FROM comercial.fato_comissao_nf
                           WHERE dtmov >= %s AND dtmov < (%s::date + interval '1 month') GROUP BY 1)
               SELECT coalesce(a.codsupervisor, b.codsupervisor), coalesce(a.v, 0), coalesce(b.v, 0)
                 FROM a FULL JOIN b ON a.codsupervisor = b.codsupervisor""", (mes, mes, mes))
        linhas = cur.fetchall()
    conn_pg.rollback()
    dif = [f"setor {s}: item {_r(float(a))} x comissao {_r(float(b))}" for s, a, b in linhas if abs(float(a) - float(b)) > 0.05]
    tot_a, tot_b = sum(float(x[1]) for x in linhas), sum(float(x[2]) for x in linhas)
    resumo = f"{mes:%m/%Y}: item {_r(tot_a)} x BI COMERCIAL {_r(tot_b)}"
    if not dif:
        return "OK", "Venda por item igual a do BI COMERCIAL em todos os setores, " + resumo
    return "AVISO", f"{len(dif)} setor(es) diferente(s) ({resumo}); a comissao pode ter sido carregada em outro horario: " + "; ".join(dif[:8])


# ---------------------------------------------------------------------------
# Pacotes
# ---------------------------------------------------------------------------
def _guardar(cur, escopo: str, texto_json: str) -> tuple[int, int]:
    bruto = texto_json.encode("utf-8")
    comprimido = gzip.compress(bruto, compresslevel=7)
    versao = datetime.now().strftime("%Y%m%d-%H%M%S")
    cur.execute(
        """INSERT INTO supervisor.pacote (escopo, versao, gerado_em, hash, bytes_json, bytes_gz, payload_gz)
           VALUES (%s, %s, now(), %s, %s, %s, %s)
           ON CONFLICT (escopo) DO UPDATE SET versao = EXCLUDED.versao, gerado_em = EXCLUDED.gerado_em,
                  hash = EXCLUDED.hash, bytes_json = EXCLUDED.bytes_json, bytes_gz = EXCLUDED.bytes_gz,
                  payload_gz = EXCLUDED.payload_gz""",
        (escopo, versao, hashlib.sha1(bruto).hexdigest(), len(bruto), len(comprimido), bi.psycopg2.Binary(comprimido)))
    return len(bruto), len(comprimido)


def montar_pacotes(conn_pg) -> tuple[int, int, int]:
    """Um pacote por setor ativo + o resumo do gerente. Cada um numa transacao propria:
    um setor que falhe nao apaga os outros (e o app segue com o pacote anterior dele)."""
    with conn_pg.cursor() as cur:
        cur.execute("SELECT supervisor.setores_ativos()")
        setores = [r[0] for r in cur.fetchall()]
    conn_pg.rollback()
    n, total_json, total_gz, falhas = 0, 0, 0, []
    for cod in setores + ["G"]:
        try:
            with conn_pg.cursor() as cur:
                cur.execute("SET LOCAL statement_timeout = 300000")
                if cod == "G":
                    cur.execute("SELECT supervisor.pacote_resumo()::text")
                    escopo = "G"
                else:
                    cur.execute("SELECT supervisor.pacote_setor(%s)::text", (cod,))
                    escopo = f"S{cod}"
                bj, bg = _guardar(cur, escopo, cur.fetchone()[0])
            conn_pg.commit()
            n, total_json, total_gz = n + 1, total_json + bj, total_gz + bg
        except Exception as exc:  # noqa: BLE001
            conn_pg.rollback()
            falhas.append(f"{cod}: {type(exc).__name__}: {exc}")
            log.exception("  FALHOU o pacote do setor %s", cod)
    # setores que deixaram de existir saem (o app deixa de oferecer)
    try:
        with conn_pg.cursor() as cur:
            cur.execute("""DELETE FROM supervisor.pacote
                            WHERE escopo ~ '^S[0-9]+$'
                              AND NOT (CASE WHEN escopo ~ '^S[0-9]+$' THEN substr(escopo, 2)::int END = ANY(%s))""",
                        (setores,))
        conn_pg.commit()
    except Exception:  # noqa: BLE001
        conn_pg.rollback()
    if falhas:
        raise RuntimeError(f"{len(falhas)} pacote(s) falharam: " + "; ".join(falhas[:5]))
    return n, total_json, total_gz


def _dizer_como_esta(conn_pg) -> None:
    try:
        with conn_pg.cursor() as cur:
            cur.execute("""SELECT (SELECT count(*) FROM supervisor.cliente), (SELECT count(*) FROM supervisor.titulo),
                                  (SELECT coalesce(sum(valor), 0) FROM supervisor.titulo
                                    WHERE grupo = 'cobranca' AND dtvenc < (now() at time zone 'America/Sao_Paulo')::date),
                                  (SELECT count(*) FROM supervisor.pedido
                                    WHERE data = (now() at time zone 'America/Sao_Paulo')::date),
                                  (SELECT coalesce(sum(vltotal), 0) FROM supervisor.pedido
                                    WHERE data = (now() at time zone 'America/Sao_Paulo')::date)""")
            cli, tit, venc, nped, vped = cur.fetchone()
        conn_pg.rollback()
        log.info("APP ATUALIZADO: %s clientes, %s titulos em aberto (%s vencidos em cobranca), "
                 "hoje %s pedidos digitados somando %s.", _f(cli), _f(tit), _r(float(venc)), _f(nped), _r(float(vped)))
    except Exception as exc:  # noqa: BLE001
        conn_pg.rollback()
        log.warning("  nao consegui ler o resumo: %s", exc)


def _registrar_passo(conn_pg, resultados, nome, destino, func) -> None:
    relogio = bi.cronometro()
    passo = _Passo(nome, destino)
    try:
        status, msg = func()
        (log.info if status == "OK" else log.warning)("  %s: %s — %s", nome, status, msg)
    except Exception as exc:  # noqa: BLE001
        conn_pg.rollback()
        status, msg = "AVISO", f"Nao consegui conferir: {type(exc).__name__}: {exc}"
        log.warning("  %s", msg)
    bi.registrar_execucao(conn_pg, passo, status, None, relogio(), msg)
    resultados.append((nome, status, None, relogio()))


def main() -> int:
    args = _argumentos()
    bi.carregar_env()

    from consultas_supervisor import catalogo, selecionar  # le o ENV: so depois dele

    if args.listar:
        print()
        print(f"{'CONSULTA':12s} {'GRUPO':9s} {'DESTINO':28s} DESCRICAO")
        print("-" * 100)
        for c in catalogo():
            print(f"{c.nome:12s} {c.grupo:9s} {c.destino:28s} {c.descricao}")
        print()
        return 0

    try:
        cfg_ora = bi.OracleConfig.from_env()
        cfg_pg = bi.SupabaseConfig.from_env()
    except SystemExit as exc:
        log.error("Configuracao invalida: %s", exc)
        return 1

    consultas = [] if args.so_pacote else selecionar(args.consulta, args.grupo)
    log.info("Grupo %s — vou rodar %d consulta(s): %s", args.grupo, len(consultas),
             ", ".join(c.nome for c in consultas) or "(so pacotes)")
    resultados: list[tuple[str, str, int | None, float]] = []

    try:
        with bi.conectar_supabase(cfg_pg) as conn_pg, bi.tranca_de_carga(conn_pg, "carga"):
            if consultas:
                with bi.conectar_oracle(cfg_ora) as conn_ora:
                    # uma foto so do WinThor para extracao e conferencia
                    foto_unica = False
                    try:
                        with conn_ora.cursor() as cur:
                            cur.execute("SET TRANSACTION READ ONLY")
                        foto_unica = True
                    except Exception as exc:  # noqa: BLE001
                        log.warning("  nao consegui abrir a transacao so de leitura no Oracle (%s); sigo sem ela.", exc)

                    for consulta in consultas:
                        relogio = bi.cronometro()
                        log.info("=" * 70)
                        log.info("[%s] %s", consulta.nome, consulta.descricao)
                        try:
                            if consulta.streaming:
                                linhas = bi.carregar_em_lotes(conn_ora, conn_pg, consulta, tamanho=50000)
                            else:
                                brutas = bi.extrair(conn_ora, consulta)
                                log.info("  Oracle devolveu %s linhas.", _f(len(brutas)))
                                linhas = bi.carregar(conn_pg, consulta, brutas)
                            conn_pg.commit()
                            segundos = relogio()
                            log.info("  OK — %s linhas em %.1fs -> %s", _f(linhas), segundos, consulta.destino)
                            resultados.append((consulta.nome, "OK", linhas, segundos))
                            bi.registrar_execucao(conn_pg, consulta, "OK", linhas, segundos, None)
                        except Exception as exc:  # noqa: BLE001 — uma falha nao pode derrubar as outras
                            conn_pg.rollback()
                            segundos = relogio()
                            log.exception("  FALHOU: %s", consulta.nome)
                            resultados.append((consulta.nome, "ERRO", None, segundos))
                            bi.registrar_execucao(conn_pg, consulta, "ERRO", None, segundos, f"{type(exc).__name__}: {exc}")

                    ok = {r[0] for r in resultados if r[1] == "OK"}
                    if "titulo" in ok:
                        _registrar_passo(conn_pg, resultados, "conferencia_titulo", "supervisor.titulo x PCPREST",
                                         lambda: conferir_titulo(conn_ora, conn_pg))
                    if foto_unica:
                        try:
                            conn_ora.rollback()     # encerra a transacao so de leitura
                        except Exception:  # noqa: BLE001
                            pass
                    if "venda_item" in ok:
                        _registrar_passo(conn_pg, resultados, "conferencia_venda", "venda_item_mes x fato_comissao_nf",
                                         lambda: conferir_venda_item(conn_pg))

            # --- pacotes -------------------------------------------------------------
            relogio = bi.cronometro()
            passo = _Passo("pacote", "supervisor.pacote")
            try:
                n, bj, bg = montar_pacotes(conn_pg)
                segundos = relogio()
                msg = f"{n} pacotes (setores + resumo): JSON de {bj / 1048576:.1f} MB, {bg / 1048576:.1f} MB comprimido"
                log.info("  pacotes prontos em %.1fs — %s", segundos, msg)
                bi.registrar_execucao(conn_pg, passo, "OK", n, segundos, msg)
                resultados.append((passo.nome, "OK", n, segundos))
            except Exception as exc:  # noqa: BLE001
                conn_pg.rollback()
                segundos = relogio()
                log.exception("  FALHOU a montagem dos pacotes (o app segue com os anteriores)")
                bi.registrar_execucao(conn_pg, passo, "ERRO", None, segundos, f"{type(exc).__name__}: {exc}")
                resultados.append((passo.nome, "ERRO", None, segundos))

            _dizer_como_esta(conn_pg)
            log.info("=" * 70)
            log.info("RESUMO DA CARGA")
            log.info("%-20s %-6s %12s %9s", "PASSO", "STATUS", "LINHAS", "TEMPO")
            for nome, status, linhas, segundos in resultados:
                log.info("%-20s %-6s %12s %8.1fs", nome, status, _f(linhas), segundos)
            log.info("=" * 70)

    except bi.CargaJaRodando as aviso:
        # Nao e erro: e a tranca fazendo o trabalho dela.
        log.warning("%s", aviso)
        return 0
    except Exception:
        log.exception("Nao consegui nem abrir as conexoes — nada foi carregado.")
        return 1

    falhas = [r for r in resultados if r[1] == "ERRO"]
    if falhas:
        log.error("%d passo(s) falharam: %s", len(falhas), ", ".join(r[0] for r in falhas))
        return 1
    log.info("Carga concluida.")
    return 0


if __name__ == "__main__":
    try:
        codigo = main()
    except Exception:
        log.exception("Erro inesperado — veja o traceback acima / no sync_supervisor.log.")
        codigo = 1
    sys.exit(codigo)
