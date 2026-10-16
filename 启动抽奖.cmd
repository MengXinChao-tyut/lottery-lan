@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>&1
if errorlevel 1 (
  echo 未找到 Node.js。请安装 Node.js 20 或更新版本后，再双击本文件。
  pause
  exit /b 1
)
node "%~dp0launcher.cjs"
if errorlevel 1 pause
