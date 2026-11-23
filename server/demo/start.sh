#!/bin/sh
# Start the NVM Studio install server on this demo data root.
# NVM_ENGINE_SERVER_HOST=0.0.0.0 ./start.sh  to accept connections from other machines.
here=$(cd "$(dirname "$0")" && pwd)
export NVM_ENGINE_SERVER_PORT="${NVM_ENGINE_SERVER_PORT:-7788}"
export NVM_ENGINE_SERVER_HOST="${NVM_ENGINE_SERVER_HOST:-127.0.0.1}"
export NVM_ENGINE_REGISTRY_HOME="$here"
exec node "$here/../index.js"
