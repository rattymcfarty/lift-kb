#!/usr/bin/env node
/**
 * Builds dist/kb-bundle-<version>.json from exercises/ + programs/.
 *
 *   node scripts/build-bundle.mjs [--write-channel]
 *
 * --write-channel also fills latest/schemaVersion/sha256 in channel.json.
 * Bundles are published as GitHub Release assets (+ Pages mirror); dist/ is git-ignored.
 *
 * Hash contract: sha256 covers the canonical bundle content WITHOUT
 * generatedAt, so it is reproducible. CI rebuilds and fails if
 * --write-channel would change channel.json (i.e. the committed hash must
 * always match a fresh build).
 */
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { version, schemaVersion } = JSON.parse(
  readFileSync(join(root, 'kb-version.json'), 'utf8'),
);

const loadDir = (dir) =>
  readdirSync(join(root, dir))
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => JSON.parse(readFileSync(join(root, dir, f), 'utf8')));

const exercises = loadDir('exercises');
const programs = loadDir('programs');

// ID permanence guard: filename must match the declared id.
for (const [dir, items] of [['exercises', exercises], ['programs', programs]]) {
  const files = readdirSync(join(root, dir)).filter((f) => f.endsWith('.json')).sort();
  items.forEach((item, i) => {
    const expected = files[i].replace(/\.json$/, '');
    if (item.id !== expected) {
      console.error(`ID MISMATCH: ${dir}/${files[i]} declares id "${item.id}"`);
      process.exit(1);
    }
  });
}

// Canonical content for hashing: EXCLUDES generatedAt so the hash is
// reproducible (same input -> same hash, regardless of build time).
// Verification contract (app + CI): parse the bundle, delete `generatedAt`,
// JSON.stringify the remainder with these exact keys in this order
// (bundleVersion, schemaVersion, exercises, programs), sha256 the bytes,
// compare to channel.json sha256.
const content = {
  bundleVersion: version,
  schemaVersion,
  exercises,
  programs,
};
const canonical = JSON.stringify(content);
const sha256 = createHash('sha256').update(canonical).digest('hex');

const bundle = { ...content, generatedAt: new Date().toISOString() };

mkdirSync(join(root, 'dist'), { recursive: true });
const outPath = join(root, 'dist', `kb-bundle-${version}.json`);
writeFileSync(outPath, JSON.stringify(bundle));
writeFileSync(`${outPath}.sha256`, `${sha256}  kb-bundle-${version}.json\n`);

console.log(
  `wrote ${outPath} (${exercises.length} exercises, ${programs.length} programs)`,
);
console.log(`sha256: ${sha256}`);

if (process.argv.includes('--write-channel')) {
  const channelPath = join(root, 'channel.json');
  const channel = JSON.parse(readFileSync(channelPath, 'utf8'));
  channel.latest = version;
  channel.schemaVersion = schemaVersion;
  channel.sha256 = sha256;
  writeFileSync(channelPath, `${JSON.stringify(channel, null, 2)}\n`);
  console.log('channel.json updated');
}
