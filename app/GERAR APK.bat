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
rem ===========================================================================
setlocal
set "L=%LOCALAPPDATA%\LubeAndroid"
set "JAVA_HOME=%L%\java\jdk-21.0.12.1+1"
set "ANDROID_HOME=%L%\sdk"
title Supervisor Lube - gerar APK
cd /d "%~dp0android"

echo.
echo   SUPERVISOR LUBE - gerar APK
echo   ============================================
echo.
if not exist "%JAVA_HOME%\bin\java.exe" goto sem_java
if not exist "%ANDROID_HOME%\platforms" goto sem_sdk
if not exist "assinatura.properties" goto sem_chave

call gradlew.bat assembleRelease --no-daemon
if errorlevel 1 goto falhou

copy /y "app\build\outputs\apk\release\app-release.apk" "%USERPROFILE%\Downloads\Supervisor Lube.apk" >nul
echo.
echo   PRONTO. APK em: %USERPROFILE%\Downloads\Supervisor Lube.apk
goto sair

:sem_java
echo   Nao achei o Java 21 em %JAVA_HOME%.
goto sair
:sem_sdk
echo   Nao achei o Android SDK em %ANDROID_HOME%.
goto sair
:sem_chave
echo   Falta o android\assinatura.properties (a chave da Lube). Copie de
echo   P:\INTEGRACAO BI\SUPERVISOR\4 - ASSINATURA ANDROID e confira o caminho dentro dele.
goto sair
:falhou
echo.
echo   O BUILD FALHOU. Leia as linhas acima (ou tire print e mande para o Claude).
goto sair

:sair
echo.
pause
endlocal
