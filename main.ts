// Token Radar's entrypoint (Node 22, standard library only).
//
// Reads the sealed snapshot, scores every rankable pre-token protocol with the comparables
// model in lib/model.ts, and writes the entry's outputs: the ranked board, the dashboard's
// data, the dashboard itself, three screenshots of it, and the dossier the judge reads.
//
// The program runs in the grader's sandbox with a read-only repository at /bot and a writable
// /output. Outside that sandbox, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
//
// The run is deterministic: the same snapshot bytes always write the same output bytes, so
// the grader's two runs agree.

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const repoRoot = fileURLToPath(new URL('.', import.meta.url));

/** The caps the gate holds the outputs to. */
const TEXT_CAP = 65_536;
const SHOT_MAX = 4;
const SHOT_MAX_BYTES = 524_288;
const SHOT_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_MAGIC = [0xff, 0xd8, 0xff];

/** Read `--name <value>` (or `--name=<value>`) from the arguments, else `fallback`. */
function flag(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const eq = process.argv.find((a) => a.startsWith(`--${name}=`));
  return eq === undefined ? fallback : eq.slice(name.length + 3);
}

function fail(message: string): never {
  process.stderr.write(`token radar: ${message}\n`);
  process.exit(1);
}

const inputArg = flag('input', '/input');
const snapshotPath = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(snapshotPath)) {
  fail(`no snapshot at ${snapshotPath}: pass --input <snapshot.json|directory> or mount the sealed /input`);
}
const outDir = flag('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = parseSnapshot(readFileSync(snapshotPath, 'utf8'));
const { board, radar } = buildRadar(snapshot);
const problem = boardIssue(board, snapshot);
if (problem !== null) fail(`the model wrote a board the gate refuses: ${problem}`);

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
writeFileSync(join(outDir, 'data.js'), dataScript(radar));

/**
 * Copy a directory's regular files into `dest`, skipping dot-names. Returns the copied names
 * in sorted order. Refuses a missing source and any file that is not a regular file.
 */
function copyDir(from: string, dest: string): string[] {
  if (!existsSync(from)) fail(`missing directory ${from}: the repository is incomplete`);
  mkdirSync(dest, { recursive: true });
  const names: string[] = [];
  for (const name of readdirSync(from).sort()) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) fail(`${path} is not a regular file`);
    copyFileSync(path, join(dest, name));
    names.push(name);
  }
  return names;
}

const dashboardFiles = copyDir(join(repoRoot, 'dashboard'), join(outDir, 'dashboard'));
if (!dashboardFiles.includes('index.html')) fail('dashboard/ holds no index.html');
if (!dashboardFiles.some((n) => n.endsWith('.css'))) fail('dashboard/ holds no stylesheet');
if (!dashboardFiles.some((n) => n.endsWith('.js'))) fail('dashboard/ holds no script');

const shotNames = copyDir(join(repoRoot, 'screenshots'), join(outDir, 'screenshots'));
if (shotNames.length < 3) {
  fail(`screenshots/ holds ${shotNames.length} image${shotNames.length === 1 ? '' : 's'}: hand in 3, the board, a detail view and a filtered view`);
}
if (shotNames.length > SHOT_MAX) fail(`screenshots/ holds ${shotNames.length} images, over the ${SHOT_MAX} the gate takes`);
for (const name of shotNames) {
  if (!SHOT_NAME.test(name)) fail(`screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters`);
  const bytes = readFileSync(join(outDir, 'screenshots', name));
  if (bytes.length > SHOT_MAX_BYTES) fail(`screenshots/${name} is ${bytes.length} bytes, over the ${SHOT_MAX_BYTES} the gate takes`);
  const isPng = PNG_MAGIC.every((b, i) => bytes[i] === b);
  const isJpeg = JPEG_MAGIC.every((b, i) => bytes[i] === b);
  if (!isPng && !isJpeg) fail(`screenshots/${name} is neither a whole PNG nor a whole JPEG`);
}

// The dossier is written last: the scorer rebuilds it from this /output and compares bytes.
writeFileSync(
  join(outDir, 'dossier.json'),
  buildDossier(outDir, { text_max_bytes: TEXT_CAP, screenshots: { max: SHOT_MAX, max_bytes: SHOT_MAX_BYTES }, dashboard: { max_files: 400, max_bytes: 4_194_304 } }),
);

process.stdout.write(
  `token radar: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} on the watchlist, ${board.length} rows scored (${radar.early_size} early, ${radar.live_size} live set aside)\n` +
    `token radar: wrote ${join(outDir, 'board.json')}, ${join(outDir, 'data.js')}, ${join(outDir, 'dashboard')} (${dashboardFiles.length} files), ${join(outDir, 'screenshots')} (${shotNames.length} images) and ${join(outDir, 'dossier.json')}\n`,
);
