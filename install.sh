#!/bin/sh
# install.sh — set pfw up on this host: yeet, a login, the pfw command and
# the firewall service.
#
#   ./install.sh                  from a checkout: builds it, then installs
#   curl -fsSL URL/install.sh | sh    anywhere: installs the released package
#
#   --prefix DIR       where pfw goes: DIR/bin/pfw and DIR/share/pfw (default /usr/local)
#   --package SRC      the package to install, a file or a URL, in place of a build
#                      or the release (PFW_PACKAGE says the same)
#   --no-login         do not require a yeet login
#   --no-up            install only: leave the service for `pfw up`
#   -h, --help         this
#
# What it does, in order, stopping at the first thing it cannot put right:
#
#   1. checks this is Linux, with what the steps below need
#   2. finds yeet, and installs it when it is missing:  curl -fsSL https://yeet.cx | sh
#   3. waits for the yeet daemon to answer
#   4. checks yeet is logged in, and runs `yeet login` when it is not
#      (YEET_API_KEY, when set, logs in with that key and no browser)
#   5. gets pfw: built here in a checkout, else the package downloaded
#   6. installs the command and the service's files under the prefix
#   7. runs `pfw doctor`, then `pfw up`
#
# It can be run again: each step is skipped when it is already done.
set -eu

YEET_INSTALLER=https://yeet.cx
RELEASE=https://github.com/yeet-src/pfw/releases/latest/download/pfw.tar.gz

prefix=/usr/local
package=${PFW_PACKAGE:-}
want_login=1 want_up=1 yeet_flags=''

usage() {
	sed -n '2,/^set -eu$/p' "$0" | sed -e '$d' -e 's/^# \{0,1\}//'
}

while [ $# -gt 0 ]; do
	case $1 in
	--prefix)
		[ $# -ge 2 ] || { usage >&2; exit 2; }
		prefix=$2
		shift
		;;
	--package)
		[ $# -ge 2 ] || { usage >&2; exit 2; }
		package=$2
		shift
		;;
	--no-login) want_login='' ;;
	--no-phone-home) yeet_flags='--no-phone-home' ;;
	--no-up) want_up='' ;;
	-h | --help)
		usage
		exit 0
		;;
	*)
		usage >&2
		exit 2
		;;
	esac
	shift
done

# ---- output -----------------------------------------------------------------

# pfw's palette (bin/pfw): colored on a terminal, plain when piped.
if [ -t 1 ] && [ -z "${NO_COLOR:-}" ] && [ "${TERM:-dumb}" != dumb ]; then colored=1; else colored=''; fi
paint() {
	if [ -n "$colored" ]; then printf '\033[%sm%s\033[0m' "$1" "$2"; else printf '%s' "$2"; fi
}
ok() { paint '1;38;5;46' "$1"; }
bad() { paint '1;38;5;196' "$1"; }
warn() { paint '1;38;5;226' "$1"; }
label() { paint '38;5;135' "$1"; }
value() { paint '38;5;208' "$1"; }
note() { paint '38;5;214' "$1"; }
strong() { paint '1;38;5;231' "$1"; }

step() { printf '%s %s%*s  %s\n' "$(ok '✔')" "$(strong "$1")" "$((10 - ${#1}))" '' "$(note "$2")"; }
doing() { printf '%s %s%*s  %s\n' "$(label '●')" "$(strong "$1")" "$((10 - ${#1}))" '' "$(note "$2")"; }
caution() { printf '%s %s%*s  %s\n' "$(warn '▲')" "$(strong "$1")" "$((10 - ${#1}))" '' "$(warn "$2")"; }

# What went wrong, then what to do about it, and stop.
die() {
	printf '%s %s%*s  %s\n' "$(bad '✘')" "$(strong "$1")" "$((10 - ${#1}))" '' "$(bad "$2")" >&2
	[ -z "${3:-}" ] || printf '%*s%s\n' 14 '' "$(note "$3")" >&2
	exit 1
}

# ---- this host --------------------------------------------------------------

