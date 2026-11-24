/* What the firewall is set to, across restarts: the interfaces it is
 * attached to, the policy it enforces, the knobs set per policy and whether it is in shadow
 * mode. An isolate has no storage, so the
 * state is kept as a JavaScript module on the host: the `pfw` command writes the
 * module this service hands it, and the next start imports it back.
 */
import { Policy } from "#/fw/policy.js";

export class SavedState {
  constructor(path) {
    this.path = path;
  }

  // The module to save for the firewall as it now stands.
  moduleOf(firewall) {
    const { policy, shadow } = firewall.settled;
    const kept = (p) => (p ? { name: p.name, source: p.source } : null);
    return `export default ${JSON.stringify({
      interfaces: firewall.interfaces.map((i) => i.name),
      policy: kept(policy),
      previous: kept(firewall.previous),
      knobs: firewall.knobs,
      shadow,
    })};\n`;
  }

  // What was saved, or null when nothing was or it cannot be read.
  async read() {
    try {
      return (await import(this.path)).default ?? null;
    } catch (error) {
      const message = error?.message ?? String(error);
      if (!message.includes("Module not found")) console.log(`pfw: saved state ${this.path} was not read: ${message}`);
      return null;
    }
  }

  // A saved policy that will not load is reported and left out: the
  // firewall still comes up, and `pfw status` shows it enforcing nothing.
  async restorePolicy(firewall, saved) {
    // Remembered after the policy is enforced, which would overwrite it.
    const previous = this.#compiled(saved?.previous);
    await this.#enforceSaved(firewall, saved);
    if (previous) firewall.remember(previous);
  }

  #compiled(kept) {
    try {
      return kept ? new Policy(kept.name, kept.source) : null;
    } catch {
      return null;
    }
  }

  async #enforceSaved(firewall, saved) {
    if (!saved?.policy) return;
    try {
      await firewall.enforce(new Policy(saved.policy.name, saved.policy.source));
      console.log(`pfw: restored ${saved.policy.name}`);
    } catch (error) {
      console.log(`pfw: saved policy ${saved.policy.name} was not restored: ${error?.message ?? error}`);
    }
  }
}
