export function withMarkTerminal(callback, { color = true } = {}) {
  const keys = ["NO_COLOR", "CI", "LANG", "LC_ALL", "LC_CTYPE", "TERM", "COLORTERM"];
  const prior = new Map(keys.map((key) => [key, process.env[key]]));
  const tty = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
  try {
    for (const key of keys) delete process.env[key];
    Object.assign(process.env, { LANG: "en_US.UTF-8", TERM: "xterm-256color", COLORTERM: "truecolor" });
    if (!color) process.env.NO_COLOR = "1";
    Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
    return callback();
  } finally {
    for (const [key, value] of prior) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    if (tty === undefined) delete process.stdout.isTTY;
    else Object.defineProperty(process.stdout, "isTTY", tty);
  }
}
