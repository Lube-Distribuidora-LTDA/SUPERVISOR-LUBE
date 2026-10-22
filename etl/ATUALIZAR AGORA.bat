@echo off
rem ===========================================================================
rem  ATUALIZAR AGORA - Supervisor Lube
rem
rem  Faz duas coisas, nesta ordem, e mostra na tela o que aconteceu:
rem    1. traz o ETL mais novo da pasta de rede para C:\BI\SUPERVISOR;
rem    2. roda UMA carga completa agora (WinThor -> Supabase), confere os titulos
rem       contra o PCPREST e a venda contra o BI COMERCIAL e deixa os pacotes do app prontos.
rem
rem  Use na VM SRV-IA, de duplo clique. NAO cria nem muda tarefa agendada: isso e
rem  com o INSTALAR TUDO.bat (uma vez). Pode rodar a qualquer hora: se ja houver
rem  uma carga rodando (a agendada, por exemplo), a tranca do banco faz esta
rem  esperar de fora em vez de atropelar a outra.
rem
rem  Depois da carga, o app mostra o dado novo ao abrir (ou em Atualizar dados, no menu da conta).
rem ===========================================================================
setlocal EnableExtensions
title Supervisor Lube - atualizar agora
set "AQUI=%~dp0"
pushd "%AQUI%"

set "DEST=C:\BI\SUPERVISOR"
if defined SUPERVISOR_DESTINO set "DEST=%SUPERVISOR_DESTINO%"
set "ERRO="

echo.
echo   SUPERVISOR LUBE - atualizar agora
echo   ============================================
echo.

rem --- so na VM -------------------------------------------------------------
if /i "%COMPUTERNAME%"=="SRV-IA" goto maquina_certa
echo   ATENCAO: esta maquina e a %COMPUTERNAME%, nao a SRV-IA.
echo   A carga do BI roda SO na SRV-IA. Uma carga manual daqui e segura (a tranca
echo   do banco impede duas ao mesmo tempo), mas deixa uma copia do ETL em %DEST%.
echo.
set /p RESP="  Digite SIM para continuar assim mesmo: "
if /i not "%RESP%"=="SIM" goto sair
echo.
:maquina_certa

rem --- de onde vem o ETL: pasta de rede (subpastas) ou pasta plana ----------
set "SRC=%AQUI%"
if exist "%AQUI%2 - SISTEMA SUPERVISOR\sync_supervisor.py" set "SRC=%AQUI%2 - SISTEMA SUPERVISOR\"
set "ENVSRC=%AQUI%ENV"
if exist "%AQUI%1 - CONFIGURACAO\ENV" set "ENVSRC=%AQUI%1 - CONFIGURACAO\ENV"
if not exist "%SRC%sync_supervisor.py" goto sem_etl
if not exist "%ENVSRC%" goto sem_env

rem --- 1. copiar --------------------------------------------------------------
if not exist "%DEST%" mkdir "%DEST%"
if not exist "%DEST%" goto sem_destino
echo   [1/2] Copiando o ETL mais novo para %DEST%
for %%F in (bi_comum.py consultas_supervisor.py sync_supervisor.py executar.py _teste_agendador.py requirements.txt) do call :copiar "%SRC%%%F" "%DEST%\%%F"
call :copiar "%ENVSRC%" "%DEST%\ENV"
if defined ERRO goto falha_copia

rem --- python -----------------------------------------------------------------
where python >nul 2>nul
if errorlevel 1 goto sem_python
python -c "import oracledb, psycopg2, dotenv" >nul 2>nul
if errorlevel 1 goto sem_bibliotecas

rem --- 2. carga ---------------------------------------------------------------
echo.
echo   [2/2] Rodando a carga completa. Leva cerca de 1 minuto (mais, se o banco estiver ocupado).
echo   ------------------------------------------------------------------------
pushd "%DEST%"
python "%DEST%\executar.py" --grupo completo
set "COD=%ERRORLEVEL%"
popd
echo   ------------------------------------------------------------------------

echo.
echo   O que o log da carga diz (ultimas linhas importantes):
powershell -NoProfile -Command "Get-Content -Tail 80 -LiteralPath '%DEST%\sync_supervisor.log' | Select-String -Pattern 'APP ATUALIZADO|conferencia_titulo|conferencia_venda|pacotes prontos|Ja existe uma carga|FALHOU|\[ERROR\]' | Select-Object -Last 5 | ForEach-Object { '  ' + $_.Line }"
echo.
if not "%COD%"=="0" goto carga_falhou
echo   PRONTO. No app, abra o menu da conta e toque em Atualizar dados.
goto sair

:carga_falhou
echo   A CARGA TERMINOU COM ERRO (codigo %COD%). Leia as linhas acima.
echo   Se nada apareceu, veja o arquivo falha_inicial.log em %DEST%.
goto sair

:copiar
copy /y %1 %2 >nul 2>nul
if errorlevel 1 (
    echo         NAO consegui copiar %~nx1
    set "ERRO=1"
)
goto :eof

:sem_etl
echo   Nao achei o ETL ao lado deste arquivo. Rode o ATUALIZAR AGORA.bat de dentro da
echo   pasta P:\INTEGRACAO BI\SUPERVISOR.
goto sair
:sem_env
echo   Nao achei o arquivo ENV em "1 - CONFIGURACAO". Ele guarda as senhas e e obrigatorio.
goto sair
:sem_destino
echo   Nao consegui criar a pasta %DEST%. Abra este arquivo como administrador.
goto sair
:falha_copia
echo.
echo   Alguns arquivos nao foram copiados. O caso conhecido: arquivo preso por outro
echo   usuario ou programa aberto em %DEST%. Feche o que estiver usando a pasta e rode de novo.
goto sair
:sem_python
echo   Nao encontrei o python.exe. Instale o Python marcando "Add Python to PATH".
goto sair
:sem_bibliotecas
echo   Faltam bibliotecas do ETL. Instale e rode de novo:
echo      python -m pip install -r "%DEST%\requirements.txt"
goto sair

:sair
echo.
popd
pause
endlocal
