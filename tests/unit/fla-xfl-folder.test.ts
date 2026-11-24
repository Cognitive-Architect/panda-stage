import { mkdir, mkdtemp, rm, symlink, truncate, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import JSZip from 'jszip';
import { afterEach, describe, expect, it } from 'vitest';
import { preflightFlaSource, readFlaSourceBytes } from '../../src/main/services/fla-import-preflight-service';
import { buildRenderableTargetCatalog, buildSvgForRenderTarget } from '../../src/main/services/fla-static-snapshot-svg-builder';
import { FLA_IMPORT_LIMITS } from '../../src/shared/fla-import-api';

const folders: string[] = [];
afterEach(async () => {
  await Promise.all(folders.splice(0).map((folder) => rm(folder, { recursive: true, force: true })));
});

async function project() {
  const parent = await mkdtemp(join(tmpdir(), 'panda-xfl-'));
  folders.push(parent);
  const root = join(parent, '样片');
  await mkdir(join(root, 'LIBRARY'), { recursive: true });
  const shapes = '<DOMShape><fills><FillStyle index="1"><SolidColor color="#00FF00"/></FillStyle></fills>' +
    '<edges><Edge fillStyle1="1" cubics="!0 0|400 0|400 400|0 400|0 0"/></edges></DOMShape>';
  const timeline = (name: string, display: string) => '<DOMTimeline name="' + name + '"><layers><DOMLayer><frames>' +
    '<DOMFrame index="0"><elements>' + display + '</elements></DOMFrame></frames></DOMLayer></layers></DOMTimeline>';
  const instance = (name: string) => '<DOMSymbolInstance libraryItemName="' + name + '" symbolType="graphic"/>';
  const symbol = (name: string, display: string) =>
    '<DOMSymbolItem name="' + name + '" symbolType="graphic"><timeline>' + timeline(name, display) + '</timeline></DOMSymbolItem>';
  const document = '<DOMDocument width="100" height="80" frameRate="24"><symbols><Include href="子元件.xml"/>' +
    '<Include href="元件.xml"/></symbols><timelines>' + timeline('场景', instance('元件')) + '</timelines></DOMDocument>';
  const entries = {
    'DOMDocument.xml': document,
    'LIBRARY/元件.xml': symbol('元件', instance('子元件')),
    'LIBRARY/子元件.xml': symbol('子元件', shapes),
    '样片.xfl': 'PROXY-CS5',
  };
  for (const [name, data] of Object.entries(entries)) await writeFile(join(root, name), data);
  return { root, parent, entries, stub: join(root, '样片.xfl') };
}

describe('uncompressed Animate XFL input', () => {
  it('opens a folder and its stub with the archive catalog and equivalent nested Chinese vector content', async () => {
    const { root, parent, stub, entries } = await project();
    const zip = new JSZip();
    for (const [name, data] of Object.entries(entries)) zip.file(name, data, { createFolders: false });
    const packed = join(parent, 'same.fla');
    await writeFile(packed, await zip.generateAsync({ type: 'nodebuffer' }));
    const [folder, proxy, archive] = await Promise.all([root, stub, packed].map((path) => preflightFlaSource(path)));
    expect(folder?.sha256).toEqual(proxy?.sha256);
    expect(folder?.basename).toBe('样片.xfl');
    expect(folder?.sha256).not.toEqual(archive?.sha256);
    const render = async (bytes: Uint8Array) => {
      const catalog = await buildRenderableTargetCatalog(bytes);
      if (!catalog.ok) throw new Error(catalog.message);
      const entries = catalog.entries.filter((entry) => entry.previewSupported);
      expect(entries.map(({ target }) => target.userLabel)).toEqual(expect.arrayContaining(['元件', '子元件']));
      const scene = entries.find(({ target }) => target.kind === 'scene')!;
      const svg = await buildSvgForRenderTarget(bytes, scene.target);
      if (!svg.ok) throw new Error(svg.message);
      return {
        entries: entries.map(({ target }) => [target.userLabel, target.frameCount, target.selectedFrameIndex]),
        svg: svg.svg,
      };
    };
    expect(await render(folder!.bytes)).toEqual(await render(archive!.bytes));
    await writeFile(join(root, 'LIBRARY/子元件.xml'), entries['LIBRARY/子元件.xml'].replace('#00FF00', '#FF0000'));
    const updated = await readFlaSourceBytes(root);
    expect(updated.sha256).not.toEqual(folder?.sha256);
    expect((await render(folder!.bytes)).svg.toUpperCase()).toContain('#00FF00');
    expect((await render(updated.bytes)).svg.toUpperCase()).toContain('#FF0000');
  });

  it('rejects invalid stubs, missing or nested roots and archive-internal reference escapes', async () => {
    const { root, parent, stub, entries } = await project();
    await writeFile(stub, 'not a proxy');
    await expect(readFlaSourceBytes(stub)).rejects.toMatchObject({ code: 'MALFORMED_XFL', message: expect.stringContaining('stub') });
    await expect(readFlaSourceBytes(parent)).rejects.toMatchObject({ code: 'MALFORMED_XFL', message: expect.stringContaining('DOMDocument.xml') });
    const empty = join(parent, 'empty');
    await mkdir(empty);
    await expect(readFlaSourceBytes(empty)).rejects.toMatchObject({ code: 'MALFORMED_XFL', message: expect.stringContaining('DOMDocument.xml') });
    await writeFile(join(root, 'DOMDocument.xml'), entries['DOMDocument.xml'].replace('href="子元件.xml"', 'href="&#46;&#46;/outside.xml"'));
    await expect(readFlaSourceBytes(root)).rejects.toMatchObject({ code: 'MALFORMED_XFL', message: expect.stringContaining('outside') });
  });

  it('rejects conflicting names after Unicode and case normalization', async () => {
    const { root } = await project();
    await writeFile(join(root, 'LIBRARY', 'A.xml'), '<DOMSymbolItem/>');
    await writeFile(join(root, 'LIBRARY', 'Ａ.xml'), '<DOMSymbolItem/>');
    await expect(readFlaSourceBytes(root)).rejects.toMatchObject({
      code: 'MALFORMED_XFL', message: expect.stringContaining('conflicting filenames'),
    });
  });

  it('rejects redirected directories and bounded files, and honours cancellation', async () => {
    const { root, parent } = await project();
    const linked = join(root, 'Redirect');
    await symlink(parent, linked, process.platform === 'win32' ? 'junction' : 'dir');
    await expect(readFlaSourceBytes(root)).rejects.toMatchObject({ code: 'MALFORMED_XFL', message: expect.stringContaining('linked') });
    await rm(linked, { force: true });
    const oversized = join(root, 'oversized.dat');
    await writeFile(oversized, '');
    await truncate(oversized, FLA_IMPORT_LIMITS.maxSingleEntryBytes + 1);
    await expect(readFlaSourceBytes(root)).rejects.toMatchObject({ code: 'ARCHIVE_LIMIT_EXCEEDED' });
    const cancel = new AbortController();
    cancel.abort();
    await expect(readFlaSourceBytes(root, cancel.signal)).rejects.toMatchObject({ code: 'USER_CANCELLED' });
  });
});
