@echo off
setlocal
cd /d "%~dp0"
python app.py --host 0.0.0.0 --port 8000
