@echo off
rem ===========================================================================
rem  GERAR APK - Supervisor Lube (Android)
rem
rem  Gera o APK NATIVO: as telas vao dentro do app (copiadas de ..\web) e so os
rem  dados vem de supervisor-lube.vercel.app. Assinado com a chave da Lube.
rem
rem  O PROJETO FICA NA REDE (P:\INTEGRACAO BI\SUPERVISOR\6 - PROJETO DO APP, desde
rem  2026-10-23, pedido do Julio). Compilar Android direto na rede trava e fica
rem  lento (milhares de arquivos pequenos e arquivos bloqueados), entao este bat:
rem    1. traz o projeto da rede para uma copia de obra nesta maquina
rem       (%USERPROFILE%\LubeAndroid\obra; so o que mudou, depois da 1a vez);
rem    2. compila la;
rem    3. devolve o APK para a rede.
rem  Precisa:
rem    - Node (para copiar as telas e sincronizar o projeto Android)
rem    - Java 21 e Android SDK em %USERPROFILE%\LubeAndroid (instalados em 2026-10-22)
rem    - a chave da Lube: se faltar nesta maquina, vem sozinha de
rem      P:\INTEGRACAO BI\SUPERVISOR\4 - ASSINATURA ANDROID
rem
rem  Versao nova: suba versionCode e versionName em android\app\build.gradle, gere,
rem  e o Claude publica o APK em supervisor-lube.vercel.app/baixar junto com o
rem  web\versao-app.json (o app avisa quem tem a versao antiga).
rem
rem  O APK sai em:  Downloads\Supervisor Lube.apk
rem                 ..\web\baixar\supervisor-lube.apk   (no projeto da rede, para publicar)
rem                 P:\INTEGRACAO BI\SUPERVISOR\5 - APP ANDROID
rem  Tudo o que aparece na tela tambem vai para %USERPROFILE%\LubeAndroid\gerar-apk.log:
rem  se der erro, o Claude le de la (nao precisa de print).
rem ===========================================================================
setlocal
set "L=%USERPROFILE%\LubeAndroid"
set "LOG=%L%\gerar-apk.log"
set "JAVA_HOME=%L%\java\jdk-21.0.12.1+1"
set "ANDROID_HOME=%L%\sdk"
set "APP=%~dp0"
rem caminho do projeto ja resolvido (sem o "..", senao o robocopy nao reconhece as pastas a pular)
for %%I in ("%~dp0..") do set "PROJ=%%~fI"
set "OBRA=%L%\obra"
title Supervisor Lube - gerar APK
cd /d "%APP%"

echo.
echo   SUPERVISOR LUBE - gerar APK
echo   ============================================
echo.
rem --- uma compilacao de cada vez: duas ao mesmo tempo se atropelam na mesma pasta (2026-10-22) ---
if not exist "%L%" mkdir "%L%"
set "TRAVA=%L%\gerar-apk.trava"
if not exist "%TRAVA%" goto livre
powershell -NoProfile -Command "if (((Get-Date) - (Get-Item $env:TRAVA).LastWriteTime).TotalMinutes -lt 30) { exit 1 } else { exit 0 }"
if errorlevel 1 goto ja_rodando
:livre
> "%TRAVA%" echo %DATE% %TIME%
set "TRAVA_MINHA=1"
> "%LOG%" echo ===== GERAR APK %DATE% %TIME% em %COMPUTERNAME% por %USERNAME%
>> "%LOG%" echo projeto: %PROJ%
>> "%LOG%" echo obra: %OBRA%
>> "%LOG%" echo JAVA_HOME: %JAVA_HOME%
where node >nul 2>nul
if errorlevel 1 goto sem_node
if not exist "%JAVA_HOME%\bin\java.exe" goto sem_java
if not exist "%ANDROID_HOME%\platforms" goto sem_sdk
if not exist "android\assinatura.properties" goto sem_chave
>> "%LOG%" echo conferencias OK

echo   [1/4] Trazendo o projeto da rede para esta maquina...
rem /MIR deixa a obra igual a rede; a compilacao velha e as telas copiadas ficam de fora (se refazem)
robocopy "%APP%." "%OBRA%\app" /MIR /R:2 /W:2 /NFL /NDL /NP /NJH /XD "%APP%android\build" "%APP%android\app\build" "%APP%android\.gradle" "%APP%www" "%APP%ios\App\build" >> "%LOG%" 2>&1
if errorlevel 8 goto falhou_copia
robocopy "%PROJ%\web" "%OBRA%\web" /MIR /R:2 /W:2 /NFL /NDL /NP /NJH /XD "%PROJ%\web\node_modules" "%PROJ%\web\baixar" "%PROJ%\web\api" "%PROJ%\web\db" >> "%LOG%" 2>&1
if errorlevel 8 goto falhou_copia
rem chave e SDK desta maquina: a chave vem da rede se faltar; os caminhos sao reescritos so na obra
if exist "%L%\assinatura\supervisor-lube.p12" goto tem_chave
if not exist "%L%\assinatura" mkdir "%L%\assinatura"
for /d %%D in ("P:\INTEGRA*BI") do if exist "%%D\SUPERVISOR\4 - ASSINATURA ANDROID\supervisor-lube.p12" copy /y "%%D\SUPERVISOR\4 - ASSINATURA ANDROID\supervisor-lube.p12" "%L%\assinatura\supervisor-lube.p12" >nul
if not exist "%L%\assinatura\supervisor-lube.p12" goto sem_chave
:tem_chave
powershell -NoProfile -Command "$a = Join-Path $env:OBRA 'app\android'; $k = ($env:L + '\assinatura\supervisor-lube.p12').Replace('\','/'); (Get-Content (Join-Path $a 'assinatura.properties')) -replace '^storeFile=.*', ('storeFile=' + $k) | Set-Content -Encoding ASCII (Join-Path $a 'assinatura.properties'); Set-Content -Encoding ASCII (Join-Path $a 'local.properties') ('sdk.dir=' + ($env:ANDROID_HOME).Replace('\','\\'))" >> "%LOG%" 2>&1
if errorlevel 1 goto falhou_copia
>> "%LOG%" echo copia da rede OK

