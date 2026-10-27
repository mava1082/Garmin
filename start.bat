@echo off
rem Dubbelklicka på den här filen för att starta dashboarden (Windows).
chcp 65001 >nul
cd /d "%~dp0"

if exist ".venv\Scripts\python.exe" goto install

where py >nul 2>nul
if %errorlevel%==0 (
  set "PY=py -3"
) else (
  where python >nul 2>nul
  if errorlevel 1 goto nopython
  set "PY=python"
)
echo Förbereder första gången, det tar en eller ett par minuter...
%PY% -m venv .venv
if errorlevel 1 goto nopython

:install
".venv\Scripts\python.exe" -m pip install -q --disable-pip-version-check -r requirements.txt
if errorlevel 1 goto failed

".venv\Scripts\python.exe" -m garmin_dashboard --open
pause
exit /b 0

:nopython
echo.
echo Python saknas. Installera det från https://www.python.org/downloads/
echo Kryssa i rutan "Add python.exe to PATH" under installationen och starta sedan den här filen igen.
pause
exit /b 1

:failed
echo.
echo Installationen misslyckades. Kontrollera internetanslutningen och försök igen.
pause
exit /b 1
