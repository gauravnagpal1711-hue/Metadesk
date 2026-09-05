// Re-applies patches/*.patch after every `npm install`. Baileys is an optional
// dependency (server still boots without it), so only patch it when present —
// patch-package errors out on a missing target package, which would otherwise
// fail the whole install.
import { existsSync } from 'node:fs';
import { execSync } from 'node:child_process';

if (existsSync(new URL('../node_modules/@whiskeysockets/baileys', import.meta.url))) {
  execSync('npx patch-package', { stdio: 'inherit' });
}
