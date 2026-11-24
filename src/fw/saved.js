/* What the firewall is set to, across restarts: the interfaces it is
 * attached to, the policy it enforces and the knobs set per policy. An isolate has no storage, so the
 * state is kept as a JavaScript module on the host: `pfwctl` writes the
 * module this service hands it, and the next start imports it back.
 */
import { Policy } from "#/fw/policy.js";

export class SavedState {
  constructor(path) {
    this.path = path;
  }

  // The module to save for the firewall as it now stands.
  moduleOf(firewall) {
    const policy = firewall.policy;
    return `export default ${JSON.stringify({
      interfaces: firewall.interfaces.map((i) => i.name),
      policy: policy ? { name: policy.name, source: policy.source } : null,
      knobs: firewall.knobs,
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
  // firewall still comes up, and `pfwctl status` shows it enforcing nothing.
  async restorePolicy(firewall, saved) {
    if (!saved?.policy) return;
    try {
      await firewall.enforce(new Policy(saved.policy.name, saved.policy.source));
      console.log(`pfw: restored ${saved.policy.name}`);
    } catch (error) {
      console.log(`pfw: saved policy ${saved.policy.name} was not restored: ${error?.message ?? error}`);
    }
  }
}
