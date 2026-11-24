#!/bin/sh
# Checks the monitoring files in contrib/: the dashboard is JSON, and every
# pfw metric they name is one pfw exports. What pfw exports is the EXPORTED
# list in test/document.test.js, which a unit test holds to the real page.
#
#   sh contrib/check.sh
set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
exported=$(sed -n '/^const EXPORTED = \[/,/^\];/p' "$root/test/document.test.js" | grep -o '"pfw_[a-z0-9_]*"' | tr -d '"')
[ -n "$exported" ] || {
	echo "contrib: no EXPORTED list in test/document.test.js" >&2
	exit 1
}

bad=0
if command -v python3 >/dev/null 2>&1; then
	python3 -c 'import json, sys; json.load(open(sys.argv[1]))' "$root/contrib/grafana/pfw.json" || {
		echo "contrib: grafana/pfw.json is not JSON" >&2
		bad=1
	}
fi

# A histogram is named by its family: its series carry a suffix.
for used in $(grep -oh 'pfw_[a-z0-9_]*' "$root/contrib/prometheus/alerts.yml" "$root/contrib/grafana/pfw.json" | sed 's/_bucket$//' | sort -u); do
	printf '%s\n' "$exported" | grep -qx "$used" || {
		echo "contrib: $used is not a metric pfw exports" >&2
		bad=1
	}
done
exit $bad
