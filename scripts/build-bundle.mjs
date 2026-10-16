#!/usr/bin/env node
/**
 * Builds dist/kb-bundle-<version>.json from content/ Markdown.
 *
 *   node scripts/build-bundle.mjs [--write-channel]
 *
 * Each content/<dir>/<id>.md page is parsed back into the exercise/program
 * object by scripts/lib/md-content.mjs; the Markdown is the source of truth.
 * --write-channel also fills latest/schemaVersion/sha256 in channel.json.
 * Bundles are published as GitHub Release assets; dist/ is git-ignored.
 */
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseExercise, parseProgram } from './lib/md-content.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { version, schemaVersion } = JSON.parse(
  readFileSync(join(root, 'kb-version.json'), 'utf8'),
);

const loadContent = (dir, parse) => {
  const names = readdirSync(join(root, 'content', dir))
    .filter((f) => f.endsWith('.md'))
    .sort();
  return names.map((name) => ({
    name,
    item: parse(readFileSync(join(root, 'content', dir, name), 'utf8')),
  }));
};

const exerciseEntries = loadContent('exercises', parseExercise);
const programEntries = loadContent('programs', parseProgram);

// ID permanence guard: filename must match the declared id.
for (const [dir, entries] of [
  ['exercises', exerciseEntries],
  ['programs', programEntries],
]) {
  for (const { name, item } of entries) {
    const expected = name.replace(/\.md$/, '');
    if (item.id !== expected) {
      console.error(`ID MISMATCH: ${dir}/${name} declares id "${item.id}"`);
      process.exit(1);
    }
  }
}

const exercises = exerciseEntries.map((e) => e.item);
const programs = programEntries.map((p) => p.item);

const bundle = {
  bundleVersion: version,
  schemaVersion,
  generatedAt: new Date().toISOString(),
  exercises,
  programs,
};

mkdirSync(join(root, 'dist'), { recursive: true });
const outPath = join(root, 'dist', `kb-bundle-${version}.json`);
const json = JSON.stringify(bundle);
writeFileSync(outPath, json);

const sha256 = createHash('sha256')
  .update(
    // Canonical form: generatedAt is EXCLUDED from the hash contract.
    // The app verifies with canonicalBundleJson() (src/kb/bundle.ts), which
    // covers exactly these four fields. Hashing the raw file (with
    // generatedAt) made every channel sha fail verification on fetch.
    JSON.stringify({
      bundleVersion: bundle.bundleVersion,
      schemaVersion: bundle.schemaVersion,
      exercises: bundle.exercises,
      programs: bundle.programs,
    }),
  )
  .digest('hex');
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
