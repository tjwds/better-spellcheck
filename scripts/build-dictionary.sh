#!/usr/bin/env bash
# Regenerates hooks/words.txt from aspell's en_US master dictionary.
# `aspell dump master` already lists every inflected form (plurals, tenses).
set -euo pipefail
cd "$(dirname "$0")/.."
aspell -d en_US dump master | tr -d '\r' | LC_ALL=C sort -u > hooks/words.txt
wc -l hooks/words.txt
