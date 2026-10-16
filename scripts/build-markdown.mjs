#!/usr/bin/env node
/**
 * Generates the Markdown content/ pages that are the source of truth for the
 * bundle.
 *
 *   node scripts/build-markdown.mjs          # write content/
 *   node scripts/build-markdown.mjs --check  # exit 1 if content/ is out of date
 *
 * Each exercise/program page carries a YAML frontmatter block with every
 * structural field (in the original JSON key order, recorded in `fields`) and
 * fixed `## Heading` sections for the prose fields; human-only extras (details,
 * links, tables) are rendered below and ignored by the parser. See
 * scripts/lib/md-content.mjs for the format and the reader.
 *
 * Output is deterministic: everything is sorted and no timestamps are emitted,
 * so repeated runs produce byte-identical files. Stale .md files left behind by
 * a rename are removed on a write run, and --check flags them.
 *
 * No dependencies beyond the Node standard library.
 */
import {
  readFileSync,
  readdirSync,
  writeFileSync,
  mkdirSync,
  rmSync,
  existsSync,
} from 'node:fs';
import { join, dirname, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  EXERCISE_PROSE_KEYS,
  PROGRAM_PROSE_KEYS,
  SECTION_HEADINGS,
} from './lib/md-content.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const check = process.argv.includes('--check');

const loadDir = (dir) =>
  readdirSync(join(root, dir))
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => JSON.parse(readFileSync(join(root, dir, f), 'utf8')));

const exercises = loadDir('exercises');
const programs = loadDir('programs');

const byId = new Map(exercises.map((e) => [e.id, e]));
const nameOf = (id) => byId.get(id)?.name ?? id;

// Deterministic, locale-independent string order.
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const byNameThenId = (a, b) =>
  cmp(a.name.toLowerCase(), b.name.toLowerCase()) || cmp(a.id, b.id);

// --- YAML frontmatter emission ---------------------------------------------

// Plain scalars are fine when the value starts with a letter and uses only
// safe characters; quote anything else (including anything number- or
// bool-like) so the parser can never mis-type it.
const yamlScalar = (v) => {
  if (v === null) return 'null';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'number') return String(v);
  const s = String(v);
  if (s !== '' && /^[A-Za-z][A-Za-z0-9 ._/-]*$/.test(s) && !/^(true|false|null)$/i.test(s)) {
    return s;
  }
  return JSON.stringify(s);
};

function emitField(key, value, indent, out) {
  const pad = ' '.repeat(indent);
  if (Array.isArray(value)) {
    if (value.length === 0) {
      out.push(`${pad}${key}: []`);
      return;
    }
    if (value.every((v) => v === null || typeof v !== 'object')) {
      out.push(`${pad}${key}:`);
      for (const v of value) out.push(`${pad}  - ${yamlScalar(v)}`);
      return;
    }
    out.push(`${pad}${key}:`);
    for (const item of value) {
      const itemLines = [];
      emitObject(item, indent + 4, itemLines);
      out.push(`${pad}  - ${itemLines[0].slice(indent + 4)}`);
      for (let i = 1; i < itemLines.length; i++) out.push(itemLines[i]);
    }
    return;
  }
  if (value && typeof value === 'object') {
    if (Object.keys(value).length === 0) {
      out.push(`${pad}${key}: {}`);
      return;
    }
    out.push(`${pad}${key}:`);
    emitObject(value, indent + 2, out);
    return;
  }
  out.push(`${pad}${key}: ${yamlScalar(value)}`);
}

function emitObject(obj, indent, out) {
  for (const key of Object.keys(obj)) emitField(key, obj[key], indent, out);
}

// Frontmatter block. `fields` records the exact top-level key order so the
// reader can rebuild the JSON object byte-for-byte.
function frontmatter(obj, proseKeys) {
  const keys = Object.keys(obj);
  const out = ['---', `fields: ${JSON.stringify(keys)}`];
  for (const key of keys) {
    if (!proseKeys.has(key)) emitField(key, obj[key], 0, out);
  }
  out.push('---');
  return out;
}

