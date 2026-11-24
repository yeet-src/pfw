# bash completion for pfw. `pfw __complete` knows what can stand where; this
# hands it the line and takes what it offers.
_pfw() {
	local line=${COMP_LINE:0:COMP_POINT} cur words
	cur=${line##*[[:space:]]}
	read -ra words <<<"$line"
	[ -n "$cur" ] || words+=('')

	if [ "${#words[@]}" -ge 3 ] && [ "${words[${#words[@]} - 2]}" = -f ]; then
		COMPREPLY=($(compgen -f -- "$cur"))
		return
	fi

	local IFS=$'\n'
	COMPREPLY=($(compgen -W "$("${words[0]}" __complete "${words[@]:1}" 2>/dev/null)" -- "$cur"))

	# bash breaks a word at a colon, and a policy's name has one: offer only
	# what follows the last colon typed.
	if [[ $cur == *:* && $COMP_WORDBREAKS == *:* ]]; then
		local head=${cur%"${cur##*:}"}
		COMPREPLY=("${COMPREPLY[@]#"$head"}")
	fi
}
complete -F _pfw pfw
