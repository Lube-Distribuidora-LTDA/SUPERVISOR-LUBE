# Supervisor Lube

App da Lube Distribuidora para **supervisor, RCA e gerente**: venda do dia (pedido digitado e faturado), carteira do
mês, ficha do cliente, curva ABC, inadimplência e devolução — no celular (Android e iPhone) e no navegador.

Nasceu do protótipo `Supervisor Lube.html` (2026-10-22), com o mesmo visual, e passou a ler o dado real do WinThor.

## Quem vê o quê

| Perfil | Vê | Como entra |
|---|---|---|
| Gerente | todos os setores e a comparação entre setores | conta do Painel Lube com o sistema **SUPERVISOR LUBE** liberado (ou administrador) |
| Supervisor | só o setor dele (`CODSUPERVISOR`) | "Primeiro acesso" no app; o TI liga a conta ao setor e libera |
| RCA | só a rota dele (`CODUSUR`) | "Primeiro acesso" com o código de RCA; o TI confere e libera |

O login é a base do Painel Lube (Supabase Auth do projeto PAINEL LUBE DISTRIBUIDORA), no mesmo desenho do SAC: conta
do app nasce **pendente** e nunca vira usuário do portal. O TI libera na aba **Acessos** do próprio app (menu da conta,
só para administrador), que mostra se o e-mail do RCA confere com o WinThor. A API confere o token em cada chamada e
**filtra no servidor**: o RCA nunca recebe linha de outro RCA, e o supervisor não abre outro setor.

## Caminho do dado

WinThor (Oracle) → ETL em Python na VM `SRV-IA` → Supabase, projeto DATA WAREHOUSE, schema `supervisor` → API na Vercel →
app.

- **Já existia (BI COMERCIAL, só leitura):** `comercial.fato_comissao_nf` (venda faturada por nota, filiais 1, 7, 10, 11,
  12), `comercial.fato_devolucao` + `dim_motivo_devolucao`, `core.dim_rca`, `core.dim_supervisor`, `core.dim_produto`,
  `core.dim_fornecedor`.
- **Carga nova (`etl/sync_supervisor.py`):**
  - `supervisor.cliente` — PCCLIENT: carteira (`CODUSUR1`), endereço, telefone, ramo, prazo, limite, bloqueio;
  - `supervisor.titulo` — PCPREST em aberto das filiais de venda;
  - `supervisor.pedido` — PCPEDC, o pedido digitado (sem cancelado e sem bonificação);
  - `supervisor.venda_item_mes` — PCMOV por mês × cliente × produto × RCA (mesma conta da comissão: `QT × (PUNIT − ST)`).
- **Conferências a cada carga completa** (em `supervisor.controle_carga`): títulos iguais ao PCPREST, cobrança a cobrança,
  na mesma foto do Oracle; venda por item do mês fechado igual à do BI COMERCIAL, setor a setor (bateu ao centavo em
  09/2026: R$ 14.126.098,07).
- **Pacote pronto:** `supervisor.pacote_setor(cod)` e `supervisor.pacote_resumo()` montam o JSON de cada setor e o
  resumo do gerente; a carga guarda comprimido em `supervisor.pacote`. O app guarda a última cópia no aparelho e abre
  na hora; por trás confere a versão (ETag).

### Regras escolhidas (a confirmar com o uso)

- **Setor** = supervisor atual do RCA (`PCUSUARI.CODSUPERVISOR`), a mesma regra do BI COMERCIAL.
- **Carteira ativa** = clientes do RCA (`CODUSUR1`) com compra nos últimos 180 dias (ou cadastrados há menos de 90).
- **Inadimplência** = títulos de cobrança vencidos. Jurídico e perdas (`ELUS`, `ELPR`, `PER1`, `PERD`) aparecem numa linha
  à parte, fora da soma; bonificação, devolução e crédito (`BNF`, `DEVT`, `DEVF`, `CRED`, `0000`, `TRMS`) não são
  cobrança. **Lista a confirmar com o financeiro.**
- **Bloqueado** = o bloqueio do próprio WinThor (`PCCLIENT.BLOQUEIO`).
- **Devolução** sem ST, para comparar com a venda (também sem ST).
- **Janela:** mês corrente e os 3 anteriores.

## Agendamento (VM SRV-IA)

Kit em `P:\INTEGRAÇÃO BI\SUPERVISOR` (`INSTALAR TUDO.bat`, `ATUALIZAR AGORA.bat`, `LEIA-ME.txt`):

- `Supervisor - Pedidos`: de 30 em 30 minutos, das 07:00 às 22:00 (pedido digitado + pacotes, ~20 s);
- `Supervisor - Completo`: 06:20, 11:20, 15:20 e 18:20 (tudo + conferências + pacotes, ~1 min).

## Pastas

```
etl/        a carga (Python), o instalador e o ATUALIZAR AGORA
web/        o app (HTML/CSS/JS sem build) + API (Vercel, Node 22, pg) + db/ (SQL versionado)
app/        a casca nativa (Capacitor 8): android/ e ios/, abrindo o app publicado
```

`web/db/03-acesso-painel.sql` roda no projeto **PAINEL LUBE DISTRIBUIDORA**, não no DATA WAREHOUSE.

## Rodar na máquina

```
cd web
npm install
node servidor_local.js            (http://localhost:3104, com login de verdade)
node servidor_local.js --previa   (testa as telas sem senha: /?previa=gerente, supervisor-4, rca-1097)
```

O modo prévia só existe no servidor local: na Vercel a variável `SUP_MODO_PREVIA` não existe.

## Publicação

- Vercel: Root Directory `web`, Framework "Other", região `gru1`, Node 22. Variáveis (cadastradas pelo Júlio, nunca no
  repositório): `SUPABASE_DB_HOST`, `SUPABASE_DB_PORT` (5432), `SUPABASE_DB_NAME`, `SUPABASE_DB_USER`
  (`postgres.ivcnotrynogaljrvvyes`), `SUPABASE_DB_PASSWORD`.
- Guarda da Sentinela no `middleware.ts`, **aberto de propósito como o SAC** (`exige_login = false`): RCA e supervisor
  não têm conta no portal; o dado só sai com o token conferido.

## Celular

- **iPhone (sem custo):** abrir o endereço no Safari → Compartilhar → **Adicionar à Tela de Início**. Fica com o ícone da
  Lube, em tela cheia, e abre sem internet com a última cópia.
- **Android:** o APK da casca (`app/`) abre o app publicado. Também dá para instalar pelo Chrome (menu → Instalar app).
- **Lojas (depois, se o Júlio quiser):** Google Play (US$ 25 uma vez) e Apple Developer (US$ 99 por ano). O projeto
  `app/ios` já está pronto para compilar num Mac ou na nuvem.