// --- formatting helpers -----------------------------------------------------

// Table-safe cell: collapse newlines and escape pipes.
const cell = (v) =>
  v === undefined || v === null || v === ''
    ? '—'
    : String(v).replace(/\s*\n\s*/g, ' ').replace(/\|/g, '\\|').trim();

const section = (heading, lines) =>
  lines.length ? ['', `## ${heading}`, '', ...lines] : [];

// Link to a sibling exercise page when the string is a known exercise id,
// otherwise render the prose as-is.
const relink = (value) => (byId.has(value) ? `[${nameOf(value)}](${value}.md)` : value);

// --- exercise pages ---------------------------------------------------------

function renderExercise(e) {
  const lines = frontmatter(e, EXERCISE_PROSE_KEYS);
  lines.push('', `# ${e.name}`);

  if (e.deprecated) {
    lines.push(
      '',
      e.replacedBy
        ? `> **Deprecated**, use [${nameOf(e.replacedBy)}](${e.replacedBy}.md).`
        : '> **Deprecated.**',
    );
  }

  // Human-only summary (mirrors the frontmatter; ignored by the parser).
  const details = [
    `- **Category:** ${e.category}`,
    `- **Difficulty:** ${e.difficulty}`,
    `- **Movement pattern:** ${e.movementPattern}`,
    `- **Equipment:** ${(e.equipment ?? []).join(', ') || '—'}`,
    `- **Primary muscles:** ${(e.muscles?.primary ?? []).join(', ') || '—'}`,
  ];
  if (e.muscles?.secondary?.length)
    details.push(`- **Secondary muscles:** ${e.muscles.secondary.join(', ')}`);
  if (e.aliases?.length) details.push(`- **Aliases:** ${e.aliases.join(', ')}`);
  lines.push(...section('Details', details));

  // Prose fields: fixed, machine-readable sections.
  if (e.overview)
    lines.push('', `## ${SECTION_HEADINGS.overview}`, '', e.overview);
  if (e.instructions?.length)
    lines.push(
      '',
      `## ${SECTION_HEADINGS.instructions}`,
      '',
      ...e.instructions.map((s, i) => `${i + 1}. ${s}`),
    );
  if (e.cues?.length)
    lines.push('', `## ${SECTION_HEADINGS.cues}`, '', ...e.cues.map((s) => `- ${s}`));
  if (e.commonMistakes?.length)
    lines.push(
      '',
      `## ${SECTION_HEADINGS.commonMistakes}`,
      '',
      ...e.commonMistakes.map((s) => `- ${s}`),
    );
  if (e.safetyNotes)
    lines.push('', `## ${SECTION_HEADINGS.safetyNotes}`, '', e.safetyNotes);
  if (e.longevityNotes)
    lines.push('', `## ${SECTION_HEADINGS.longevityNotes}`, '', e.longevityNotes);

  // Human-only extras.
  const p = e.progression;
  if (p && (p.loadingGuidance || p.progressTo || p.regressTo)) {
    const rows = [];
    if (p.loadingGuidance) rows.push(`- **Loading guidance:** ${p.loadingGuidance}`);
    if (p.progressTo) rows.push(`- **Progress to:** ${relink(p.progressTo)}`);
    if (p.regressTo) rows.push(`- **Regress to:** ${relink(p.regressTo)}`);
    lines.push(...section('Progression', rows));
  }
  if (e.sources?.length) {
    const rows = e.sources.map((s) => {
      const label = s.url ? `[${s.title}](${s.url})` : s.title;
      return `- ${label}${s.publisher ? ` — ${s.publisher}` : ''}`;
    });
    lines.push(...section('Sources', rows));
  }
  const meta = [`- **Schema version:** ${e.schemaVersion}`];
  if (e.updatedAt) meta.push(`- **Updated:** ${e.updatedAt}`);
  if (e.image) meta.push(`- **Image:** \`${e.image}\``);
  if (e.attribution) meta.push(`- **Attribution:** ${e.attribution}`);
  if (e.demoMedia)
    meta.push(
      `- **Demo media:** images ${JSON.stringify(e.demoMedia.images ?? [])}, video ${JSON.stringify(e.demoMedia.video ?? null)}`,
    );
  lines.push(...section('Metadata', meta));

  return `${lines.join('\n')}\n`;
}

