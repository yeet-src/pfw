#!/bin/sh
# The pfw command, where it needs no firewall: its help, its settings, its
# remotes, pulling, naming a policy, the options it refuses, and what it
# offers the shell to complete. Settings, cache and remotes are a temporary
# directory's, the remote is a git repository made here, and the service
# address is one nothing listens on, so no firewall is asked or changed.
#
#   sh test/cli.sh
set -eu

here=$(cd "$(dirname "$0")/.." && pwd)
root=$(mktemp -d)
trap 'rm -rf "$root"' EXIT

export PFW_CONFIG="$root/config/config"
export PFW_CACHE="$root/cache"
export PFW_URL=ws://127.0.0.1:1/ctl
export PFW_SERVICE=pfw-cli-test
export NO_COLOR=1
pfw() { "$here/bin/pfw" "$@"; }

failures=0
pass() { printf 'ok    %s\n' "$1"; }
fail() {
	printf 'FAIL  %s\n' "$1"
	[ -z "${2:-}" ] || printf '      got: %s\n' "$2"
	failures=$((failures + 1))
}
# has NAME TEXT WANTED: TEXT holds WANTED.
has() {
	case $2 in *"$3"*) pass "$1" ;; *) fail "$1" "$2" ;; esac
}
lacks() {
	case $2 in *"$3"*) fail "$1" "$2" ;; *) pass "$1" ;; esac
}
# One a line, as one space-separated line.
flat() { tr '\n' ' ' | sed 's/ $//'; }
# refuses NAME WANTED COMMAND...: the command fails, saying WANTED.
refuses() {
	label=$1 wanted=$2
	shift 2
	if said=$("$@" 2>&1); then fail "$label (it did not fail)" "$said"; else has "$label" "$said" "$wanted"; fi
}

# ---- a remote to pull from --------------------------------------------------

repo=$root/repo
mkdir -p "$repo/http" "$repo/baseline"
cat >"$repo/http/web.pfc" <<'PFC'
// @description Guards a web port.
// @knob port  The port to guard.
filter {
  if (dport != knob("port") ?? 80) decide pass;
  if (kstr("bad_host")) decide drop("blocked_host");
  decide pass;
}
PFC
printf 'filter { decide pass; }\n' >"$repo/baseline/pass.pfc"
git -C "$repo" init --quiet
git -C "$repo" add .
git -C "$repo" -c user.name=test -c user.email=test@example.com commit --quiet -m policies

# ---- help and version -------------------------------------------------------

said=$(pfw help)
for word in 'pfw setup' 'pfw confirm' 'pfw rollback' 'pfw logs' 'pfw upgrade' 'pfw uninstall' '--confirm [TIME]'; do
	has "help lists $word" "$said" "$word"
done
has 'the version of a build of one'"'"'s own is dev' "$(pfw --version)" 'pfw dev'

# ---- settings ---------------------------------------------------------------

pfw config set service other >/dev/null 2>&1
has 'a setting that was set is read back' "$(PFW_SERVICE='' pfw config get service)" 'other'
has 'the environment wins over the file' "$(pfw config get service)" 'pfw-cli-test'
pfw config unset service >/dev/null
has 'an unset setting is its default' "$(PFW_SERVICE='' pfw config get service)" 'pfw'
refuses 'an unknown setting is refused' 'which setting?' pfw config get nope

# ---- remotes and pulling ----------------------------------------------------

has 'the public rules are there to begin with' "$(pfw remote ls 2>&1)" 'https://github.com/yeet-src/pfw-rules.git'
pfw remote rm rules >/dev/null
pfw remote add local "$repo" >/dev/null
has 'a remote that was added is listed, not pulled' "$(pfw remote ls)" 'not pulled'
refuses 'a remote is not added twice' 'already a remote named local' pfw remote add local "$repo"
refuses 'a remote'"'"'s name is plain' 'letters, digits' pfw remote add 'a b' "$repo"
has 'pull clones it and counts its policies' "$(pfw pull)" '2 policies'
has 'pull again finds nothing new' "$(pfw pull)" 'up to date'
has 'pull says where to go next' "$(pfw pull)" 'pfw apply NUMBER'
refuses 'pull of an unknown remote is refused' 'no such remote' pfw pull nope

# ---- naming a policy --------------------------------------------------------

said=$(pfw ls 2>&1) || true
has 'ls without a service says so' "$said" 'not reachable'
has 'ls without a service still numbers the policies' "$said" '2 local:http/web.pfc'
refuses 'a number past the list is refused' 'no policy numbered 9' pfw apply 9
refuses 'a policy that is not there is refused' 'no such policy: local:nope.pfc' pfw apply local:nope.pfc
refuses 'a remote that is not there is refused' 'no such remote: nope' pfw apply nope:http/web.pfc
refuses 'a file that is not there is refused' 'no such file' pfw apply -f "$root/nope.pfc"
refuses 'apply reaches for the service last' 'not reachable' pfw apply local:http/web.pfc
refuses 'apply on trial names the policy the same way' 'not reachable' pfw apply --confirm 5m 2
refuses 'a time may come before the policy or after it' 'not reachable' pfw apply 2 --confirm

