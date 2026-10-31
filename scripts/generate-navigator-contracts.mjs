import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const clientRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const navigatorRoot = resolve(process.env.CYRENE_NAVIGATOR_DIR ?? resolve(clientRoot, '../Cyrene-Services/Cyrene-Navigator'));
const target = resolve(clientRoot, 'apps/web/services/navigator/src/generated/contracts.ts');
const snapshots = resolve(clientRoot, 'contracts/navigator');
const provenancePath = resolve(snapshots, 'source.json');
const provenance = JSON.parse(await readFile(provenancePath, 'utf8'));
const sourcePath = 'contracts/product/v1/work.openapi.json';
const snapshotPath = resolve(snapshots, 'work.openapi.json');
const sync = process.argv.includes('--sync');
if (sync && process.argv.includes('--check')) throw new Error('Choose --sync or --check');
if (provenance.navigatorRepository !== 'https://github.com/DoHorizon-AI/Cyrene-Navigator.git'
  || provenance.developmentRef !== 'refs/remotes/origin/develop'
  || provenance.sourcePath !== sourcePath
  || !/^[0-9a-f]{40}$/.test(provenance.commit)) {
  throw new Error('Navigator Work contract provenance is invalid.');
}

function referenceType(reference, namespace) {
  const match = /^#\/components\/schemas\/(.+)$/.exec(reference);
  if (!match) throw new Error(`Unsupported contract reference: ${reference}`);
  return `${namespace}[${JSON.stringify(decodeURIComponent(match[1]))}]`;
}

function schemaType(schema, namespace) {
  if (schema === true) return 'unknown';
  if (schema === false) return 'never';
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) throw new Error('Invalid schema');
  let result;
  if (schema.$ref) result = referenceType(schema.$ref, namespace);
  else if (Object.hasOwn(schema, 'const')) result = JSON.stringify(schema.const);
  else if (schema.enum) result = schema.enum.map(value => JSON.stringify(value)).join(' | ') || 'never';
  else if (schema.anyOf || schema.oneOf) result = (schema.anyOf ?? schema.oneOf).map(value => `(${schemaType(value, namespace)})`).join(' | ');
  else if (schema.allOf) result = schema.allOf.map(value => `(${schemaType(value, namespace)})`).join(' & ');
  else if (Array.isArray(schema.type)) result = schema.type.map(type => schemaType({ ...schema, type }, namespace)).join(' | ');
  else switch (schema.type) {
    case 'null': result = 'null'; break;
    case 'string': result = 'string'; break;
    case 'number': case 'integer': result = 'number'; break;
    case 'boolean': result = 'boolean'; break;
    case 'array': result = `Array<${schemaType(schema.items ?? true, namespace)}>`; break;
    case 'object': case undefined: {
      const properties = schema.properties ?? {};
      const required = new Set(schema.required ?? []);
      const fields = Object.entries(properties).sort(([left], [right]) => left.localeCompare(right, 'en')).map(([name, value]) => `${JSON.stringify(name)}${required.has(name) ? '' : '?'}: ${schemaType(value, namespace)};`);
      const additional = schema.additionalProperties;
      if (!fields.length) result = additional === false ? 'Record<string, never>' : schema.type === undefined && additional === undefined ? 'unknown' : `Record<string, ${schemaType(typeof additional === 'object' ? additional : true, namespace)}>`;
      else {
        result = `{ ${fields.join(' ')} }`;
        if (additional && typeof additional === 'object') result += ` & Record<string, ${schemaType(additional, namespace)}>`;
        else if (additional === true) result += ' & Record<string, unknown>';
      }
      break;
    }
    default: throw new Error(`Unsupported schema type: ${schema.type}`);
  }
  return schema.nullable && result !== 'null' ? `(${result}) | null` : result;
}

let raw;
if (sync) {
  try {
    execFileSync('git', ['-C', navigatorRoot, 'merge-base', '--is-ancestor', provenance.commit, provenance.developmentRef], { stdio: 'ignore' });
    raw = execFileSync('git', ['-C', navigatorRoot, 'show', `${provenance.commit}:${sourcePath}`], { encoding: 'utf8' });
  } catch {
    throw new Error(`Pinned Navigator commit ${provenance.commit} must exist and be reachable from origin/develop; fetch that repository and retry.`);
  }
} else {
  raw = await readFile(snapshotPath, 'utf8');
}
raw = raw.replace(/\r\n/g, '\n');
const sha256 = createHash('sha256').update(raw).digest('hex');
if (!sync && provenance.sha256 !== sha256) {
  throw new Error('Navigator Work snapshot does not match its pinned source digest.');
}
const contract = JSON.parse(raw);
if (!contract.openapi?.startsWith('3.')) throw new Error('Expected OpenAPI 3 for the pinned Navigator Work contract.');
if (sync) {
  await mkdir(snapshots, { recursive: true });
  await writeFile(snapshotPath, raw, 'utf8');
  provenance.sha256 = sha256;
  await writeFile(provenancePath, `${JSON.stringify(provenance, null, 2)}\n`, 'utf8');
}
let output = `// Generated from Navigator ${sourcePath} at ${provenance.commit}.\n// Run npm run contracts:navigator; do not edit this file by hand.\n\n`;
output += `// ${sourcePath}: SHA-256 ${sha256}\n`;
output += 'export interface WorkSchemas {\n';
for (const [name, schema] of Object.entries(contract.components?.schemas ?? {}).sort(([left], [right]) => left.localeCompare(right, 'en'))) {
  output += `  ${JSON.stringify(name)}: ${schemaType(schema, 'WorkSchemas')};\n`;
}
output += '}\n\n';
output = output.trimEnd() + '\n';
if (process.argv.includes('--check')) {
  const current = (await readFile(target, 'utf8')).replace(/\r\n/g, '\n');
  if (current !== output) throw new Error('Navigator generated types are stale; run npm run contracts:navigator');
} else {
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, output, 'utf8');
}
process.stdout.write(`Navigator contract types ${process.argv.includes('--check') ? 'verified' : 'generated'}.\n`);
