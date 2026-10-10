#!/usr/bin/env node
'use strict';

// Converts only the D-A stage Shape edge stream in an Animate-authored FLA
// from explicit return geometry to one Raw XFL close marker. The pre-patch FLA
// and manifest are preserved beside the fixture for review.

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const JSZip = require('jszip');

const REPOSITORY_ROOT = path.resolve(__dirname, '../..');
const DEFAULT_ROOT = 'D:\\PandaStage-Acceptance\\issue742-repair-contract-20261009-attempt03';
const EDGE_BEFORE = '!1900 1800|5300 1800!5300 1800|3600 4400!3600 4400|1900 1800';
const EDGE_AFTER = '!1900 1800|5300 1800|3600 4400/';

function parseArgs(argv) {
  const args = { root: DEFAULT_ROOT };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--root') args.root = argv[++index];
    else if (argv[index] === '--help' || argv[index] === '-h') args.help = true;
  }
  return args;
}

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex').toUpperCase();
}

function assertOutsideRepository(candidate) {
  const relative = path.relative(REPOSITORY_ROOT, candidate);
  assert.ok(relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative),
    `Issue #742 fixture root must remain outside the repository: ${candidate}`);
}

function countOccurrences(value, needle) {
  return value.split(needle).length - 1;
}

