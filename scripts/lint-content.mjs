#!/usr/bin/env node
/**
 * Content lint for lift-kb, dependency-free.
 *
 *   node scripts/lint-content.mjs
 *
 * Exits 1 and prints `<id>: <problem>` for every page that:
 *   - fails scripts/validate-content.mjs (schema validation), or cannot parse;
 *   - has an `overview` longer than 400 characters without a `### ` subheading;
 *   - contains a raw HTML tag anywhere in its values;
 *   - has a Markdown list line longer than 400 characters in a rich prose
 *     field (overview / longevityNotes / safetyNotes / goal);
 *   - has fewer than 2 instruction steps.
 *
 * The 400-character list rule is scoped to the rich prose fields: those are
 * the free-form Markdown being extended here, whereas the legacy instruction
 * steps come from the public-domain Free Exercise DB and are edited elsewhere.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseExercise, parseProgram } from './lib/md-content.mjs';
import { loadSchema, validate } from './validate-content.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const RICH_FIELDS = {
  exercises: ['overview', 'longevityNotes', 'safetyNotes'],
  programs: ['goal'],
};

const RAW_HTML = /<[a-zA-Z!/][^>]*>/;
const LIST_LINE = /^\s*(?:[-*+]|\d+\.)\s/;
const SUBHEADING = /^### /m;
const MAX_LIST_LINE = 400;

function stripPath(error, dir, file) {
  const rel = `${dir}/${file}`;
  if (error.startsWith(`${rel}.`)) return error.slice(rel.length + 1);
  if (error.startsWith(`${rel}: `)) return error.slice(rel.length + 2);
  return error;
}

/** Visit every string in a parsed page, with its dotted path. */
function walkStrings(value, path, visit) {
  if (typeof value === 'string') {
    visit(value, path || '(root)');
  } else if (Array.isArray(value)) {
    value.forEach((v, i) => walkStrings(v, `${path}[${i}]`, visit));
  } else if (value !== null && typeof value === 'object') {
    for (const [key, v] of Object.entries(value)) {
      walkStrings(v, path ? `${path}.${key}` : key, visit);
    }
  }
}

export function lintPage(kind, dir, file, item, schema, problems) {
  const id = file.replace(/\.md$/, '');
  const push = (problem) => problems.push(`${id}: ${problem}`);

  // 1. schema validation (same contract as validate-content.mjs)
  const errors = [];
  validate(item, schema, `${dir}/${file}`, errors);
  for (const error of errors) push(stripPath(error, dir, file));

  // 2. rich prose fields
  for (const field of RICH_FIELDS[kind]) {
    const value = item[field];
    if (typeof value !== 'string') continue;

    if (field === 'overview' && value.length > 400 && !SUBHEADING.test(value)) {
      push(`overview is ${value.length} characters but has no \`### \` subheading`);
    }

    for (const line of value.split('\n')) {
      if (LIST_LINE.test(line) && line.length > MAX_LIST_LINE) {
        push(`${field} has a list line of ${line.length} characters (max ${MAX_LIST_LINE})`);
      }
    }
  }

  // 3. raw HTML anywhere in the page values
  walkStrings(item, '', (str, path) => {
    const m = RAW_HTML.exec(str);
    if (m) push(`${path} contains raw HTML tag "${m[0]}"`);
  });

  // 4. instruction count
  if (kind === 'exercises' && (!Array.isArray(item.instructions) || item.instructions.length < 2)) {
    const n = Array.isArray(item.instructions) ? item.instructions.length : 0;
    push(`needs at least 2 instruction steps, has ${n}`);
  }
}

function lintDir(kind, dir, schemaFile, parse) {
  const schema = loadSchema(schemaFile);
  const files = readdirSync(join(root, 'content', dir))
    .filter((f) => f.endsWith('.md'))
    .sort();
  const problems = [];
  for (const file of files) {
    let item;
    try {
      item = parse(readFileSync(join(root, 'content', dir, file), 'utf8'));
    } catch (err) {
      problems.push(`${file.replace(/\.md$/, '')}: cannot parse page: ${err.message}`);
      continue;
    }
    lintPage(kind, dir, file, item, schema, problems);
  }
  return { count: files.length, problems };
}

function run() {
  const results = [
    lintDir('exercises', 'exercises', 'exercise.schema.json', parseExercise),
    lintDir('programs', 'programs', 'program.schema.json', parseProgram),
  ];

  const problems = results.flatMap((r) => r.problems);
  const pages = results.reduce((n, r) => n + r.count, 0);
  if (problems.length > 0) {
    for (const problem of problems) console.error(problem);
    console.error(`\ncontent lint FAILED with ${problems.length} problem(s) across ${pages} page(s)`);
    process.exit(1);
  }
  console.log(`content lint OK (${pages} page(s))`);
}

// Only run as a CLI; importing this module must not lint and exit on its own.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run();
}
