@echo off
cd /d "%~dp0"
py rivali_timing_listener.py
if errorlevel 1 pause
