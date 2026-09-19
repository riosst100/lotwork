// Maps known dev-server commands to the flag they need so they actually bind to the
// project's configured port, since most non-Node tools ignore the PORT env var.
const RULES = [
  { test: /\bphp\s+artisan\s+serve\b/, hasFlag: /--port(=|\s)/, append: (port) => `--port=${port}` },
  { test: /\bmanage\.py\s+runserver\b/, hasFlag: /\d+\.\d+\.\d+\.\d+:\d+|(?<!\S)\d{2,5}(?!\S)/, append: (port) => `0.0.0.0:${port}` },
  { test: /\bflask\s+run\b/, hasFlag: /--port(=|\s)/, append: (port) => `--port=${port}` },
  { test: /\bphp\s+-S\s/, hasFlag: /:\d+/, append: null }, // `php -S host:port` already encodes the port; skip auto-append
  { test: /\bserve\b/, hasFlag: /-p\s|--port(=|\s)/, append: (port) => `-p ${port}` },
];

function withPortFlag(command, port) {
  for (const rule of RULES) {
    if (rule.test.test(command)) {
      if (rule.hasFlag.test(command)) return command; // user already specified a port explicitly
      if (!rule.append) return command;
      return `${command} ${rule.append(port)}`;
    }
  }
  return command; // Node/Vite/etc read PORT from env already
}

module.exports = { withPortFlag };
