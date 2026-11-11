#!/bin/bash
# Throwaway (Main): on the worker copy: each test file in .rowcheck-files, then each mutation in .rowcheck-muts (testfile TAB sed).
run() { npx vitest run --project app "$1" --maxWorkers=1 < /dev/null 2>&1 | grep -aE "Tests  |×|AssertionError" | head -12; }
while IFS= read -r f; do echo "=== BASE $f"; run "$f"; done < .rowcheck-files
while IFS=$'\t' read -r f m; do
  target=$(printf '%s' "$m" | awk '{print $NF}')
  cp "$target" /tmp/rowcheck-$$.bak
  eval "$m"
  if cmp -s "$target" /tmp/rowcheck-$$.bak; then echo "=== MUT (NO CHANGE) $m"; continue; fi
  echo "=== MUT $m"; run "$f"
  cp /tmp/rowcheck-$$.bak "$target"
done < .rowcheck-muts