// --- program pages ----------------------------------------------------------

function renderProgram(p) {
  const lines = frontmatter(p, PROGRAM_PROSE_KEYS);
  lines.push('', `# ${p.name}`);

  if (p.deprecated) {
    lines.push(
      '',
      p.replacedBy
        ? `> **Deprecated**, use [${p.replacedBy}](${p.replacedBy}.md).`
        : '> **Deprecated.**',
    );
  }

  // Prose field: fixed, machine-readable section.
  if (p.goal) lines.push('', `## ${SECTION_HEADINGS.goal}`, '', p.goal);

  // Human-only details.
  const details = [
    `- **Weeks:** ${p.weeks}`,
    `- **Days per week:** ${p.daysPerWeek}`,
  ];
  if (p.deload) {
    const pct = Math.round(p.deload.volumeFactor * 100);
    details.push(
      `- **Deload:** week ${p.deload.week} at ${pct}% volume (×${p.deload.volumeFactor})`,
    );
  }
  lines.push(...section('Details', details));

  // Human-only table: the whole block layout at a glance (the parser reads
  // sessions from the frontmatter, not this).
  const sessions = [...(p.sessions ?? [])].sort((a, b) => a.day - b.day);
  lines.push('', '## Weekly plan');
  for (let week = 1; week <= p.weeks; week++) {
    const isDeload = p.deload?.week === week;
    lines.push('', `### Week ${week}${isDeload ? ' (deload)' : ''}`, '');
    lines.push('| Day | Session | Exercise | Sets × Reps | Rest | RPE cap | Notes |');
    lines.push('| ---: | --- | --- | --- | ---: | ---: | --- |');
    for (const s of sessions) {
      if (!s.blocks?.length) {
        lines.push(`| ${s.day} | ${cell(s.name)} | — | — | — | — | — |`);
        continue;
      }
      for (const b of s.blocks) {
        const ex = byId.has(b.exerciseId)
          ? `[${nameOf(b.exerciseId)}](../exercises/${b.exerciseId}.md)`
          : b.exerciseId;
        const setsReps = b.reps === undefined ? `${b.sets}` : `${b.sets} × ${b.reps}`;
        const rest = b.restSeconds === undefined ? '—' : `${b.restSeconds} s`;
        const rpe = b.rpeCap === undefined ? '—' : `≤ ${b.rpeCap}`;
        lines.push(
          `| ${s.day} | ${cell(s.name)} | ${ex} | ${cell(setsReps)} | ${rest} | ${rpe} | ${cell(b.notes)} |`,
        );
      }
    }
  }

  if (p.attribution) lines.push(...section('Attribution', [p.attribution]));
  if (p.sources?.length) {
    const rows = p.sources.map((s) => {
      const label = s.url ? `[${s.title}](${s.url})` : s.title;
      return `- ${label}${s.publisher ? ` — ${s.publisher}` : ''}`;
    });
    lines.push(...section('Sources', rows));
  }
  const meta = [`- **Schema version:** ${p.schemaVersion}`];
  if (p.updatedAt) meta.push(`- **Updated:** ${p.updatedAt}`);
  lines.push(...section('Metadata', meta));

  return `${lines.join('\n')}\n`;
}

// --- index ------------------------------------------------------------------

