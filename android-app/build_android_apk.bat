@echo off
powershell -ExecutionPolicy Bypass -File "%~dp0setup_android_toolchain.ps1"
if errorlevel 1 exit /b %errorlevel%
powershell -ExecutionPolicy Bypass -File "%~dp0build_android_apk.ps1"
