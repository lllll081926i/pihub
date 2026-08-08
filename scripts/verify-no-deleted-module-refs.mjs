/**
 * Verify no deleted coding-module references remain in tauri/src.
 *
 * Exit 0 when the tree is clean, exit 1 when any deleted module reference
 * is found. This is a shell-agnostic acceptance check (node only, no grep).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', 'tauri', 'src');

const DELETED_MODULE_REFS = [
  'coding::claude_code',
  'coding::codex',
  'coding::grok',
  'coding::gemini_cli',
  'coding::open_code',
  'coding::open_claw',
  'coding::oh_my_openagent',
  'coding::oh_my_opencode_slim',
  'coding::proxy_gateway',
  'coding::image',
  'coding::wsl',
  'coding::ssh',
  'coding::auth_refresh',
  'coding::cc_switch',
  'coding::deeplink',
];

const DELETED_TABLE_REFS = [
  'DbTable::ClaudeProvider',
  'DbTable::CodexProvider',
  'DbTable::GrokProvider',
  'DbTable::GeminiCliProvider',
  'DbTable::OpenCodeProvider',
  'DbTable::OpenClawCommonConfig',
  'DbTable::OhMyOpenAgent',
  'DbTable::OhMyOpenCodeSlim',
  'DbTable::WslSyncConfig',
  'DbTable::SshSyncConfig',
  'DbTable::ProxyGatewaySettings',
  'DbTable::ImageChannel',
];

function walk(dir, hits) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(p, hits);
    } else if (entry.name.endsWith('.rs')) {
      const content = fs.readFileSync(p, 'utf-8');
      for (const ref of DELETED_MODULE_REFS) {
        if (content.includes(ref)) hits.push(`${ref} in ${path.relative(root, p)}`);
      }
      for (const ref of DELETED_TABLE_REFS) {
        if (content.includes(ref)) hits.push(`${ref} in ${path.relative(root, p)}`);
      }
    }
  }
}

if (!fs.existsSync(root)) {
  console.error('tauri/src not found at', root);
  process.exit(1);
}

const hits = [];
walk(root, hits);

if (hits.length > 0) {
  console.error('FOUND deleted module references:');
  for (const hit of hits) console.error('  -', hit);
  process.exit(1);
}

console.log('CLEAN: no deleted coding-module references in tauri/src');
process.exit(0);
