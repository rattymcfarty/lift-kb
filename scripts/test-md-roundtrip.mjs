#!/usr/bin/env node
/**
 * Round-trip guard for the Markdown source of truth.
 *
 *   node scripts/test-md-roundtrip.mjs
 *
 * Loads every original exercises/*.json and programs/*.json, parses the
 * matching content/*.md page, and asserts the parsed object is deep-equal to
 * the JSON — including key order, which the bundle hash depends on. Exits 1 and
 * reports every mismatch (with id and field path) otherwise.
 *
 * No dependencies beyond the Node standard library.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseExercise, parseProgram } from './lib/md-content.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const problems = [];

const typeName = (v) =>
  v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v;

// Deep equality that also requires identical key order at every level.
function compare(json, md, path, id) {
  if (Array.isArray(json) || Array.isArray(md)) {
    if (!Array.isArray(json) || !Array.isArray(md)) {
      problems.push(`${id}: ${path} is ${typeName(json)} in JSON but ${typeName(md)} in Markdown`);
      return;
    }
    if (json.length !== md.length) {
      problems.push(`${id}: ${path} has ${json.length} items in JSON but ${md.length} in Markdown`);
      return;
    }
    for (let i = 0; i < json.length; i++) compare(json[i], md[i], `${path}[${i}]`, id);
    return;
  }
  if (json && md && typeof json === 'object' && typeof md === 'object') {
    const jk = Object.keys(json);
    const mk = Object.keys(md);
    if (jk.join(',') !== mk.join(',')) {
      problems.push(
        `${id}: ${path} key order differs\n    JSON: ${jk.join(', ')}\n    MD:   ${mk.join(', ')}`,
      );
    }
    for (const k of jk) {
      if (Object.prototype.hasOwnProperty.call(md, k)) compare(json[k], md[k], `${path}.${k}`, id);
    }
    return;
  }
  if (json !== md) {
    problems.push(`${id}: ${path} = ${JSON.stringify(md)} in Markdown but ${JSON.stringify(json)} in JSON`);
  }
}

function check(kind, dir, parse) {
  const files = readdirSync(join(root, dir))
    .filter((f) => f.endsWith('.json'))
    .sort();
  for (const file of files) {
    const id = file.replace(/\.json$/, '');
    const json = JSON.parse(readFileSync(join(root, dir, file), 'utf8'));
    const mdPath = join(root, 'content', dir, `${id}.md`);
    let md;
    try {
      md = parse(readFileSync(mdPath, 'utf8'));
    } catch (err) {
      problems.push(`${id}: failed to parse ${kind} Markdown — ${err.message}`);
      continue;
    }
    compare(json, md, '$', id);
  }
  return files.length;
}

const exercises = check('exercise', 'exercises', parseExercise);
const programs = check('program', 'programs', parseProgram);

if (problems.length) {
  console.error(`round-trip FAILED — ${problems.length} problem(s):`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}

console.log(
  `round-trip OK — ${exercises} exercises and ${programs} programs match their JSON exactly`,
);
