#!/bin/sh
# End to end, against a real firewall: `pfw` is installed and on PATH. A web
# server is started and asked for a page as a browser and as a crawler, under
# each state the firewall can be in.
#
#   sh test/e2e.sh              on loopback
#   E2E_ON=veth sh test/e2e.sh  across a pair of virtual interfaces, the client
#                               in a network namespace of its own: traffic
#                               that arrives on an interface from elsewhere
#
#   E2E_DAEMON_RESTART=yes      also restart yeetd, as a reboot would, and
#                               check the firewall comes back as it was
#
# It changes the firewall on this host, and stops it at the end, so it is for
# CI and for scratch hosts, never one that is protecting something.
set -eu

# CI says yes by being CI; anywhere else it has to be asked for.
[ -n "${CI:-}" ] || [ "${PFW_E2E:-}" = yes ] || {
	echo "test/e2e.sh changes the firewall running on this host, and stops it." >&2
	echo "On a scratch host, run it with PFW_E2E=yes." >&2
	exit 2
}

ON=${E2E_ON:-lo}
PORT=80
OTHER=8080

fail() {
	printf 'FAIL  %s\n' "$*" >&2
	pfw status >&2 || true
	exit 1
}
pass() { printf 'ok    %s\n' "$*"; }

# Where the server listens, the interface its traffic arrives on, and how
# the client reaches it.
case $ON in
lo)
	HOST=127.0.0.1 IFACE=lo CLIENT=''
	;;
veth)
	HOST=10.99.0.1 IFACE=pfwe0 CLIENT='sudo ip netns exec pfwens'
	sudo ip link add pfwe0 type veth peer name pfwe1
	sudo ip addr add 10.99.0.1/24 dev pfwe0
	sudo ip link set pfwe0 up
	sudo ip netns add pfwens
	sudo ip link set pfwe1 netns pfwens
	sudo ip -n pfwens addr add 10.99.0.2/24 dev pfwe1
	sudo ip -n pfwens link set pfwe1 up
	;;
*) fail "E2E_ON is lo or veth, not $ON" ;;
esac

# Port 80 takes root. Each server's id is noted, to stop it on the way out.
pids=''
serve() {
	pids="$pids $(sudo sh -c "python3 -m http.server $1 --bind $HOST >/dev/null 2>&1 & echo \$!")"
}
cleanup() {
	for pid in $pids; do sudo kill "$pid" 2>/dev/null || true; done
	if [ "$ON" = veth ]; then
		sudo ip netns del pfwens 2>/dev/null || true
		sudo ip link del pfwe0 2>/dev/null || true
	fi
}
trap cleanup EXIT
serve "$PORT"
serve "$OTHER"
sleep 1

# The HTTP status a request gets; 000 when the connection was cut.
ask() { $CLIENT curl -s -o /dev/null -m 5 -w '%{http_code}' ${2:+-A "$2"} "http://$HOST:$1/" || true; }

expect() {
	got=$(ask "$2" "${3:-}")
	[ "$got" = "$1" ] || fail "$4: expected $1, got $got"
	pass "[$ON] $4"
}

pfw up
pfw clear >/dev/null 2>&1 || true
pfw unshadow >/dev/null

if [ "$ON" != lo ]; then
	pfw attach "$IFACE"
	pfw detach lo
fi
pfw doctor || fail 'pfw doctor found something to fix'
pfw status | grep -q "on $IFACE" || fail "the firewall is not on $IFACE"

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
pass "[$ON] status, metrics and the exporter agree"

pfw restart
pfw status | grep -q 'rules:http/crawlers.pfc' || fail 'the policy did not survive a restart'
pfw status | grep -q "on $IFACE" || fail "the firewall did not come back on $IFACE"
expect 000 "$PORT" GPTBot 'after a restart: a crawler is still cut off'

# The nearest thing to a reboot that leaves the machine up: the daemon goes
# down and comes back, and has to bring the firewall with it.
if [ "${E2E_DAEMON_RESTART:-}" = yes ]; then
	sudo systemctl restart yeetd
	tries=0
	until pfw status >/dev/null 2>&1; do
		tries=$((tries + 1))
		[ "$tries" -lt 60 ] || fail 'the firewall did not come back after yeetd restarted'
		sleep 1
	done
	pfw status | grep -q 'rules:http/crawlers.pfc' || fail 'the policy did not survive yeetd restarting'
	pfw status | grep -q "on $IFACE" || fail "the firewall did not come back on $IFACE after yeetd restarted"
	expect 000 "$PORT" GPTBot 'after yeetd restarted: a crawler is still cut off'
fi

pfw clear
expect 200 "$PORT" GPTBot 'cleared: a crawler gets the page'

if [ "$ON" != lo ]; then
	pfw attach lo
	pfw detach "$IFACE"
fi

pfw down
if pfw status >/dev/null 2>&1; then fail 'status says up after down'; fi
pass "[$ON] down: status exits non-zero"

printf '\nall of it works on %s, across %s, kernel %s\n' "$(uname -m)" "$ON" "$(uname -r)"
