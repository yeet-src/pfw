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
# It changes the firewall `pfw` drives, and stops it at the end, so it is for
# CI and for scratch hosts, never one that is protecting something. On a
# machine with a firewall to leave alone, test/scratch.sh makes one for it:
#
#   make scratch
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
METRICS=$(printf '%s\n' "${PFW_URL:-ws://127.0.0.1:9477/ctl}" | sed -e 's|^ws|http|' -e 's|/ctl$|/metrics|')

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

# Onto the interface under test and off whatever it started on, which is
# given back at the end.
home=''
if [ "$ON" != lo ]; then
	home=$(pfw __complete detach '' | grep -vx "$IFACE" | tr '\n' ' ')
	pfw attach "$IFACE"
	for each in $home; do pfw detach "$each"; done
fi
pfw doctor || fail 'pfw doctor found something to fix'
# Loopback hands the firewall segments larger than it reads of one. doctor
# has to say so wherever the firewall is on `lo`, and not where it is not.
if [ "$ON" = lo ]; then
	pfw doctor | grep -q 'lo delivers segments larger' || fail 'pfw doctor does not warn that lo delivers oversized segments'
else
	! pfw doctor | grep -q 'delivers segments larger' || fail "pfw doctor warns about oversized segments on $IFACE, which has an ordinary MTU"
fi
pfw status | grep -q "on $IFACE" || fail "the firewall is not on $IFACE"

expect 200 "$PORT" '' 'no policy: a browser gets the page'
expect 200 "$PORT" GPTBot 'no policy: a crawler gets the page'

# `pfw setup` does the first steps of the guide: the interface, the pull,
# the policy and its knob, and leaves it rehearsing.
pfw setup --yes --iface "$IFACE" --policy rules:http/crawlers.pfc --knob "port=$PORT"
pfw ls | grep -q 'rules:http/crawlers.pfc' || fail 'the public rules are not listed'
pfw status | grep -q "on $IFACE   shadow mode" || fail 'setup did not leave the firewall rehearsing'
pfw status | grep -q "port $PORT" || fail 'setup did not set the knob'
expect 200 "$PORT" GPTBot 'after setup: rehearsing, a crawler gets the page'
pfw status | grep -q 'would block [1-9]' || fail 'the rehearsal does not count what it would block'
pfw __complete detach '' | grep -qx "$IFACE" || fail 'completion does not offer the attached interface'
pfw __complete knob set '' | grep -qx port || fail 'completion does not offer the enforcing policy'"'"'s knob'

# On trial: it blocks, and when nobody confirms it goes back by itself.
pfw unshadow --confirm 6s
pfw status | grep -q 'trial    undone in' || fail 'status does not say a change is on trial'
expect 000 "$PORT" GPTBot 'on trial: a crawler is cut off'
sleep 8
expect 200 "$PORT" GPTBot 'the trial was not confirmed: a crawler gets the page again'
pfw status | grep -q 'not confirmed: went back' || fail 'status does not say the trial went back'
curl -fsS -m 5 "$METRICS" | grep -q '^pfw_trial_pending 0' || fail 'Prometheus says a trial is still pending'

# Confirmed, it stays.
pfw unshadow --confirm
curl -fsS -m 5 "$METRICS" | grep -q '^pfw_trial_pending 1' || fail 'Prometheus does not say a trial is pending'
pfw confirm
if pfw confirm >/dev/null 2>&1; then fail 'confirm with nothing on trial did not fail'; fi
pfw status | grep -q 'trial' && fail 'a confirmed change is still shown on trial'
pfw status | grep -q 'enforcing' || fail 'the policy is not enforcing'

expect 200 "$PORT" '' 'enforcing: a browser gets the page'
expect 000 "$PORT" GPTBot 'enforcing: a crawler is cut off'

# Rollback: to the policy before, and of a trial, at once.
pfw apply rules:baseline/pass.pfc
expect 200 "$PORT" GPTBot 'another policy applied: a crawler gets the page'
pfw rollback
pfw status | grep -q 'rules:http/crawlers.pfc' || fail 'rollback did not return to the policy before'
expect 000 "$PORT" GPTBot 'rolled back: a crawler is cut off again'
pfw apply rules:baseline/pass.pfc --confirm 10m
expect 200 "$PORT" GPTBot 'a policy on trial: a crawler gets the page'
said=$(pfw rollback)
case $said in *'rolled back the trial'*) ;; *) fail 'rollback did not undo the trial' ;; esac
expect 000 "$PORT" GPTBot 'the trial rolled back: a crawler is cut off again'

# What the firewall says as it is changed.
log=$(mktemp)
PFW_DEBUG=1 timeout 6 pfw logs >"$log" 2>&1 &
sleep 2
pfw shadow >/dev/null
pfw unshadow >/dev/null
wait || true
grep -q 'pfw: shadow' "$log" && grep -q 'pfw: unshadow' "$log" || {
	cat "$log" >&2
	fail 'pfw logs did not show the changes'
}
rm -f "$log"
pass "[$ON] logs follow the firewall"

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
curl -fsS -m 5 "$METRICS" | grep -q '^pfw_rule_hits_total{rule="crawler"} [1-9]' ||
	fail 'Prometheus does not count the crawler rule'
pass "[$ON] status, metrics and the exporter agree"

# A restart in the middle of a trial comes back to what was confirmed.
pfw apply rules:baseline/pass.pfc --confirm 10m
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

if [ -n "$home" ]; then
	pfw attach $home
	pfw detach "$IFACE"
fi

pfw down
if pfw status >/dev/null 2>&1; then fail 'status says up after down'; fi
pass "[$ON] down: status exits non-zero"

printf '\nall of it works on %s, across %s, kernel %s\n' "$(uname -m)" "$ON" "$(uname -r)"
