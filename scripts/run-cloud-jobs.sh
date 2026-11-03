#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
exec "${NODE_BINARY:-node}" scripts/cloud-jobs.mjs