async function readArchiveEntries(zip) {
  const names = Object.keys(zip.files).filter(name => !zip.files[name].dir).sort();
  const contents = new Map();
  for (const name of names) contents.set(name, await zip.file(name).async('nodebuffer'));
  return { names, contents };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write('Usage: node scripts/research/issue742-xfl-close-marker-fixture.cjs [--root <external-dir>]\n');
    return;
  }

  const root = path.resolve(args.root);
  assertOutsideRepository(root);
  const fixturePath = path.join(root, 'fixtures', 'D-A-authored-close.fla');
  const backupPath = path.join(root, 'fixtures', 'D-A-authored-close-animate-created.fla');
  const manifestPath = path.join(root, 'authoring-manifest.json');
  const manifestBackupPath = path.join(root, 'authoring-manifest-animate-created.json');
  const temporaryFlaPath = `${fixturePath}.issue742-tmp`;
  const temporaryManifestPath = `${manifestPath}.issue742-tmp`;
  for (const candidate of [fixturePath, manifestPath]) {
    assert.ok(fs.existsSync(candidate), `Required Animate authoring output is missing: ${candidate}`);
  }
  assert.ok(!fs.existsSync(temporaryFlaPath), `Refusing to overwrite temporary FLA: ${temporaryFlaPath}`);
  assert.ok(!fs.existsSync(temporaryManifestPath), `Refusing to overwrite temporary manifest: ${temporaryManifestPath}`);
  assert.ok(!fs.existsSync(backupPath), `Refusing to overwrite pre-patch FLA backup: ${backupPath}`);
  assert.ok(!fs.existsSync(manifestBackupPath), `Refusing to overwrite pre-patch manifest backup: ${manifestBackupPath}`);

  const manifestBytes = fs.readFileSync(manifestPath);
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  assert.equal(manifest.issue, 742, 'Authoring manifest is not for Issue #742');
  const fixture = (manifest.fixtures || []).find(entry => entry.key === 'D-A-authored-close');
  assert.ok(fixture, 'Authoring manifest does not contain D-A-authored-close');
  assert.equal(fixture.fileName, 'D-A-authored-close.fla', 'D-A authoring filename differs from the minimal patch target');
  assert.equal(fixture.authoring?.status, 'CREATED_BY_ANIMATE', 'D-A was not first saved by Animate');
  assert.equal(fixture.authoring?.saveApiSucceeded, true, 'Animate did not report a successful D-A save');
  assert.equal(fixture.authoring?.fileExistsAfterSave, true, 'Animate-authored D-A FLA is missing on disk');
  assert.equal(fixture.authoring?.rawXflPatch, undefined, 'D-A already has a Raw XFL patch record');

  const originalFlaBytes = fs.readFileSync(fixturePath);
  const originalFlaSha256 = sha256(originalFlaBytes);
  const originalZip = await JSZip.loadAsync(originalFlaBytes);
  const originalEntries = await readArchiveEntries(originalZip);
  const domDocument = originalZip.file('DOMDocument.xml');
  assert.ok(domDocument, 'D-A FLA is missing DOMDocument.xml');
  const originalXml = await domDocument.async('string');
  const originalTaggedEdge = `<Edge fillStyle1="1" edges="${EDGE_BEFORE}"/>`;
  const patchedTaggedEdge = `<Edge fillStyle1="1" edges="${EDGE_AFTER}"/>`;
  assert.equal(countOccurrences(originalXml, originalTaggedEdge), 1,
    'D-A must contain exactly one Animate-authored target FillStyle1 edge stream');
  const patchedXml = originalXml.replace(originalTaggedEdge, patchedTaggedEdge);
  assert.notEqual(patchedXml, originalXml, 'D-A Raw XFL close-marker replacement changed no data');
  assert.equal(countOccurrences(patchedXml, patchedTaggedEdge), 1, 'D-A patched XFL edge stream is not unique');

  originalZip.file('DOMDocument.xml', patchedXml);
  const patchedFlaBytes = await originalZip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });
  const patchedZip = await JSZip.loadAsync(patchedFlaBytes);
  const patchedEntries = await readArchiveEntries(patchedZip);
  assert.deepEqual(patchedEntries.names, originalEntries.names, 'D-A patch changed the FLA archive member set');
  for (const entryName of originalEntries.names) {
    const expected = entryName === 'DOMDocument.xml'
      ? Buffer.from(patchedXml, 'utf8')
      : originalEntries.contents.get(entryName);
    assert.deepEqual(patchedEntries.contents.get(entryName), expected,
      `D-A patch unexpectedly changed FLA member ${entryName}`);
  }

  fs.writeFileSync(temporaryFlaPath, patchedFlaBytes, { flag: 'wx' });
  fs.renameSync(fixturePath, backupPath);
  try {
    fs.renameSync(temporaryFlaPath, fixturePath);
  } catch (error) {
    fs.renameSync(backupPath, fixturePath);
    throw error;
  }
  const finalFlaBytes = fs.readFileSync(fixturePath);
  const finalFlaSha256 = sha256(finalFlaBytes);
  assert.notEqual(finalFlaSha256, originalFlaSha256, 'D-A FLA SHA did not change after the recorded XFL edit');

  fixture.authoring.rawXflPatch = {
    applied: true,
    patcher: 'scripts/research/issue742-xfl-close-marker-fixture.cjs',
    method: 'one exact Edge@edges replacement in DOMDocument.xml',
    xflMember: 'DOMDocument.xml',
    edgeAttributeBefore: EDGE_BEFORE,
    edgeAttributeAfter: EDGE_AFTER,
    replacementOccurrences: 1,
    originalArchiveMemberCount: originalEntries.names.length,
    patchedArchiveMemberCount: patchedEntries.names.length,
    onlyDomDocumentXmlEntryChanged: true,
    sourceFlaSha256Before: originalFlaSha256,
    sourceFlaSha256After: finalFlaSha256,
    prePatchBackupPath: backupPath,
  };
  fs.writeFileSync(temporaryManifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
  fs.renameSync(manifestPath, manifestBackupPath);
  try {
    fs.renameSync(temporaryManifestPath, manifestPath);
  } catch (error) {
    fs.renameSync(manifestBackupPath, manifestPath);
    throw error;
  }

  process.stdout.write(`D-A Animate-created FLA preserved: ${backupPath}\n`);
  process.stdout.write(`D-A Raw XFL edges: ${EDGE_BEFORE}\n`);
  process.stdout.write(`D-A Raw XFL close fixture: ${EDGE_AFTER}\n`);
  process.stdout.write(`D-A patched FLA SHA-256: ${finalFlaSha256}\n`);
  process.stdout.write(`Changed only DOMDocument.xml among ${patchedEntries.names.length} archive members.\n`);
}

main().catch(error => {
  process.stderr.write(`${error.stack || String(error)}\n`);
  process.exitCode = 1;
});
