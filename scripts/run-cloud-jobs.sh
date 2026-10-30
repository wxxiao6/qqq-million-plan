#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
export CLOUD_SITE_URL="https://qqq-million-plan.cc.cd"
export CLOUD_JOB_TOKEN="$(cat data/cloud-jobs/job-token)"
exec "${NODE_BINARY:-node}" scripts/cloud-jobs.mjs
