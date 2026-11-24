#!/bin/sh
# Copies the diagrams in assets/ into the pages that show them.
#
# A page marks where a diagram goes:
#
#   <!-- diagram: architecture -->
#   <!-- /diagram -->
#
# and this writes assets/architecture.mmd between the two, as a mermaid
# block, which GitHub draws. The .mmd file is the one to edit.
#
#   assets/embed.sh           rewrite the pages
#   assets/embed.sh --check   change nothing; fail if a page is out of date

set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
check=no
[ "${1:-}" = "--check" ] && check=yes

stale=0
for page in "$root"/README.md "$root"/docs/*.md; do
  grep -q '^<!-- diagram: ' "$page" || continue

  fresh=$(mktemp)
  awk -v dir="$root/assets" '
    /^<!-- diagram: [a-z0-9-]+ -->$/ {
      name = $3
      file = dir "/" name ".mmd"
      print
      print "```mermaid"
      found = 0
      while ((getline line < file) > 0) { print line; found = 1 }
      close(file)
      if (!found) { print "No diagram called " name > "/dev/stderr"; failed = 1 }
      print "```"
      skipping = 1
      next
    }
    /^<!-- \/diagram -->$/ { skipping = 0 }
    !skipping { print }
    END { if (skipping) { print "A diagram is not closed" > "/dev/stderr"; failed = 1 }; exit failed }
  ' "$page" > "$fresh" || { echo "embed: $page" >&2; rm -f "$fresh"; exit 1; }

  if cmp -s "$page" "$fresh"; then
    rm -f "$fresh"
  elif [ "$check" = yes ]; then
    echo "embed: ${page#"$root"/} is behind assets/; run assets/embed.sh" >&2
    rm -f "$fresh"
    stale=1
  else
    cat "$fresh" > "$page"
    rm -f "$fresh"
    echo "embed: ${page#"$root"/}"
  fi
done

exit $stale
