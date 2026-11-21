/**
 * readline.pause() stops reads but leaves raw mode enabled. On Windows that
 * disables ENABLE_PROCESSED_INPUT, so Ctrl+C becomes an unread byte instead
 * of a console signal while the child owns stdin.
 */
export function suspendReadline(rl, input = process.stdin) {
  const wasRaw = Boolean(input.isRaw);
  rl?.pause();
  if (wasRaw) input.setRawMode(false);

  let restored = false;
  return () => {
    if (restored) return;
    restored = true;
    if (wasRaw) input.setRawMode(true);
    rl?.resume();
  };
}

/** A child can receive the console event before its parent does. */
export function isInterruptExit(code, signal) {
  return signal === 'SIGINT' || signal === 'SIGBREAK' || code === 130 ||
    (Number.isInteger(code) && (code >>> 0) === 0xc000013a);
}
