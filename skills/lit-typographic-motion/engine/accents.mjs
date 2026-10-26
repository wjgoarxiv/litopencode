// The accents a beat's `sound` field asks for; the generated bed and the score both read them.
export function accentsFor(beat) {
  const text = String(beat.sound ?? "").toLowerCase();
  return { hit: /\bhits?\b|\bimpact\b|\bboom\b|\bstab\b/u.test(text), rise: /\brise\b|\briser\b|\bswell\b|\bbuild\b/u.test(text), cadence: /\bcadence\b|\bresolve\b|\bfinal chord\b/u.test(text), thin: /\bthin(?:s|ned)?\b|\bsparse\b|\bpared back\b/u.test(text) };
}