here=$(cd "$(dirname "$0")" 2>/dev/null && pwd || pwd)
if [ -f "$here/Makefile" ] && [ -f "$here/bin/pfw" ]; then tree=$here; else tree=''; fi

[ "$(uname -s)" = Linux ] ||
	die 'linux' "this is $(uname -s)" 'the firewall is an XDP program: run this on Linux (on macOS, inside the Lima VM)'
step 'linux' "kernel $(uname -r)"

need() {
	command -v "$1" >/dev/null 2>&1 || die "$1" 'not on PATH' "$2"
}
need tar 'the package is a tarball: install tar'
need git 'pfw pull clones policy repositories with git: install it'

# ---- yeet -------------------------------------------------------------------

# The first `yeet` on PATH that runs: a Lima shell can inherit a macOS PATH
# whose earlier `yeet` Linux cannot exec.
find_yeet() {
	old_ifs=$IFS
	IFS=:
	for bin in $PATH; do
		if [ -x "$bin/yeet" ] && "$bin/yeet" --version >/dev/null 2>&1; then
			IFS=$old_ifs
			printf '%s\n' "$bin/yeet"
			return
		fi
	done
	IFS=$old_ifs
	return 1
}

if ! YEET=$(find_yeet); then
	command -v curl >/dev/null 2>&1 ||
		die 'yeet' 'not installed, and neither is curl to fetch it' "install curl, or yeet by hand: $YEET_INSTALLER"
	doing 'yeet' "not installed: installing it with  curl -fsSL $YEET_INSTALLER | sh${yeet_flags:+ -s -- $yeet_flags}"
	curl -fsSL "$YEET_INSTALLER" | sh -s -- $yeet_flags || die 'yeet' 'its installer failed' "run it by hand to see why:  curl -fsSL $YEET_INSTALLER | sh"

	# Its installer may have put it where this shell does not look yet.
	PATH=$PATH:/usr/local/bin:$HOME/.local/bin:$HOME/.yeet/bin
	YEET=$(find_yeet) || die 'yeet' 'installed, but not found on PATH' 'open a new shell, then run this again'
fi
step 'yeet' "$YEET $("$YEET" version 2>/dev/null | sed -n 's/^Version: //p')"

# A yeet just installed takes a moment to bring its daemon up.
tries=0
until "$YEET" status >/dev/null 2>&1; do
	tries=$((tries + 1))
	[ "$tries" -lt 30 ] ||
		die 'daemon' 'the yeet daemon does not answer' 'start it, and check that you may use its socket; `yeet status` should say Ok'
	sleep 1
done
step 'daemon' 'yeetd answers'

# yeet serves a login page in place of every route of a host that is not
# logged in, so the firewall cannot be driven until this one is. A key in
# YEET_API_KEY logs it in without a browser, for a machine nobody is sitting
# at. Piped from curl, this script's own input is the pipe, so the login is
# given the terminal instead.
if [ -z "$want_login" ]; then
	caution 'login' 'not checked (--no-login)'
elif "$YEET" whoami --quiet >/dev/null 2>&1; then
	step 'login' 'this host is logged in'
elif [ -n "${YEET_API_KEY:-}" ]; then
	"$YEET" login --key "$YEET_API_KEY" >/dev/null 2>&1 || die 'login' 'yeet refused the key in YEET_API_KEY' 'check the key, or run `yeet login`'
	"$YEET" whoami --quiet >/dev/null 2>&1 || die 'login' 'still not logged in' 'run `yeet login`, then this again'
	step 'login' 'this host is logged in, with the key in YEET_API_KEY'
else
	if [ -t 0 ]; then terminal=/dev/stdin
	elif (: </dev/tty) 2>/dev/null; then terminal=/dev/tty
	else die 'login' 'this host is not logged in to yeet' 'run `yeet login`, then this again; or set YEET_API_KEY'; fi
	doing 'login' 'this host is not logged in: running yeet login'
	"$YEET" login <"$terminal" || die 'login' 'yeet login did not finish' 'run `yeet login`, then this again'
	"$YEET" whoami --quiet >/dev/null 2>&1 || die 'login' 'still not logged in' 'run `yeet login`, then this again'
	step 'login' 'this host is logged in'
