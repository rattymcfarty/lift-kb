/**
 * Markdown <-> content model for lift-kb, with no dependencies beyond Node core.
 *
 * The Markdown under content/ is the source of truth for the bundle. Each
 * exercise/program page is:
 *
 *   1. a YAML frontmatter block holding every "structural" field (scalars,
 *      arrays and nested objects) in the exact key order of the JSON it
 *      replaces, preceded by a `fields:` list naming that order;
 *   2. a small set of fixed `## Heading` sections holding the prose fields
 *      (see SECTION_HEADINGS), which the parser reads back; and
 *   3. human-only extras (title, details, links, tables) that the parser
 *      ignores entirely.
 *
 * `fields` is what makes the round-trip exact: the bundle hash covers
 * JSON.stringify(), which preserves key order, and a handful of pages use a
 * different order than the rest.
 *
 * parseExercise / parseProgram return plain objects deep-equal to the JSON
 * files they replace (values, types and key order).
 */

// Prose fields rendered as fixed sections instead of frontmatter.
export const EXERCISE_PROSE_KEYS = new Set([
  'overview',
  'instructions',
  'cues',
  'commonMistakes',
  'safetyNotes',
  'longevityNotes',
]);
export const PROGRAM_PROSE_KEYS = new Set(['goal']);

// field -> section heading. Headings may be reordered in the body freely; the
// parser maps them back by name.
export const SECTION_HEADINGS = {
  overview: 'Overview',
  instructions: 'Instructions',
  cues: 'Cues',
  commonMistakes: 'Common mistakes',
  safetyNotes: 'Safety',
  longevityNotes: 'Longevity notes',
  goal: 'Goal',
};

const HEADING_TO_FIELD = Object.fromEntries(
  Object.entries(SECTION_HEADINGS).map(([field, heading]) => [heading, field]),
);

// Sections that are lists rather than a single paragraph.
const LIST_FIELDS = new Set(['instructions', 'cues', 'commonMistakes']);

const indentOf = (line) => line.length - line.trimStart().length;

// --- minimal YAML frontmatter subset ---------------------------------------
// Handles exactly what build-markdown.mjs emits: nested block maps, block
// sequences (of scalars or of maps), JSON-quoted scalars, integers, floats,
// booleans, null and JSON flow arrays (used for `fields`).

function parseScalar(token) {
  if (token === '') return null;
  const first = token[0];
  if (first === '"' || first === '[' || first === '{') return JSON.parse(token);
  if (token === 'true') return true;
  if (token === 'false') return false;
  if (token === 'null') return null;
  if (/^-?\d+$/.test(token)) return parseInt(token, 10);
  if (/^-?\d+\.\d+$/.test(token)) return parseFloat(token);
  return token;
}

// A map entry looks like `key: value`; quoted strings must not be mistaken for
// it when they appear as sequence items.
const MAP_ENTRY = /^[A-Za-z_][A-Za-z0-9_-]*:(\s|$)/;

function parseBlock(lines, start, indent) {
  if (start >= lines.length) return [{}, start];
  if (lines[start].startsWith(' '.repeat(indent) + '- ')) {
    return parseSequence(lines, start, indent);
  }

  const map = {};
  let i = start;
  while (i < lines.length) {
    const line = lines[i];
    const cur = indentOf(line);
    if (cur < indent) break;
    if (cur > indent) throw new Error(`unexpected indent: ${JSON.stringify(line)}`);
    const m = /^([^:]+):(.*)$/.exec(line.slice(indent));
    if (!m) throw new Error(`bad frontmatter line: ${JSON.stringify(line)}`);
    const key = m[1].trim();
    const rest = m[2];
    if (rest.trim() === '') {
      const [child, next] = parseBlock(lines, i + 1, indent + 2);
      map[key] = child;
      i = next;
    } else {
      map[key] = parseScalar(rest.trim());
      i += 1;
    }
  }
  return [map, i];
}

function parseSequence(lines, start, indent) {
  const dash = ' '.repeat(indent) + '- ';
  const arr = [];
  let i = start;
  while (i < lines.length && lines[i].startsWith(dash)) {
    const rest = lines[i].slice(indent + 2);
    if (MAP_ENTRY.test(rest)) {
      const content = [' '.repeat(indent + 2) + rest];
      i += 1;
      while (i < lines.length && indentOf(lines[i]) > indent) {
        content.push(lines[i]);
        i += 1;
      }
      const [value] = parseBlock(content, 0, indent + 2);
      arr.push(value);
    } else {
      arr.push(parseScalar(rest.trim()));
      i += 1;
    }
  }
  return [arr, i];
}