cd /d "%OBRA%\app"
echo   [2/4] Copiando as telas para dentro do app...
call node preparar-web.js >> "%LOG%" 2>&1
if errorlevel 1 goto falhou_web
echo   [3/4] Sincronizando o projeto Android...
call npx cap sync android >> "%LOG%" 2>&1
if errorlevel 1 goto falhou_web

echo   [4/4] Compilando (a primeira vez leva alguns minutos)...
echo.
cd /d "%OBRA%\app\android"
rem o APK antigo sai antes: "PRONTO" so aparece se o novo foi gerado agora
if exist "app\build\outputs\apk\release\app-release.apk" del /q "app\build\outputs\apk\release\app-release.apk"
rem "clean" comeca do zero (sobra de compilacao interrompida da "Cannot find built manifest");
rem o cmd junta os avisos do Gradle na saida normal (o PowerShell pintava de vermelho como erro)
powershell -NoProfile -ExecutionPolicy Bypass -Command "& cmd /c 'gradlew.bat clean assembleRelease --no-daemon 2>&1' | Tee-Object -FilePath $env:LOG -Append; exit $LASTEXITCODE"
if errorlevel 1 goto falhou
if not exist "app\build\outputs\apk\release\app-release.apk" goto sem_apk

copy /y "app\build\outputs\apk\release\app-release.apk" "%USERPROFILE%\Downloads\Supervisor Lube.apk" >nul
copy /y "app\build\outputs\apk\release\app-release.apk" "%PROJ%\web\baixar\supervisor-lube.apk" >nul
if errorlevel 1 goto falhou_volta
rem a pasta de rede tem acento no nome: acha pelo comeco do nome, sem escrever o acento aqui
for /d %%D in ("P:\INTEGRA*BI") do if exist "%%D\SUPERVISOR\5 - APP ANDROID" copy /y "app\build\outputs\apk\release\app-release.apk" "%%D\SUPERVISOR\5 - APP ANDROID\Supervisor Lube.apk" >nul 2>nul
>> "%LOG%" echo PRONTO: %USERPROFILE%\Downloads\Supervisor Lube.apk e %PROJ%\web\baixar\supervisor-lube.apk
echo.
echo   PRONTO. APK em: %USERPROFILE%\Downloads\Supervisor Lube.apk
echo   (e no projeto da rede, em web\baixar). Avise o Claude para publicar.
goto sair

:ja_rodando
echo   JA EXISTE UMA COMPILACAO RODANDO (aberta ha menos de 30 minutos).
echo   Espere a outra janela terminar. Se nenhuma outra janela estiver aberta,
echo   apague o arquivo %TRAVA% e rode de novo.
goto sair_sem_trava
:sem_node
echo   Nao achei o Node (node.exe). Instale o Node.js e rode de novo.
>> "%LOG%" echo ERRO: sem node
goto sair
:sem_java
echo   Nao achei o Java 21 em %JAVA_HOME%.
echo   (Java e Android SDK so estao instalados no computador do Julio.)
>> "%LOG%" echo ERRO: sem java em %JAVA_HOME%
goto sair
:sem_sdk
echo   Nao achei o Android SDK em %ANDROID_HOME%.
>> "%LOG%" echo ERRO: sem SDK em %ANDROID_HOME%
goto sair
:sem_chave
echo   Falta a chave da Lube. Confira a pasta
echo   P:\INTEGRACAO BI\SUPERVISOR\4 - ASSINATURA ANDROID (supervisor-lube.p12 e
echo   assinatura.properties) e o android\assinatura.properties do projeto.
>> "%LOG%" echo ERRO: sem chave de assinatura
goto sair
:falhou_copia
echo   Nao consegui trazer o projeto da rede (P: desconectado?). Veja %LOG%.
>> "%LOG%" echo ERRO: copia da rede para a obra falhou
goto sair
:falhou_web
echo   Nao consegui copiar as telas ou sincronizar o projeto. Veja %LOG%.
>> "%LOG%" echo ERRO: preparar-web ou cap sync falhou
goto sair
:sem_apk
echo   O gradle terminou mas o APK nao apareceu. Veja %LOG%.
>> "%LOG%" echo ERRO: gradle terminou sem gerar o app-release.apk
goto sair
:falhou
echo.
echo   O BUILD FALHOU. O registro completo esta em %LOG% (o Claude le de la).
>> "%LOG%" echo ERRO: gradle terminou com erro
goto sair
:falhou_volta
echo   O APK foi gerado, mas nao consegui gravar na rede (web\baixar). Ele esta em Downloads.
>> "%LOG%" echo ERRO: nao gravou o APK no projeto da rede
goto sair

:sair
if defined TRAVA_MINHA del /q "%TRAVA%" >nul 2>nul
:sair_sem_trava
echo.
pause
endlocal
