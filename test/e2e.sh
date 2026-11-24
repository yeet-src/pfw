#!/bin/sh
# End to end, against a real firewall: install has been run, `pfw` is on
# PATH and the service is up on `lo`. A web server is started on loopback and
# asked for a page as a browser and as a crawler, under each state the
# firewall can be in.
#
#   sh test/e2e.sh
#
# It changes the firewall it is pointed at, so it is for CI and for scratch
# hosts, never one that is protecting something.
set -eu

# It applies and clears policies and stops the firewall at the end. CI says
# yes by being CI; anywhere else it has to be asked for.
[ -n "${CI:-}" ] || [ "${PFW_E2E:-}" = yes ] || {
	echo "test/e2e.sh changes the firewall running on this host, and stops it." >&2
	echo "On a scratch host, run it with PFW_E2E=yes." >&2
	exit 2
}

PORT=80
OTHER=8080
WEB=http://127.0.0.1

fail() {
	printf 'FAIL  %s\n' "$*" >&2
	pfw status >&2 || true
	exit 1
}
pass() { printf 'ok    %s\n' "$*"; }

# The HTTP status a request gets; 000 when the connection was cut.
ask() { curl -s -o /dev/null -m 5 -w '%{http_code}' ${2:+-A "$2"} "$WEB:$1/" || true; }

expect() {
	got=$(ask "$2" "${3:-}")
	[ "$got" = "$1" ] || fail "$4: expected $1, got $got"
	pass "$4"
}

# The servers are stopped by the files that hold their ids, on the way out.
pids=$(mktemp)
serve() {
	sudo sh -c "python3 -m http.server $1 --bind 127.0.0.1 >/dev/null 2>&1 & echo \$! >> $pids"
}
stop_servers() {
	while read -r pid; do sudo kill "$pid" 2>/dev/null || true; done <"$pids"
	rm -f "$pids"
}
trap stop_servers EXIT
serve "$PORT"
serve "$OTHER"
sleep 1

pfw doctor || fail 'pfw doctor found something to fix'
pfw status | grep -q 'on lo' || fail 'the firewall is not on lo'

expect 200 "$PORT" '' 'no policy: a browser gets the page'
expect 200 "$PORT" GPTBot 'no policy: a crawler gets the page'

pfw pull
pfw ls | grep -q 'rules:http/crawlers.pfc' || fail 'the public rules are not listed'
pfw apply rules:http/crawlers.pfc
pfw status | grep -q 'enforcing' || fail 'the policy is not enforcing'

expect 200 "$PORT" '' 'enforcing: a browser gets the page'
expect 000 "$PORT" GPTBot 'enforcing: a crawler is cut off'

pfw shadow
expect 200 "$PORT" GPTBot 'shadow mode: a crawler gets the page'
pfw status | grep -q 'would block' || fail 'shadow mode does not say what it would block'
pfw unshadow
expect 000 "$PORT" GPTBot 'shadow mode off: a crawler is cut off again'

pfw knob set port "$OTHER"
expect 200 "$PORT" GPTBot "knob port=$OTHER: the old port is left alone"
expect 000 "$OTHER" GPTBot "knob port=$OTHER: a crawler is cut off on the new one"
pfw knob unset port
expect 000 "$PORT" GPTBot 'knob unset: back to guarding the default port'

pfw --json status | grep -q '"ok":true' || fail 'the JSON status is not ok'
pfw metrics | grep -q '^packets' || fail 'the text metrics page is missing'
curl -fsS -m 5 http://127.0.0.1:9477/metrics | grep -q '^pfw_rule_hits_total{rule="crawler"} [1-9]' ||
	fail 'Prometheus does not count the crawler rule'
pass 'status, metrics and the exporter agree'

pfw restart
pfw status | grep -q 'rules:http/crawlers.pfc' || fail 'the policy did not survive a restart'
expect 000 "$PORT" GPTBot 'after a restart: a crawler is still cut off'

pfw clear
expect 200 "$PORT" GPTBot 'cleared: a crawler gets the page'

pfw down
if pfw status >/dev/null 2>&1; then fail 'status says up after down'; fi
pass 'down: status exits non-zero'

printf '\nall of it works on %s, kernel %s\n' "$(uname -m)" "$(uname -r)"
