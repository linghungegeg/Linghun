#!/bin/bash
set -euo pipefail

greeting="hello world"
echo "$greeting"

if [ -f /tmp/test ]; then
  echo "file exists"
fi
