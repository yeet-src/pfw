/* What the service was started with, from `yeet.args` (minimist-parsed).
 *
 *   --iface <name|ifindex>[,...]   interfaces to attach to until `pfw attach` says otherwise (default: lo)
 *   --object <path>                vm.bpf.o to load (default: bin/ beside the bundle)
 *   --state-file <path>            where the interfaces and policy are saved (default: /var/lib/pfw/state.js)
 */
const list = (v) => String(v).split(",").map((s) => s.trim()).filter(Boolean);

// `dir` is where the entry module lives: dist/ once bundled, with the VM
// object copied to dist/bin/ beside it.
export function config(args, dir) {
  return {
    ifaces: list(args?.iface ?? "lo"),
    object: args?.object ? String(args.object) : `${dir}/bin/vm.bpf.o`,
    base: dir,
    // yeet spells a flag's hyphens as underscores.
    stateFile: String(args?.state_file ?? "/var/lib/pfw/state.js"),
  };
}
