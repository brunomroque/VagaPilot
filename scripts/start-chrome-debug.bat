@echo off
setlocal
if not defined LOCAL_BROWSER_PROFILE_DIR set "LOCAL_BROWSER_PROFILE_DIR=C:\Users\bruno\chrome-vagas"
set "CHROME=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME%" set "CHROME=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
start "" "%CHROME%" --remote-debugging-port=9223 --user-data-dir="%LOCAL_BROWSER_PROFILE_DIR%"
echo Chrome de vagas: porta 9223, perfil %LOCAL_BROWSER_PROFILE_DIR%