# ---- options that are refused -----------------------------------------------

refuses '--confirm is for apply and unshadow' '--confirm goes with apply and unshadow' pfw status --confirm
refuses '--confirm is not for clear' '--confirm goes with apply and unshadow' pfw clear --confirm 10m
refuses 'confirm takes no argument' 'pfw confirm' pfw confirm now
refuses 'setup has no --json' 'no --json' pfw --json setup
refuses 'setup refuses an option it does not know' 'pfw setup takes' pfw setup --nope
refuses 'upgrade from the source tree is refused' 'runs from its source tree' pfw upgrade
refuses 'uninstall from the source tree is refused' 'runs from its source tree' pfw uninstall --yes
refuses 'upgrade refuses an option it does not know' 'pfw upgrade takes' pfw upgrade --nope
[ -d "$PFW_CACHE" ] && pass 'a refused uninstall removed nothing' || fail 'a refused uninstall removed the cache'

# ---- completion -------------------------------------------------------------

offers() { pfw __complete "$@" | flat; }

said=$(offers '')
for word in setup confirm rollback apply knob --json; do has "the commands offered include $word" " $said " " $word "; done
has 'global options are stepped over' " $(offers --json '') " ' status '
has 'apply offers the policies and its options' "$(offers apply '')" 'local:baseline/pass.pfc local:http/web.pfc --confirm -f'
has 'apply --confirm offers times, then the policies' "$(offers apply --confirm '')" '5m 10m 30m 1h local:baseline/pass.pfc'
has 'apply -f offers nothing: the shell completes a file' "[$(offers apply -f '')]" '[]'
has 'unshadow offers --confirm' "$(offers unshadow '')" '--confirm'
has 'unshadow --confirm offers times' "$(offers unshadow --confirm '')" '5m 10m 30m 1h'
has 'pull offers the remotes' "$(offers pull '')" 'local'
has 'ls offers the remotes and its filters' "$(offers ls '')" 'local --tag --severity --check'
has 'ls --severity offers the levels' "$(offers ls --severity '')" 'critical high medium low'
has 'remote offers its commands' "$(offers remote '')" 'add ls rm'
has 'remote rm offers the remotes' "$(offers remote rm '')" 'local'
has 'knob offers its commands' "$(offers knob '')" 'ls set unset'
has 'knob set offers the policies' "$(offers knob set '')" 'local:http/web.pfc'
has 'knob set POLICY offers that policy'"'"'s knobs' "$(offers knob set local:http/web.pfc '')" 'bad_host port'
has 'knob unset by number offers the same' "$(offers knob unset 2 '')" 'bad_host port'
has 'a policy with no knobs offers none' "[$(offers knob set local:baseline/pass.pfc '')]" '[]'
has 'config offers its commands' "$(offers config '')" 'ls get set unset'
has 'config set offers the settings' "$(offers config set '')" 'url service source cache yeet'
has 'setup offers its options' "$(offers setup '')" '--iface --policy --knob --yes'
has 'setup --policy offers the policies' "$(offers setup --policy '')" 'local:http/web.pfc'
has 'uninstall offers its options' "$(offers uninstall '')" '--yes --purge'
has 'a command with nothing to offer offers nothing' "[$(offers status '')]" '[]'
if [ -d /sys/class/net ]; then has 'attach offers the interfaces' " $(offers attach '') " ' lo '; fi

# The shells' own halves. bash is driven as it drives a completion: the line
# and the cursor in, COMPREPLY out.
if command -v bash >/dev/null 2>&1; then
	completes() {
		PATH="$here/bin:$PATH" bash -c '
			source "$1"
			COMP_LINE=$2 COMP_POINT=${#2}
			_pfw
			printf "%s\n" "${COMPREPLY[@]}"
		' bash "$here/completions/pfw.bash" "$1" | flat
	}
	has 'bash: a command is completed' "$(completes 'pfw roll')" 'rollback'
	has 'bash: only what matches is offered' "$(completes 'pfw un')" 'uninstall unshadow'
	has 'bash: after a space, the next word' "$(completes 'pfw knob ')" 'ls set unset'
	has 'bash: a policy is completed' "$(completes 'pfw apply lo')" 'local:baseline/pass.pfc local:http/web.pfc'
	has 'bash: past its colon, only what follows the colon' "$(completes 'pfw apply local:ht')" 'http/web.pfc'
	lacks 'bash: past its colon, the remote is not repeated' "$(completes 'pfw apply local:ht')" 'local:'
	has 'bash: -f completes a file' "$(completes "pfw apply -f $repo/http/we")" "$repo/http/web.pfc"
else
	printf 'skip  bash is not installed\n'
fi
if command -v zsh >/dev/null 2>&1; then
	if zsh -n "$here/completions/_pfw"; then pass 'zsh: the completion parses'; else fail 'zsh: the completion does not parse'; fi
else
	printf 'skip  zsh is not installed\n'
fi

printf '\n'
[ "$failures" -eq 0 ] || {
	printf '%s failed\n' "$failures"
	exit 1
}
printf 'the pfw command works without a firewall\n'
