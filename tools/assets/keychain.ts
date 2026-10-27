import { execFileSync } from 'node:child_process';

/** An API key from the system keychain (account "signal-fall"): the macOS keychain, or the Secret Service keyring on Linux. */
export function keychain(service: string): string {
  const cmd: [string, string[]] = process.platform === 'darwin'
    ? ['security', ['find-generic-password', '-s', service, '-a', 'signal-fall', '-w']]
    : ['secret-tool', ['lookup', 'service', service, 'account', 'signal-fall']];
  return execFileSync(...cmd).toString().trim();
}
