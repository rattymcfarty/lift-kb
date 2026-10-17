#!/usr/bin/env node
/**
 * Validates the parsed Markdown content against the JSON Schemas.
 *
 *   node scripts/validate-content.mjs
 *
 * Reads every content/exercises/*.md and content/programs/*.md through
 * scripts/lib/md-content.mjs and checks the result against
 * schemas/exercise.schema.json / schemas/program.schema.json. Exits 1 on any
 * error. The validator is a deliberately small, dependency-free subset of
 * JSON Schema: the checks the schemas actually use (required fields, types,
 * enums, const, additionalProperties, items, minItems, min/max, minLength,
 * pattern), enough to catch a malformed page.
 *
 * No dependencies beyond the Node standard library.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseExercise, parseProgram } from './lib/md-content.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const typeOf = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v);

function matchesType(value, type) {
  switch (type) {
    case 'null':
      return value === null;
    case 'array':
      return Array.isArray(value);
    case 'object':
      return value !== null && typeof value === 'object' && !Array.isArray(value);
    case 'integer':
      return Number.isInteger(value);
    case 'number':
      return typeof value === 'number';
    default:
      return typeof value === type;
  }
}

function deepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function validate(value, schema, path, errors) {
  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((t) => matchesType(value, t))) {
      errors.push(`${path}: expected ${types.join(' | ')}, got ${typeOf(value)}`);
      return;
    }
  }
  if (schema.const !== undefined && !deepEqual(value, schema.const)) {
    errors.push(`${path}: expected const ${JSON.stringify(schema.const)}, got ${JSON.stringify(value)}`);
  }
  if (schema.enum && !schema.enum.some((e) => e === value)) {
    errors.push(`${path}: ${JSON.stringify(value)} not one of ${JSON.stringify(schema.enum)}`);
  }
  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      errors.push(`${path}: shorter than minLength ${schema.minLength}`);
    }
    if (schema.pattern !== undefined && !new RegExp(schema.pattern).test(value)) {
      errors.push(`${path}: ${JSON.stringify(value)} does not match ${schema.pattern}`);
    }
  }
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) {
      errors.push(`${path}: ${value} below minimum ${schema.minimum}`);
    }
    if (schema.maximum !== undefined && value > schema.maximum) {
      errors.push(`${path}: ${value} above maximum ${schema.maximum}`);
    }
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      errors.push(`${path}: fewer than minItems ${schema.minItems}`);
    }
    if (schema.items) {
      value.forEach((item, i) => validate(item, schema.items, `${path}[${i}]`, errors));
    }
  } else if (value !== null && typeof value === 'object') {
    const props = schema.properties ?? {};
    for (const key of schema.required ?? []) {
      if (!Object.prototype.hasOwnProperty.call(value, key)) {
        errors.push(`${path}: missing required field "${key}"`);
      }
    }
    for (const [key, child] of Object.entries(props)) {
      if (Object.prototype.hasOwnProperty.call(value, key)) {
        validate(value[key], child, `${path}.${key}`, errors);
      }
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!Object.prototype.hasOwnProperty.call(props, key)) {
          errors.push(`${path}: unexpected field "${key}"`);
        }
      }
    }
  }
}

/** Read one of the JSON Schemas under schemas/. */
export function loadSchema(schemaFile) {
  return JSON.parse(readFileSync(join(root, 'schemas', schemaFile), 'utf8'));
}

function check(kind, dir, schemaFile, parse) {
  const schema = loadSchema(schemaFile);
  const files = readdirSync(join(root, 'content', dir))
    .filter((f) => f.endsWith('.md'))
    .sort();
  const errors = [];
  for (const file of files) {
    const obj = parse(readFileSync(join(root, 'content', dir, file), 'utf8'));
    validate(obj, schema, `${dir}/${file}`, errors);
  }
  for (const err of errors) console.error(`  ${err}`);
  return { count: files.length, errors: errors.length, kind };
}

function run() {
  const results = [
    check('exercise', 'exercises', 'exercise.schema.json', parseExercise),
    check('program', 'programs', 'program.schema.json', parseProgram),
  ];

  const total = results.reduce((n, r) => n + r.errors, 0);
  for (const r of results) {
    console.log(`${r.kind}: ${r.count} page(s), ${r.errors} error(s)`);
  }
  if (total > 0) {
    console.error(`content validation FAILED with ${total} error(s)`);
    process.exit(1);
  }
  console.log('content validation OK');
}

// Only run as a CLI; importing this module (e.g. from lint-content.mjs) must
// not validate and exit on its own.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run();
}