function renderReadme() {
  const lines = ['# LIFT Knowledge Base — content', ''];
  lines.push(
    'Source of truth for the LIFT bundle. Each page carries its full JSON as',
    'YAML frontmatter plus fixed prose sections; `scripts/lib/md-content.mjs`',
    'reads them back. Generated by `node scripts/build-markdown.mjs`; do not edit',
    'by hand. Run `node scripts/build-markdown.mjs --check` to test for staleness.',
  );

  lines.push('', '## Programs', '');
  if (programs.length) {
    lines.push('| Program | Goal | Weeks | Days/week |');
    lines.push('| --- | --- | ---: | ---: |');
    for (const p of [...programs].sort(byNameThenId)) {
      lines.push(
        `| [${p.name}](programs/${p.id}.md)${p.deprecated ? ' _(deprecated)_' : ''} | ${cell(p.goal)} | ${p.weeks} | ${p.daysPerWeek} |`,
      );
    }
  } else {
    lines.push('_No programs._');
  }

  lines.push('', '## Exercises', '');
  const groups = new Map();
  for (const e of exercises) {
    if (!groups.has(e.movementPattern)) groups.set(e.movementPattern, []);
    groups.get(e.movementPattern).push(e);
  }
  for (const pattern of [...groups.keys()].sort(cmp)) {
    lines.push(`### ${pattern}`, '');
    for (const e of groups.get(pattern).sort(byNameThenId)) {
      const muscles = [
        ...(e.muscles?.primary ?? []),
        ...(e.muscles?.secondary ?? []),
      ].join(', ');
      const equipment = (e.equipment ?? []).join(', ');
      const dep = e.deprecated ? ' _(deprecated)_' : '';
      lines.push(
        `- [${e.name}](exercises/${e.id}.md) — ${muscles} · ${equipment} · ${e.difficulty}${dep}`,
      );
    }
    lines.push('');
  }

  return `${lines.join('\n').replace(/\n+$/, '')}\n`;
}

// --- build the in-memory file set -------------------------------------------

const files = new Map(); // path relative to content/, posix style
for (const e of exercises) files.set(`exercises/${e.id}.md`, renderExercise(e));
for (const p of programs) files.set(`programs/${p.id}.md`, renderProgram(p));
files.set('README.md', renderReadme());

// --- link validation (every relative link must resolve) ---------------------

function validateLinks() {
  const problems = [];
  const dirOf = (p) => posix.dirname(p);
  for (const [path, body] of files) {
    for (const m of body.matchAll(/\]\(([^)]+)\)/g)) {
      const target = m[1];
      if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('#')) continue;
      const resolved = target.startsWith('/')
        ? target.slice(1)
        : posix.normalize(join(dirOf(path), target));
      if (!files.has(resolved)) {
        problems.push(`${path} → ${target}`);
      }
    }
  }
  return problems;
}

const linkProblems = validateLinks();
if (linkProblems.length) {
  console.error('UNRESOLVED LINKS:');
  for (const p of linkProblems) console.error(`  ${p}`);
  process.exit(1);
}

// --- write or check ---------------------------------------------------------

const contentDir = join(root, 'content');

const walkMd = (dir, prefix = '') => {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
    cmp(a.name, b.name),
  )) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...walkMd(join(dir, entry.name), rel));
    else if (entry.name.endsWith('.md')) out.push(rel);
  }
  return out;
};

if (check) {
  const stale = [];
  for (const [path, body] of files) {
    const abs = join(contentDir, path);
    if (!existsSync(abs) || readFileSync(abs, 'utf8') !== body)
      stale.push(path);
  }
  const expected = new Set(files.keys());
  for (const rel of walkMd(contentDir)) {
    if (!expected.has(rel)) stale.push(`${rel} (unexpected)`);
  }
  if (stale.length) {
    console.error(`content/ is out of date (${stale.length} file(s)):`);
    for (const s of stale) console.error(`  ${s}`);
    process.exit(1);
  }
  console.log(
    `content/ is up to date (${exercises.length} exercises, ${programs.length} programs)`,
  );
} else {
  // Remove stale generator-owned files first so renames don't leave orphans.
  const expected = new Set(files.keys());
  for (const rel of walkMd(contentDir)) {
    if (!expected.has(rel)) rmSync(join(contentDir, rel));
  }
  for (const [path, body] of files) {
    const abs = join(contentDir, path);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, body);
  }
  console.log(
    `wrote ${files.size} files to content/ (${exercises.length} exercises, ${programs.length} programs, ${linkProblems.length} broken links)`,
  );
}
