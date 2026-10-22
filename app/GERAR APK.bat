@echo off
rem ===========================================================================
rem  GERAR APK - Supervisor Lube (Android)
rem
rem  Compila o APK assinado com a chave da Lube. Precisa:
rem    - Java 21 e Android SDK em %LOCALAPPDATA%\LubeAndroid (instalados em 2026-10-22)
rem    - a chave em %LOCALAPPDATA%\LubeAndroid\assinatura (copia no P:, pasta
rem      "4 - ASSINATURA ANDROID") e o android\assinatura.properties apontando para ela
rem
rem  So precisa rodar quando mudar icone, nome ou a casca: o conteudo do app vem
rem  do site publicado. Antes de gerar uma versao nova, suba o versionCode em
rem  android\app\build.gradle.
rem  O APK sai em android\app\build\outputs\apk\release\app-release.apk e e
rem  copiado para Downloads\Supervisor Lube.apk.
rem
rem  Tudo o que aparece na tela tambem vai para %LOCALAPPDATA%\LubeAndroid\gerar-apk.log:
rem  se der erro, o Claude le de la (nao precisa de print).
rem ===========================================================================
setlocal
set "L=%LOCALAPPDATA%\LubeAndroid"
set "LOG=%L%\gerar-apk.log"
set "JAVA_HOME=%L%\java\jdk-21.0.12.1+1"
set "ANDROID_HOME=%L%\sdk"
title Supervisor Lube - gerar APK
cd /d "%~dp0android"

echo.
echo   SUPERVISOR LUBE - gerar APK
echo   ============================================
echo.
> "%LOG%" echo ===== GERAR APK %DATE% %TIME% em %COMPUTERNAME% por %USERNAME%
>> "%LOG%" echo pasta: %CD%
>> "%LOG%" echo JAVA_HOME: %JAVA_HOME%
if not exist "%JAVA_HOME%\bin\java.exe" goto sem_java
if not exist "%ANDROID_HOME%\platforms" goto sem_sdk
if not exist "assinatura.properties" goto sem_chave
>> "%LOG%" echo conferencias OK, chamando o gradle

echo   Compilando (a primeira vez leva alguns minutos)...
echo.
powershell -NoProfile -ExecutionPolicy Bypass -Command "& .\gradlew.bat assembleRelease --no-daemon 2>&1 | Tee-Object -FilePath $env:LOG -Append; exit $LASTEXITCODE"
if errorlevel 1 goto falhou
if not exist "app\build\outputs\apk\release\app-release.apk" goto sem_apk

copy /y "app\build\outputs\apk\release\app-release.apk" "%USERPROFILE%\Downloads\Supervisor Lube.apk" >nul
>> "%LOG%" echo PRONTO: %USERPROFILE%\Downloads\Supervisor Lube.apk
echo.
echo   PRONTO. APK em: %USERPROFILE%\Downloads\Supervisor Lube.apk
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