fi

# ---- pfw --------------------------------------------------------------------

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

# The package, unpacked under $work/pkg: bin/pfw and share/pfw, as the
# prefix will hold them.
unpack() {
	mkdir -p "$work/pkg"
	tar -xzf "$1" -C "$work/pkg" || die 'pfw' "$1 is not a pfw package" 'it is the tarball `make pkg` makes'
	[ -f "$work/pkg/bin/pfw" ] && [ -f "$work/pkg/share/pfw/service.toml" ] ||
		die 'pfw' "$1 is not a pfw package" 'it should hold bin/pfw and share/pfw'
}

fetch() {
	command -v curl >/dev/null 2>&1 || die 'pfw' 'curl is needed to download the package' 'install curl, or pass --package FILE'
	doing 'pfw' "downloading $1"
	curl -fsSL "$1" -o "$work/pfw.tar.gz" ||
		die 'pfw' "could not download $1" 'clone the repository and run ./install.sh in it, or pass --package FILE'
	unpack "$work/pfw.tar.gz"
}

if [ -n "$package" ]; then
	case $package in
	http://* | https://*) fetch "$package" ;;
	*)
		[ -f "$package" ] || die 'pfw' "no such package: $package"
		unpack "$package"
		;;
	esac
	step 'pfw' "package $package"
elif [ -n "$tree" ]; then
	need make 'building pfw takes make: install it, or pass --package'
	doing 'pfw' "building in $tree"
	make -C "$tree" --no-print-directory pkg >"$work/build.log" 2>&1 || {
		tail -n 20 "$work/build.log" >&2
		die 'pfw' 'the build failed' "run make in $tree to see it whole"
	}
	unpack "$tree/pkg/pfw.tar.gz"
	step 'pfw' "built from $tree"
else
	fetch "$RELEASE"
	step 'pfw' 'the latest release'
fi

# sudo only where the prefix is not ours to write.
as_owner=''
parent=$prefix
while [ ! -e "$parent" ]; do parent=$(dirname "$parent"); done
if [ ! -w "$parent" ]; then
	command -v sudo >/dev/null 2>&1 || die 'install' "$prefix is not yours to write, and there is no sudo" 'pass --prefix DIR for one that is'
	as_owner=sudo
fi

# The service's files are replaced whole, so one a release dropped is not left behind.
$as_owner mkdir -p "$prefix/bin" "$prefix/share"
$as_owner rm -rf "$prefix/share/pfw"
$as_owner cp -R "$work/pkg/share/pfw" "$prefix/share/pfw"
$as_owner cp "$work/pkg/bin/pfw" "$prefix/bin/pfw"
$as_owner chmod 0755 "$prefix/bin/pfw"
# Tab completion, where bash-completion and zsh each look under a prefix.
for completion in share/bash-completion/completions/pfw share/zsh/site-functions/_pfw; do
	[ -f "$work/pkg/$completion" ] || continue
	$as_owner mkdir -p "$prefix/$(dirname "$completion")"
	$as_owner cp "$work/pkg/$completion" "$prefix/$completion"
done
step 'install' "$prefix/bin/pfw, $prefix/share/pfw${as_owner:+ (with sudo)}"

case ":$PATH:" in
*":$prefix/bin:"*) ;;
*) caution 'PATH' "$prefix/bin is not on it: add it, or call $prefix/bin/pfw" ;;
esac

# ---- up ---------------------------------------------------------------------

pfw=$prefix/bin/pfw
printf '\n'
# Before the service exists: doctor is told so, and does not call its
# absence a fault.
PFW_BEFORE_UP=1 "$pfw" doctor || true
printf '\n'

if [ -z "$want_up" ]; then
	step 'done' "pfw is installed: \`pfw up\` starts the firewall"
	exit 0
fi

"$pfw" up || die 'up' 'the service did not come up' '`pfw doctor` says what is in the way'
printf '\n'
step 'done' 'the firewall is up, passing everything until a policy is applied'
printf '%*s%s\n' 14 '' "$(note 'next:  pfw setup   asks which interface and which policy, and blocks nothing')"
