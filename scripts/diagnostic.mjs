import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = process.cwd();
const required = [
  'index.html','app.js','styles.css','creator-studio.js','cloud-sync.js',
  'persistence-guard.js','orbit-label-controls.js','media-quality.js',
  'cloud-sync.css','creator-studio.css','supabase/schema.sql'
];

const failures = [];
const notes = [];

for (const file of required) {
  if (!fs.existsSync(path.join(root, file))) failures.push(`Missing required file: ${file}`);
}

const jsFiles = fs.readdirSync(root).filter(name => name.endsWith('.js'));
for (const file of jsFiles) {
  try {
    execFileSync(process.execPath, ['--check', path.join(root, file)], { stdio: 'pipe' });
  } catch (error) {
    failures.push(`JavaScript syntax error in ${file}: ${error.stderr?.toString().trim() || error.message}`);
  }
}

if (fs.existsSync(path.join(root, 'index.html'))) {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const refs = [...html.matchAll(/(?:src|href)=["']\.\/?([^"'#?]+)["']/g)].map(match => match[1]);
  for (const ref of refs) {
    if (/^(https?:|data:)/.test(ref)) continue;
    if (!fs.existsSync(path.join(root, ref))) failures.push(`index.html references missing asset: ${ref}`);
  }
  for (const id of ['cloudToggle','cloudModal','cloudSendLink','cloudSyncNow','studioToggle','customizer','profileTemplate']) {
    if (!html.includes(`id="${id}"`)) failures.push(`index.html is missing required element #${id}`);
  }
}

if (fs.existsSync(path.join(root, 'cloud-sync.js'))) {
  const cloud = fs.readFileSync(path.join(root, 'cloud-sync.js'), 'utf8');
  const requiredCloudChecks = [
    ['auth callback handler', 'consumeAuthCallback'],
    ['expired-link query handling', 'error_description'],
    ['session persistence', 'persistSession:true'],
    ['manual token session', 'setSession'],
    ['PKCE callback support', 'exchangeCodeForSession'],
    ['cloud settings upsert', "from('portal_settings').upsert"],
    ['cloud media upload', "storage.from('harmonic-city-media').upload"],
    ['cooldown capped at 60 seconds', 'MAX_COOLDOWN_SECONDS=60']
  ];
  for (const [label, needle] of requiredCloudChecks) {
    if (!cloud.includes(needle)) failures.push(`Cloud diagnostic failed: missing ${label}`);
  }
  if (/startCooldown\(\);\s*setStatus\(error\?/.test(cloud)) failures.push('Cloud cooldown starts before checking the OTP error response.');
}

if (fs.existsSync(path.join(root, 'supabase/schema.sql'))) {
  const sql = fs.readFileSync(path.join(root, 'supabase/schema.sql'), 'utf8');
  for (const table of ['portal_settings','portal_media','portal_versions']) {
    if (!sql.includes(`public.${table}`)) failures.push(`Supabase schema is missing ${table}`);
  }
  if (!sql.includes("owner_id = auth.uid()::text")) failures.push('Storage owner policy is missing the required UUID-to-text cast.');
  if (!sql.includes("harmonic-city-media")) failures.push('Supabase media bucket configuration is missing.');
}

notes.push('Static diagnostics cannot send a real magic-link email or verify a private authenticated Supabase session.');
notes.push('Cross-device verification still requires one successful sign-in followed by a test on a second browser or device.');

if (failures.length) {
  console.error('\nHarmonic City diagnostics FAILED\n');
  failures.forEach(item => console.error(`- ${item}`));
  notes.forEach(item => console.error(`Note: ${item}`));
  process.exit(1);
}

console.log('\nHarmonic City diagnostics PASSED\n');
console.log(`Checked ${jsFiles.length} JavaScript files and ${required.length} required project files.`);
notes.forEach(item => console.log(`Note: ${item}`));
