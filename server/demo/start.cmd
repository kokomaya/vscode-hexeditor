@echo off
rem Start the NVM Studio install server on this demo data root.
rem Set NVM_ENGINE_SERVER_HOST=0.0.0.0 to accept connections from other machines.
setlocal
if not defined NVM_ENGINE_SERVER_PORT set NVM_ENGINE_SERVER_PORT=7788
if not defined NVM_ENGINE_SERVER_HOST set NVM_ENGINE_SERVER_HOST=127.0.0.1
set NVM_ENGINE_REGISTRY_HOME=%~dp0
node "%~dp0..\index.js"
endlocal
