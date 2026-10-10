import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { FLAParser } from '../../src/renderer/fla-import/parser-core/fla-parser';
import { decodeEdgesWithStyleChanges } from '../../src/renderer/fla-import/parser-core/edge-decoder';
import { vi } from 'vitest';

const fixedPointCases: Array<[string, number]> = [
  ['#000001.F0', 1.9375 / 20],
  ['#FFF086.FB', -3961.01953125 / 20],
  ['#000000.F0', 0.9375 / 20],
  ['#000001', 1 / 20],
  ['#FFF086', -3962 / 20],
];

class SyntheticElement {
  constructor(
    readonly tagName: string,
    private readonly attributes: Record<string, string> = {},
    readonly children: SyntheticElement[] = [],
  ) {}

  getAttribute(name: string): string | null {
    return this.attributes[name] ?? null;
  }

  querySelector(selector: string): SyntheticElement | null {
    return this.querySelectorAll(selector)[0] ?? null;
  }

  querySelectorAll(selector: string): SyntheticElement[] {
    const matches = new Set<SyntheticElement>();
    for (const group of selector.split(',')) {
      const directChildren = group.includes('>');
      const tags = group.split('>').map((part) => part.trim()).filter((part) => part && part !== ':scope');
      if (tags.length === 0) continue;

      if (!directChildren) {
        const visit = (element: SyntheticElement): void => {
          for (const child of element.children) {
            if (child.tagName === tags[0]) matches.add(child);
            visit(child);
          }
        };
        visit(this);
        continue;
      }

      let parents: SyntheticElement[] = [this];
      for (const tag of tags) {
        parents = parents.flatMap((parent) => parent.children.filter((child) => child.tagName === tag));
      }
      for (const element of parents) matches.add(element);
    }
    return [...matches];
  }
}

function morphDocument(coordinate: string): SyntheticElement {
  const segment = new SyntheticElement('MorphSegment', {
    startPointA: `${coordinate}, 0`,
    startPointB: `${coordinate}, 0`,
  });
  const morphShape = new SyntheticElement('MorphShape', {}, [
    new SyntheticElement('morphSegments', {}, [segment]),
  ]);
  const frame = new SyntheticElement('DOMFrame', { index: '0', tweenType: 'shape' }, [morphShape]);
  const layer = new SyntheticElement('DOMLayer', { name: 'Layer 1' }, [
    new SyntheticElement('frames', {}, [frame]),
  ]);
  const timeline = new SyntheticElement('DOMTimeline', { name: 'Scene 1' }, [
    new SyntheticElement('layers', {}, [layer]),
  ]);
  return new SyntheticElement('DOMDocument', { width: '8', height: '8', frameRate: '24' }, [
    new SyntheticElement('timelines', {}, [timeline]),
  ]);
}

async function parseMorphCoordinate(coordinate: string): Promise<number | undefined> {
  const zip = new JSZip();
  const xml = `<DOMDocument width="8" height="8" frameRate="24"><timelines><DOMTimeline name="Scene 1"><layers><DOMLayer name="Layer 1"><frames><DOMFrame index="0" tweenType="shape"><MorphShape><morphSegments><MorphSegment startPointA="${coordinate}, 0" startPointB="${coordinate}, 0"/></morphSegments></MorphShape></DOMFrame></frames></DOMLayer></layers></DOMTimeline></timelines></DOMDocument>`;
  zip.file('DOMDocument.xml', xml);
  const archive = await zip.generateAsync({ type: 'uint8array' });
  const fileBytes = Uint8Array.from(archive) as unknown as File;
  Object.defineProperties(fileBytes, {
    arrayBuffer: {
      value: async () => Uint8Array.from(archive).buffer,
    },
    slice: {
      value: (start: number, end: number) => {
        const bytes = Uint8Array.from(archive.subarray(start, end));
        return { arrayBuffer: async () => bytes.buffer };
      },
    },
  });

  const root = morphDocument(coordinate);
  vi.stubGlobal('DOMParser', class {
    parseFromString(source: string) {
      expect(source).toContain(`startPointA="${coordinate}, 0"`);
      return { documentElement: root };
    }
  });

  try {
    const document = await new FLAParser().parse(fileBytes);
    return document.timelines[0]?.layers[0]?.frames[0]?.morphShape?.segments[0]?.startPointA.x;
  } finally {
    vi.unstubAllGlobals();
  }
}

describe('XFL signed fixed-point coordinate decoding', () => {
  it.each(fixedPointCases)('decodes edge coordinate %s', (coordinate, expected) => {
    const { commands } = decodeEdgesWithStyleChanges(`!${coordinate} 0`);
    expect(commands[0]).toEqual({ type: 'M', x: expected, y: 0 });
  });

  it.each(fixedPointCases)('decodes morph coordinate %s', (coordinate, expected) => {
    return expect(parseMorphCoordinate(coordinate)).resolves.toBe(expected);
  });
});
