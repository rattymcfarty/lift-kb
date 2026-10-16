#!/usr/bin/env node
/**
 * Generates human-readable Markdown under content/ from the JSON source of truth.
 *
 *   node scripts/build-markdown.mjs          # write content/
 *   node scripts/build-markdown.mjs --check  # exit 1 if content/ is out of date
 *
 * JSON (exercises/, programs/) stays the source of truth; the Markdown is
 * derived only. Output is deterministic: everything is sorted and no timestamps
 * are emitted, so repeated runs produce byte-identical files. Stale .md files
 * left behind by a rename are removed on a write run, and --check flags them.
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

// --- formatting helpers -----------------------------------------------------

// YAML plain scalars are fine for simple values; quote anything else so the
// frontmatter stays valid.
const yaml = (v) => {
  const s = String(v);
  return /^[A-Za-z0-9][A-Za-z0-9 ._/-]*$/.test(s) ? s : JSON.stringify(s);
};
const yamlList = (key, values, indent) => {
  const pad = ' '.repeat(indent);
  if (!values || values.length === 0) return [`${pad}${key}: []`];
  return [`${pad}${key}:`, ...values.map((v) => `${pad}  - ${yaml(v)}`)];
};

// Inline rendering for arbitrary leftover values (objects/arrays as JSON).
const fmt = (v) => (typeof v === 'string' ? v : JSON.stringify(v));

const bullets = (items) => items.map((v) => `- ${fmt(v)}`);

// Table-safe cell: collapse newlines and escape pipes.
const cell = (v) =>
  v === undefined || v === null || v === ''
    ? '—'
    : String(v).replace(/\s*\n\s*/g, ' ').replace(/\|/g, '\\|').trim();

const section = (heading, lines) =>
  lines.length ? ['', `## ${heading}`, '', ...lines] : [];

// Renders any keys we did not handle explicitly, so no field is ever dropped.
const leftovers = (obj, handled) => {
  const rest = Object.keys(obj)
    .filter((k) => !handled.has(k))
    .sort();
  return section(
    'Other data',
    rest.map((k) => `- **${k}:** ${fmt(obj[k])}`),
  );
};

// --- exercise pages ---------------------------------------------------------

function renderExercise(e) {
  const lines = [];
  const fm = [
    '---',
    `id: ${yaml(e.id)}`,
    `name: ${yaml(e.name)}`,
    `difficulty: ${yaml(e.difficulty)}`,
    `movementPattern: ${yaml(e.movementPattern)}`,
    'muscles:',
    ...yamlList('primary', e.muscles?.primary ?? [], 2),
    ...yamlList('secondary', e.muscles?.secondary ?? [], 2),
    ...yamlList('equipment', e.equipment ?? [], 0),
    '---',
  ];
  lines.push(...fm, '', `# ${e.name}`);

  if (e.deprecated) {
    const note = e.replacedBy
      ? `> **Deprecated**, use [${nameOf(e.replacedBy)}](${e.replacedBy}.md).`
      : '> **Deprecated.**';
    lines.push('', note);
  }
  if (e.overview) lines.push('', e.overview);

  const details = [
    `- **Category:** ${fmt(e.category)}`,
    `- **Difficulty:** ${e.difficulty}`,
    `- **Movement pattern:** ${e.movementPattern}`,
    `- **Equipment:** ${(e.equipment ?? []).join(', ') || '—'}`,
    `- **Primary muscles:** ${(e.muscles?.primary ?? []).join(', ') || '—'}`,
  ];
  if (e.muscles?.secondary?.length)
    details.push(`- **Secondary muscles:** ${e.muscles.secondary.join(', ')}`);
  if (e.aliases?.length)
    details.push(`- **Aliases:** ${e.aliases.join(', ')}`);
  lines.push(...section('Details', details));

  if (e.instructions?.length)
    lines.push(
      ...section(
        'Instructions',
        e.instructions.map((s, i) => `${i + 1}. ${s}`),
      ),
    );
  if (e.cues?.length) lines.push(...section('Cues', bullets(e.cues)));
  if (e.commonMistakes?.length)
    lines.push(...section('Common mistakes', bullets(e.commonMistakes)));
  if (e.safetyNotes)
    lines.push(...section('Safety', [e.safetyNotes]));
  if (e.longevityNotes)
    lines.push(...section('Longevity notes', [e.longevityNotes]));

  const p = e.progression;
  if (p && (p.loadingGuidance || p.progressTo || p.regressTo)) {
    const rows = [];
    if (p.loadingGuidance)
      rows.push(`- **Loading guidance:** ${p.loadingGuidance}`);
    // progressTo/regressTo are usually sibling exercise ids: link them.
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

  const handled = new Set([
    'id', 'name', 'difficulty', 'movementPattern', 'muscles', 'equipment',
    'overview', 'deprecated', 'replacedBy', 'category', 'aliases',
    'instructions', 'cues', 'commonMistakes', 'safetyNotes', 'longevityNotes',
    'progression', 'sources', 'schemaVersion', 'updatedAt', 'image',
    'attribution', 'demoMedia',
  ]);
  lines.push(...leftovers(e, handled));

  return `${lines.join('\n')}\n`;
}

// Link to a sibling exercise page when the string is a known exercise id,
// otherwise render the prose as-is.
const relink = (value) =>
  byId.has(value)
    ? `[${nameOf(value)}](${value}.md)`
    : value;

// --- program pages ----------------------------------------------------------

function renderProgram(p) {
  const lines = [];
  lines.push(`# ${p.name}`);

  if (p.deprecated) {
    const note = p.replacedBy
      ? `> **Deprecated**, use [${p.replacedBy}](${p.replacedBy}.md).`
      : '> **Deprecated.**';
    lines.push('', note);
  }
  if (p.goal) lines.push('', p.goal);

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

  // One table per week, rows grouped by day — the whole block layout is visible.
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
        const setsReps =
          b.reps === undefined ? `${b.sets}` : `${b.sets} × ${b.reps}`;
        const rest = b.restSeconds === undefined ? '—' : `${b.restSeconds} s`;
        const rpe = b.rpeCap === undefined ? '—' : `≤ ${b.rpeCap}`;
        lines.push(
          `| ${s.day} | ${cell(s.name)} | ${ex} | ${cell(setsReps)} | ${rest} | ${rpe} | ${cell(b.notes)} |`,
        );
      }
    }
  }

  if (p.attribution)
    lines.push(...section('Attribution', [p.attribution]));

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

  const handled = new Set([
    'id', 'name', 'goal', 'weeks', 'daysPerWeek', 'deload', 'sessions',
    'attribution', 'sources', 'schemaVersion', 'updatedAt', 'deprecated',
    'replacedBy',
  ]);
  lines.push(...leftovers(p, handled));

  return `${lines.join('\n')}\n`;
}

// --- index ------------------------------------------------------------------

function renderReadme() {
  const lines = ['# LIFT Knowledge Base — content', ''];
  lines.push(
    'Human-readable rendering of the JSON source of truth (`exercises/`,',
    '`programs/`). Generated by `node scripts/build-markdown.mjs`; do not edit by',
    'hand. Run `node scripts/build-markdown.mjs --check` to test for staleness.',
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