/** Parse a YAML frontmatter document (without the `---` fences). */
export function parseFrontmatter(text) {
  const lines = text.split('\n').filter((l) => l.trim() !== '');
  const [value] = parseBlock(lines, 0, 0);
  return value;
}

/** Split a document into frontmatter text and body text. */
export function splitDocument(md) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(md);
  if (!m) throw new Error('document does not start with a YAML frontmatter block');
  return { frontmatter: m[1], body: m[2] };
}

// --- body sections ----------------------------------------------------------

/** The fence run (`` ``` `` / `~~~`) a line opens with, or null. */
function fenceMarker(line) {
  const m = /^(`{3,}|~{3,})/.exec(line.trimStart());
  return m ? m[1] : null;
}

/**
 * Map each `## Heading` to its raw (untrimmed) lines.
 *
 * Only level-2 headings split a section: `###` and deeper belong to the
 * section they sit in, as do blank lines, lists, tables, blockquotes and
 * horizontal rules. A line starting with `## ` inside a fenced code block is
 * content, not a heading, so fences are tracked while scanning.
 */
function extractSections(body) {
  const sections = {};
  let current = null;
  let fence = null; // the marker run (`` ` `` or `~`) we are inside, if any
  for (const line of body.split('\n')) {
    const marker = fenceMarker(line);
    if (marker !== null) {
      // A closing fence is a bare run of the same char, at least as long as
      // the opening one; anything else (e.g. an info string) is content.
      const rest = line.trimStart().slice(marker.length).trim();
      if (fence === null) fence = marker;
      else if (rest === '' && marker[0] === fence[0] && marker.length >= fence.length) {
        fence = null;
      }
      if (current) sections[current].push(line);
      continue;
    }
    if (fence === null) {
      const m = /^##\s+(.+?)\s*$/.exec(line);
      if (m) {
        current = m[1];
        sections[current] = [];
        continue;
      }
    }
    if (current) sections[current].push(line);
  }
  return sections;
}

/**
 * A prose value: drop leading/trailing blank lines only, and keep everything
 * in between byte-for-byte — blank lines, `###` subheadings, bullet and
 * numbered lists, blockquotes, tables, `---` rules, inline markup and emoji
 * all round-trip unchanged.
 */
function paragraph(lines) {
  const start = lines.findIndex((l) => l.trim() !== '');
  if (start === -1) return '';
  const end = lines.length - 1 - [...lines].reverse().findIndex((l) => l.trim() !== '');
  return lines.slice(start, end + 1).join('\n');
}

function listSection(field, lines) {
  const re = field === 'instructions' ? /^\s*\d+\.\s*(.*)$/ : /^\s*-\s*(.*)$/;
  const items = [];
  for (const line of lines) {
    const m = re.exec(line);
    if (m) items.push(m[1]);
  }
  return items;
}

function sectionValue(field, sections) {
  const heading = SECTION_HEADINGS[field];
  const lines = sections[heading];
  if (!lines) throw new Error(`missing "## ${heading}" section`);
  return LIST_FIELDS.has(field) ? listSection(field, lines) : paragraph(lines);
}

// --- public parsers ---------------------------------------------------------

function assemble(frontmatter, body, proseKeys) {
  const { fields, ...data } = frontmatter;
  if (!Array.isArray(fields)) throw new Error('frontmatter is missing a `fields` list');
  const sections = extractSections(body);

  const out = {};
  for (const key of fields) {
    if (proseKeys.has(key)) {
      out[key] = sectionValue(key, sections);
    } else if (Object.prototype.hasOwnProperty.call(data, key)) {
      out[key] = data[key];
    } else {
      throw new Error(`frontmatter is missing field "${key}"`);
    }
  }
  for (const key of Object.keys(data)) {
    if (!fields.includes(key)) throw new Error(`field "${key}" is not listed in \`fields\``);
  }
  return out;
}

/** Parse an exercise page into an object deep-equal to exercises/<id>.json. */
export function parseExercise(md) {
  const { frontmatter, body } = splitDocument(md);
  return assemble(parseFrontmatter(frontmatter), body, EXERCISE_PROSE_KEYS);
}

/** Parse a program page into an object deep-equal to programs/<id>.json. */
export function parseProgram(md) {
  const { frontmatter, body } = splitDocument(md);
  return assemble(parseFrontmatter(frontmatter), body, PROGRAM_PROSE_KEYS);
}

export { HEADING_TO_FIELD };
