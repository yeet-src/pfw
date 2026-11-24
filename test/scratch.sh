#!/bin/sh
# A scratch firewall for trying a change on a machine whose own firewall
# must be left alone: a second pfw service built from dist/, on a port, an
# interface, a state file, settings and a cache of its own. The command
# given is run with `pfw` meaning that one, and everything is removed after.
#
#   sh test/scratch.sh                         a shell to try things in
#   sh test/scratch.sh pfw status              one command
#   sh test/scratch.sh sh test/e2e.sh          the end-to-end test, against it
#
# It makes a pair of virtual interfaces (pfws0, pfws1), which takes sudo, and
# starts on pfws0. Build first: make.
set -eu

here=$(cd "$(dirname "$0")/.." && pwd)
[ -f "$here/dist/service.toml" ] || {
	echo "scratch: no build in $here/dist: run make first" >&2
	exit 2
}

PORT=19477
root=$(mktemp -d)
bin=$root/bin

cleanup() {
	status=$?
	"$here/bin/pfw" down >/dev/null 2>&1 || true
	yeet=$("$here/bin/pfw" config get yeet 2>/dev/null) && "$yeet" service remove "$PFW_SERVICE" >/dev/null 2>&1 || true
	sudo ip link del pfws0 2>/dev/null || true
	rm -rf "$root"
	exit "$status"
}

export PFW_CONFIG="$root/config/config"
export PFW_SERVICE=pfw-scratch
export PFW_SOURCE="$root/service"
export PFW_URL="ws://127.0.0.1:$PORT/ctl"
export PFW_CACHE="$root/cache"
trap cleanup EXIT INT TERM

sudo ip link del pfws0 2>/dev/null || true
sudo ip link add pfws0 type veth peer name pfws1
sudo ip link set pfws0 up
sudo ip link set pfws1 up

cp -R "$here/dist" "$root/service"
sed -i \
	-e "s|^args = .*|args = [\"--iface\", \"pfws0\", \"--state-file\", \"$root/state/state.js\"]|" \
	-e "s|\(web-server = \"http://[0-9.]*\):[0-9]*|\1:$PORT|" \
	"$root/service/service.toml"
grep -q ":$PORT" "$root/service/service.toml" && grep -q 'pfws0' "$root/service/service.toml" || {
	echo "scratch: could not point the scratch service at its own port and interface" >&2
	exit 1
}

# `pfw` on PATH is this tree's, for scripts that call it by name.
mkdir -p "$bin"
ln -s "$here/bin/pfw" "$bin/pfw"
PATH=$bin:$PATH
export PATH

pfw up >/dev/null
# The guard: never go on against a firewall that is not the scratch one.
pfw status | head -n 1 | grep -q 'on pfws0' || {
	echo "scratch: the firewall answering at $PFW_URL is not the scratch one" >&2
	exit 1
}

if [ $# -eq 0 ]; then
	echo "scratch: pfw here is the scratch firewall, on pfws0 at $PFW_URL; exit to remove it"
	"${SHELL:-sh}"
else
	"$@"
fi
