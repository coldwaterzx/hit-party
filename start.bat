@echo off
rem Double-click to start a local server (no browser cache) and open the base project.
cd /d "%~dp0"
start "" http://localhost:8780/
python serve.py 8780
