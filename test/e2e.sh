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
UPLOADS=8081
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
	rm -rf "${work:-}"
	if [ "$ON" = veth ]; then
		sudo ip netns del pfwens 2>/dev/null || true
		sudo ip link del pfwe0 2>/dev/null || true
	fi
}
trap cleanup EXIT
serve "$PORT"
serve "$OTHER"

# A server that reads all of what it is sent, for the uploads.
work=$(mktemp -d)
cat >"$work/sink.py" <<'SINK'
import http.server, sys

class Sink(http.server.BaseHTTPRequestHandler):
    def do_POST(self):
        self.rfile.read(int(self.headers.get("Content-Length", 0)))
        self.send_response(200)
        self.end_headers()

    def log_message(self, *args):
        pass

http.server.HTTPServer((sys.argv[1], int(sys.argv[2])), Sink).serve_forever()
SINK
# Started from a shell of its own: this one `wait`s later, for something else.
pids="$pids $(sh -c "python3 '$work/sink.py' $HOST $UPLOADS >/dev/null 2>&1 & echo \$!")"
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
pfw enforce >/dev/null

# Onto the interface under test and off whatever it started on, which is
# given back at the end.
home=''
if [ "$ON" != lo ]; then
	home=$(pfw __complete detach '' | grep -vx "$IFACE" | tr '\n' ' ')
	pfw attach "$IFACE"
	for each in $home; do pfw detach "$each"; done
fi
pfw doctor || fail 'pfw doctor found something to fix'
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
pfw enforce --confirm 6s
pfw status | grep -q 'trial    undone in' || fail 'status does not say a change is on trial'
expect 000 "$PORT" GPTBot 'on trial: a crawler is cut off'
sleep 8
expect 200 "$PORT" GPTBot 'the trial was not confirmed: a crawler gets the page again'
pfw status | grep -q 'not confirmed: went back' || fail 'status does not say the trial went back'
curl -fsS -m 5 "$METRICS" | grep -q '^pfw_trial_pending 0' || fail 'Prometheus says a trial is still pending'

# Confirmed, it stays.
pfw enforce --confirm
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

# Several policies at once. A route gives one port a policy of its own, in
# place of the default; the rest of the traffic still runs the default.
pfw apply rules:baseline/pass.pfc --port "$PORT"
pfw status | grep -q "route    tcp/$PORT  rules:baseline/pass.pfc" || fail 'status does not list the route'
[ "$(pfw ls | grep -c ' active')" -eq 2 ] || fail 'the list does not mark both policies in place'
expect 200 "$PORT" GPTBot 'a route: its port runs the policy that passes'
pfw --json status | grep -q "\"at\":\"tcp/$PORT\"" || fail 'the JSON status does not say where the routed policy is'

# The chain run first sees every packet, a routed one too. A policy that
# follows a stream cannot be in it, and is refused with everything as it was.
if pfw apply rules:http/crawlers.pfc --first >/dev/null 2>&1; then
	expect 000 "$PORT" GPTBot 'first: a crawler is cut off before the route passes it'
	curl -fsS -m 5 "$METRICS" | grep -q '^pfw_rule_hits_total{route="first",rule="crawler"} [1-9]' ||
		fail 'Prometheus does not count the rule of the policy run first'
	pfw clear --first
else
	pfw status | grep -q '  first ' && fail 'a refused policy is listed as running first'
	pass "[$ON] a policy that follows a stream is refused as one to run first"
fi
expect 200 "$PORT" GPTBot 'nothing runs first: the route passes a crawler'

# Two policies in place that both read `port` each keep a value of their own.
pfw knob set rules:runtimes/log4shell.pfc port "$OTHER" >/dev/null
pfw apply rules:runtimes/log4shell.pfc --port "$OTHER" >/dev/null
pfw clear --port "$PORT" >/dev/null
expect 000 "$PORT" GPTBot "knobs apart: the default still guards its own port"
[ "$(pfw knob ls | grep -c '^knobs of ')" -eq 2 ] || fail 'knob ls does not list both policies in place'
if pfw knob set port 81 >/dev/null 2>&1; then fail 'a knob two policies have was set with neither named'; fi
pfw clear --port "$OTHER" >/dev/null
pfw knob unset rules:runtimes/log4shell.pfc port >/dev/null
pfw apply rules:baseline/pass.pfc --port "$PORT" >/dev/null

