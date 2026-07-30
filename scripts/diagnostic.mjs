import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = process.cwd();
const required = [
  'index.html','app.js','styles.css','creator-studio.js','cloud-sync.js',
  'cloud-sync-v2.js','supabase-client.js','password-auth.js',
  'persistence-guard.js','orbit-label-controls.js','media-quality.js',
  'cloud-sync.css','creator-studio.css','supabase/schema.sql',
  'vendor/supabase-js.umd.js','api/config.js','api/public-portal.js',
  'defaults/icons/thatsmelodic.png','defaults/icons/schmakinn.png','defaults/icons/2harmonic.png',
  'defaults/icons/core-static.webp'
];

const failures = [];
const notes = [];

for (const file of required) {
  if (!fs.existsSync(path.join(root, file))) failures.push(`Missing required file: ${file}`);
}

const jsFiles = fs.readdirSync(root).filter(name => name.endsWith('.js'));
const apiJsFiles = fs.existsSync(path.join(root, 'api'))
  ? fs.readdirSync(path.join(root, 'api')).filter(name => name.endsWith('.js')).map(name => path.join('api', name))
  : [];
for (const file of [...jsFiles, ...apiJsFiles]) {
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

const cloudModules = ['cloud-sync-v2.js', 'supabase-client.js', 'password-auth.js']
  .filter(file => fs.existsSync(path.join(root, file)));

if (cloudModules.length) {
  const cloud = cloudModules.map(file => fs.readFileSync(path.join(root, file), 'utf8')).join('\n');
  const requiredCloudChecks = [
    ['a single shared Supabase client', /export (?:async )?function getSupabaseClient/],
    ['PKCE auth flow', /flowType:\s*['"]pkce['"]/],
    ['session persistence', /persistSession:\s*true/],
    ['password sign-in', /signInWithPassword/],
    ['cloud settings upsert', /from\(['"]portal_settings['"]\)\.upsert/],
    ['cloud media upload', /storage\.from\((?:BUCKET|['"]harmonic-city-media['"])\)\.upload/],
    ['explicit local\\/cloud first-sync decision gate', /awaitingDecision/]
  ];
  for (const [label, pattern] of requiredCloudChecks) {
    if (!pattern.test(cloud)) failures.push(`Cloud diagnostic failed: missing ${label}`);
  }
  if (/esm\.sh|unpkg\.com|cdn\.jsdelivr\.net|cdn\.skypack\.dev/.test(cloud)) {
    failures.push('Cloud diagnostic failed: a runtime CDN import was reintroduced (the Supabase SDK must load from ./vendor/supabase-js.umd.js).');
  }
} else {
  failures.push('Cloud diagnostic failed: no cloud sync modules found (expected cloud-sync-v2.js, supabase-client.js, password-auth.js).');
}

if (fs.existsSync(path.join(root, 'api/public-portal.js'))) {
  const publicPortal = fs.readFileSync(path.join(root, 'api/public-portal.js'), 'utf8');
  if (!/SUPABASE_SERVICE_ROLE_KEY/.test(publicPortal)) {
    failures.push('api/public-portal.js diagnostic failed: does not reference SUPABASE_SERVICE_ROLE_KEY.');
  }
  const jsonResponses = [...publicPortal.matchAll(/res\.status\(\d+\)\.json\(\{([\s\S]*?)\}\);/g)];
  for (const [, body] of jsonResponses) {
    if (/serviceRoleKey|SUPABASE_SERVICE_ROLE_KEY/.test(body)) {
      failures.push('api/public-portal.js diagnostic failed: the service role key must never appear in a response body.');
    }
  }
}

if (fs.existsSync(path.join(root, 'app.js'))) {
  const appJs = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
  const requiredAppChecks = [
    ['a public default media fallback', /defaultMedia/],
    ['a live public-defaults fetch on boot', /fetch\(['"]\/api\/public-portal['"]/],
    ['a guard against overwriting real local edits', /hasRealLocalEdit/]
  ];
  for (const [label, pattern] of requiredAppChecks) {
    if (!pattern.test(appJs)) failures.push(`app.js diagnostic failed: missing ${label}`);
  }
}

if (fs.existsSync(path.join(root, 'supabase/schema.sql'))) {
  const sql = fs.readFileSync(path.join(root, 'supabase/schema.sql'), 'utf8');
  for (const table of ['portal_settings','portal_media','portal_versions']) {
    if (!sql.includes(`public.${table}`)) failures.push(`Supabase schema is missing ${table}`);
  }
  if (!/owner_id\s*=\s*(?:\(select\s+)?auth\.uid\(\)::text\)?/i.test(sql)) failures.push('Storage owner policy is missing the required UUID-to-text cast.');
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
