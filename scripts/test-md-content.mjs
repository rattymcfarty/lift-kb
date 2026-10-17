#!/usr/bin/env node
/**
 * Round-trip tests for scripts/lib/md-content.mjs, dependency-free.
 *
 *   node scripts/test-md-content.mjs
 *
 * Proves that the prose fields rendered as `## ` sections (overview,
 * longevityNotes, safetyNotes and, for programs, goal) carry rich
 * multi-paragraph Markdown through the parser byte-for-byte, and that a `## `
 * line inside a fenced code block is content rather than a section split.
 * Finally it rebuilds the canonical bundle in memory and checks the sha256, so
 * a parser regression that changed existing content fails here too.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseExercise, parseProgram } from './lib/md-content.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// sha256 of the canonical bundle (generatedAt excluded) for the content as it
// stands. build-bundle.mjs prints the same value and channel.json records it.
const EXPECTED_SHA =
  'd9b469368c45f0534965b1d515c8f45af2ee5157f1b8c4f342a7391010b56cc7';

let passed = 0;
const failures = [];

function check(name, condition, detail = '') {
  if (condition) {
    passed += 1;
  } else {
    failures.push(detail ? `${name}: ${detail}` : name);
  }
}

function equal(name, actual, expected) {
  check(
    name,
    actual === expected,
    `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
  );
}

function deepEqual(name, actual, expected) {
  check(
    name,
    JSON.stringify(actual) === JSON.stringify(expected),
    `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
  );
}

// --- synthetic rich values ------------------------------------------------

const OVERVIEW = [
  'The **hinge** is the most protective *pattern* in the gym. 🏋️',
  '',
  '### Why it matters',
  '',
  'A strong posterior chain carries over into everyday life:',
  '',
  '- Picking things up off the floor',
  '- Bracing under an awkward load',
  '',
  'Progress it with:',
  '',
  '1. Light technique work',
  '2. Slow tempo reps',
  '',
  '> Train the pattern, not the number on the bar.',
  '',
  '| Week | Load |',
  '| --- | --- |',
  '| 1 | light |',
  '| 2 | moderate |',
  '',
  '---',
  '',
  'A fenced block may contain a level-2 line:',
  '',
  '```txt',
  '## not a heading',
  'still part of the overview',
  '```',
].join('\n');

const LONGEVITY = [
  'Longevity is built by **showing up**, not by *redlining* every session. 💪',
  '',
  '### Dose over intensity',
  '',
  'Aim for a stimulus you can recover from:',
  '',
  '- Two hard sets leave you fresh',
  '- Add load only when form holds',
].join('\n');

const SAFETY = [
  'Stop if you feel a **sharp** pain, not the ordinary burn of effort.',
  '',
  '### Warning signs',
  '',
  '> Pain that changes how you move is a stop signal.',
  '',
  '- Radiating pain',
  '- Numbness',
].join('\n');

const GOAL = [
  'Build the fundamental movement patterns.',
  '',
  '### Structure',
  '',
  '- Three days per week',
  '- One deload in week four',
].join('\n');

// --- synthetic pages ------------------------------------------------------

const exerciseMd = [
  '---',
  'fields: ["id","schemaVersion","name","instructions","cues","longevityNotes","overview","safetyNotes"]',
  'id: rich-example',
  'schemaVersion: 1',
  'name: Rich Example',
  '---',
  '',
  '# Rich Example',
  '',
  '## Overview',
  '',
  OVERVIEW,
  '',
  '',
  '## Instructions',
  '',
  '1. Set up.',
  '2. Move.',
  '',
  '## Cues',
  '',
  '- Brace',
  '- Breathe',
  '',
  '## Longevity notes',
  '',
  LONGEVITY,
  '',
  '## Safety',
  '',
  SAFETY,
  '',
].join('\n');

const programMd = [
  '---',
  'fields: ["id","schemaVersion","name","goal"]',
  'id: rich-program',
  'schemaVersion: 1',
  'name: Rich Program',
  '---',
  '',
  '# Rich Program',
  '',
  '## Goal',
  '',
  GOAL,
  '',
].join('\n');

// --- exercise round-trip --------------------------------------------------

const exercise = parseExercise(exerciseMd);
equal('overview round-trips exactly', exercise.overview, OVERVIEW);
equal('longevityNotes round-trips exactly', exercise.longevityNotes, LONGEVITY);
equal('safetyNotes round-trips exactly', exercise.safetyNotes, SAFETY);
check(
  'overview keeps a `## ` line inside a fence',
  exercise.overview.includes('## not a heading'),
);
check(
  'overview keeps its `### ` subheading',
  exercise.overview.includes('\n### Why it matters\n'),
);
check(
  'overview keeps bold/italic/emoji',
  exercise.overview.includes('**hinge**') &&
    exercise.overview.includes('*pattern*') &&
    exercise.overview.includes('🏋️'),
);
check('overview keeps a blockquote', exercise.overview.includes('\n> Train the pattern'));
check('overview keeps a table row', exercise.overview.includes('| 1 | light |'));
check('overview keeps a horizontal rule', exercise.overview.includes('\n---\n'));
deepEqual('instructions still parse as a list', exercise.instructions, ['Set up.', 'Move.']);
deepEqual('cues still parse as a list', exercise.cues, ['Brace', 'Breathe']);

// --- program round-trip ---------------------------------------------------

const program = parseProgram(programMd);
equal('program goal round-trips exactly', program.goal, GOAL);

// --- leading/trailing blank lines are trimmed, internal ones kept ---------

const padded = OVERVIEW.replace('\n\n### Why it matters', '\n\n\n### Why it matters');
const paddedMd = exerciseMd.replace(OVERVIEW, `\n\n${padded}\n\n\n`);
equal(
  'leading/trailing blanks trimmed, internal blanks kept',
  parseExercise(paddedMd).overview,
  padded,
);

// --- real content still builds to the same bundle -------------------------

const { version, schemaVersion } = JSON.parse(
  readFileSync(join(root, 'kb-version.json'), 'utf8'),
);

function load(dir, parse) {
  return readdirSync(join(root, 'content', dir))
    .filter((f) => f.endsWith('.md'))
    .sort()
    .map((name) => parse(readFileSync(join(root, 'content', dir, name), 'utf8')));
}

let exercises = [];
let programs = [];
try {
  exercises = load('exercises', parseExercise);
  programs = load('programs', parseProgram);
  passed += 1; // every real page parsed
} catch (err) {
  failures.push(`real content parses: ${err.message}`);
}

const canonical = JSON.stringify({
  bundleVersion: version,
  schemaVersion,
  exercises,
  programs,
});
const sha = createHash('sha256').update(canonical).digest('hex');
equal('real bundle sha256 is unchanged', sha, EXPECTED_SHA);

// --- report ---------------------------------------------------------------

if (failures.length > 0) {
  for (const f of failures) console.error(`FAIL ${f}`);
  console.error(`\n${failures.length} check(s) failed, ${passed} passed`);
  process.exit(1);
}
console.log(`all ${passed} checks passed`);