# A policy that follows a stream reads all of a segment, however large. On
# loopback 60 kB goes as one segment, many times the engine's window; a
# signature at its very end is still found, and nothing is left unread.
cat >"$work/upload.pfc" <<POLICY
reassemble $UPLOADS;
pattern mark = "PFW-E2E-MARK";
filter {
  if (scan(payload, 4096) & mark) decide rst("mark", 0);
  decide pass;
}
POLICY
head -c 60000 /dev/zero | tr '\0' 'a' >"$work/clean"
{ cat "$work/clean"; printf 'PFW-E2E-MARK'; } >"$work/marked"
upload() { $CLIENT curl -s -o /dev/null -m 5 -w '%{http_code}' -H 'Expect:' --data-binary @"$1" "http://$HOST:$UPLOADS/" || true; }

pfw apply -f "$work/upload.pfc" --port "$UPLOADS" >/dev/null
[ "$(upload "$work/clean")" = 200 ] || fail 'a clean 60 kB upload did not arrive'
[ "$(upload "$work/marked")" = 000 ] || fail 'a signature at the end of a 60 kB upload was not caught'
curl -fsS -m 5 "$METRICS" | grep -q '^pfw_reassembly_total{event="truncated"} [1-9]' && fail 'part of a segment went unread'
pass "[$ON] a 60 kB upload is read to its last byte"
pfw clear --port "$UPLOADS" >/dev/null

# The routed policy survives a restart, in its place.
pfw restart
pfw status | grep -q "route    tcp/$PORT  rules:baseline/pass.pfc" || fail 'the route did not survive a restart'
expect 200 "$PORT" GPTBot 'after a restart: the route still passes a crawler'

pfw clear --port "$PORT"
pfw status | grep -q '  route ' && fail 'a cleared route is still listed'
expect 000 "$PORT" GPTBot 'the route cleared: its port is the default policy'"'"'s again'
if pfw clear --port "$PORT" >/dev/null 2>&1; then fail 'clearing a place with nothing in it did not fail'; fi
pfw rollback
expect 200 "$PORT" GPTBot 'rolled back: the route is back'
pfw clear --port "$PORT"
expect 000 "$PORT" GPTBot 'one policy again: a crawler is cut off'

# What the firewall says as it is changed.
log=$(mktemp)
PFW_DEBUG=1 timeout 6 pfw logs >"$log" 2>&1 &
sleep 2
pfw shadow >/dev/null
pfw enforce >/dev/null
wait || true
grep -q 'pfw: shadow' "$log" && grep -q 'pfw: enforce' "$log" || {
	cat "$log" >&2
	fail 'pfw logs did not show the changes'
}
rm -f "$log"
pass "[$ON] logs follow the firewall"

pfw shadow
expect 200 "$PORT" GPTBot 'shadow mode: a crawler gets the page'
pfw status | grep -q 'would block' || fail 'shadow mode does not say what it would block'
pfw enforce
expect 000 "$PORT" GPTBot 'shadow mode off: a crawler is cut off again'

pfw knob set port "$OTHER"
expect 200 "$PORT" GPTBot "knob port=$OTHER: the old port is left alone"
expect 000 "$OTHER" GPTBot "knob port=$OTHER: a crawler is cut off on the new one"
pfw knob unset port
expect 000 "$PORT" GPTBot 'knob unset: back to guarding the default port'

pfw --json status | grep -q '"ok":true' || fail 'the JSON status is not ok'
pfw metrics | grep -q '^packets' || fail 'the text metrics page is missing'
curl -fsS -m 5 "$METRICS" | grep -q '^pfw_rule_hits_total{route="default",rule="crawler"} [1-9]' ||
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
