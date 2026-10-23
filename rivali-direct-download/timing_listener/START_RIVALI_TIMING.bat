@echo off
cd /d "%~dp0"
py rivali_dashboard.py
if errorlevel 1 pause
