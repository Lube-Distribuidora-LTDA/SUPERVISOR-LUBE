@echo off
rem ===========================================================================
rem  GERAR APK - Supervisor Lube (Android)
rem
rem  Gera o APK NATIVO: as telas vao dentro do app (copiadas de ..\web) e so os
rem  dados vem de supervisor-lube.vercel.app. Assinado com a chave da Lube.
rem  Precisa:
rem    - Node (para copiar as telas e sincronizar o projeto Android)
rem    - Java 21 e Android SDK em %USERPROFILE%\LubeAndroid (instalados em 2026-10-22)
rem    - a chave em %USERPROFILE%\LubeAndroid\assinatura (copia no P:, pasta
rem      "4 - ASSINATURA ANDROID") e o android\assinatura.properties apontando para ela
rem
rem  Versao nova: suba versionCode e versionName em android\app\build.gradle, gere,
rem  e o Claude publica o APK em supervisor-lube.vercel.app/baixar junto com o
rem  web\versao-app.json (o app avisa quem tem a versao antiga).
rem
rem  O APK sai em:  Downloads\Supervisor Lube.apk
rem                 ..\web\baixar\supervisor-lube.apk   (para publicar no site)
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
title Supervisor Lube - gerar APK
cd /d "%APP%"

echo.
echo   SUPERVISOR LUBE - gerar APK
echo   ============================================
echo.
> "%LOG%" echo ===== GERAR APK %DATE% %TIME% em %COMPUTERNAME% por %USERNAME%
>> "%LOG%" echo pasta: %CD%
>> "%LOG%" echo JAVA_HOME: %JAVA_HOME%
where node >nul 2>nul
if errorlevel 1 goto sem_node
if not exist "%JAVA_HOME%\bin\java.exe" goto sem_java
if not exist "%ANDROID_HOME%\platforms" goto sem_sdk
if not exist "android\assinatura.properties" goto sem_chave
>> "%LOG%" echo conferencias OK

echo   [1/3] Copiando as telas para dentro do app...
call node preparar-web.js >> "%LOG%" 2>&1
if errorlevel 1 goto falhou_web
echo   [2/3] Sincronizando o projeto Android...
call npx cap sync android >> "%LOG%" 2>&1
if errorlevel 1 goto falhou_web

echo   [3/3] Compilando (a primeira vez leva alguns minutos)...
echo.
cd /d "%APP%android"
powershell -NoProfile -ExecutionPolicy Bypass -Command "& .\gradlew.bat assembleRelease --no-daemon 2>&1 | Tee-Object -FilePath $env:LOG -Append; exit $LASTEXITCODE"
if errorlevel 1 goto falhou
if not exist "app\build\outputs\apk\release\app-release.apk" goto sem_apk

copy /y "app\build\outputs\apk\release\app-release.apk" "%USERPROFILE%\Downloads\Supervisor Lube.apk" >nul
copy /y "app\build\outputs\apk\release\app-release.apk" "%APP%..\web\baixar\supervisor-lube.apk" >nul
rem a pasta de rede tem acento no nome: acha pelo comeco do nome, sem escrever o acento aqui
for /d %%D in ("P:\INTEGRA*BI") do if exist "%%D\SUPERVISOR\5 - APP ANDROID" copy /y "app\build\outputs\apk\release\app-release.apk" "%%D\SUPERVISOR\5 - APP ANDROID\Supervisor Lube.apk" >nul 2>nul
>> "%LOG%" echo PRONTO: %USERPROFILE%\Downloads\Supervisor Lube.apk
echo.
echo   PRONTO. APK em: %USERPROFILE%\Downloads\Supervisor Lube.apk
echo   Avise o Claude para publicar o link de download.
goto sair

:sem_node
echo   Nao achei o Node (node.exe). Instale o Node.js e rode de novo.
>> "%LOG%" echo ERRO: sem node
goto sair
:sem_java
echo   Nao achei o Java 21 em %JAVA_HOME%.
>> "%LOG%" echo ERRO: sem java em %JAVA_HOME%
goto sair
:sem_sdk
echo   Nao achei o Android SDK em %ANDROID_HOME%.
>> "%LOG%" echo ERRO: sem SDK em %ANDROID_HOME%
goto sair
:sem_chave
echo   Falta o android\assinatura.properties (a chave da Lube). Copie de
echo   P:\INTEGRACAO BI\SUPERVISOR\4 - ASSINATURA ANDROID e confira o caminho dentro dele.
>> "%LOG%" echo ERRO: sem assinatura.properties
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

:sair
echo.
pause
endlocal
