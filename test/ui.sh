#!/bin/sh
# The metrics app, driven without a screen: it is opened in a tmux pane with
# `pfw metrics`, keys and a click are sent to it, and what the pane shows is
# read back.
#
#   sh test/ui.sh
#
# The firewall has to be up. Nothing about it is changed.
set -eu

command -v tmux >/dev/null 2>&1 || { echo "test/ui.sh needs tmux" >&2; exit 2; }

SESSION=pfw-ui-test
fail() {
	printf 'FAIL  %s\n' "$*" >&2
	tmux capture-pane -t "$SESSION" -p >&2 2>/dev/null || true
	tmux kill-session -t "$SESSION" 2>/dev/null || true
	exit 1
}
pass() { printf 'ok    %s\n' "$*"; }

# The app keeps its spaces with non-breaking ones, so a pattern's `.` stands
# for either kind.
shows() { tmux capture-pane -t "$SESSION" -p | grep -q -- "$1"; }

# What the pane must show within a few seconds, the app redrawing each one.
wait_for() {
	tries=0
	until shows "$1"; do
		tries=$((tries + 1))
		[ "$tries" -lt 20 ] || fail "$2"
		sleep 0.5
	done
	pass "$2"
}

key() { tmux send-keys -t "$SESSION" "$1"; }
# A left click, as a terminal reports one: column, then row, from 1.
click() { tmux send-keys -t "$SESSION" -l "$(printf '\033[<0;%d;%dM\033[<0;%d;%dm' "$1" "$2" "$1" "$2")"; }

tmux kill-session -t "$SESSION" 2>/dev/null || true
tmux new-session -d -s "$SESSION" -x 120 -y 36 "TERM=xterm-256color pfw metrics"

wait_for '1.overview' 'the app opens, with its tabs'
wait_for '─.traffic.' 'overview: the traffic graph'
wait_for '─.speed.' 'overview: speeds'
wait_for '─.decision.time.' 'overview: decision time'
wait_for '─.engine.' 'overview: the counters'

key 2
wait_for '─.verdicts.' 'key 2: the rules page'
key 3
wait_for '─.in.numbers.' 'key 3: the timing page'
key 4
wait_for 'every.counter.the.VM.keeps' 'key 4: the engine page'

# The first tab's name starts in the second column of the second row.
click 4 2
wait_for '─.traffic.' 'a click on the first tab: back to the overview'
key Tab
wait_for '─.verdicts.' 'tab: the next page'

key q
tries=0
while tmux has-session -t "$SESSION" 2>/dev/null; do
	tries=$((tries + 1))
	[ "$tries" -lt 20 ] || fail 'q does not leave the app'
	sleep 0.5
done
pass 'q leaves'
