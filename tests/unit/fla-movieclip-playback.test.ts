import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import {
  buildRenderableTargetCatalog,
  buildSvgForRenderTarget,
  prepareFlaStaticSnapshotDisplaySource,
} from '../../src/main/services/fla-static-snapshot-svg-builder';

const clip = '<DOMSymbolInstance libraryItemName="Child" name="moving"/>';
const square = (color: string) => '<DOMShape><fills><FillStyle index="1">' +
  '<SolidColor color="' + color + '"/></FillStyle></fills>' +
  '<edges><Edge fillStyle1="1" edges="!0 0|200 0|200 200|0 200|0 0"/></edges></DOMShape>';
const frame = (index: number, elements: string, duration = 1) =>
  '<DOMFrame index="' + index + '" duration="' + duration + '"><elements>' + elements + '</elements></DOMFrame>';
const timeline = (frames: string) =>
  '<DOMTimeline name="Test"><layers><DOMLayer><frames>' + frames + '</frames></DOMLayer></layers></DOMTimeline>';

async function fixture(frames: string, scripted = false) {
  const zip = new JSZip();
  zip.file('DOMDocument.xml', '<DOMDocument width="160" height="120"><timelines>' +
    timeline(frames) + '</timelines></DOMDocument>');
  zip.file('LIBRARY/Child.xml', '<DOMSymbolItem name="Child"><timeline>' +
    timeline(frame(0, square('#ff0000')) + frame(1, square('#0000ff')) +
      frame(2, square('#00ff00'))) + '</timeline>' +
    (scripted ? '<Actionscript><script><![CDATA[stop();]]></script></Actionscript>' : '') + '</DOMSymbolItem>');
  const bytes = await zip.generateAsync({ type: 'uint8array' });
  const prepared = await prepareFlaStaticSnapshotDisplaySource(bytes, 'preview');
  if (!prepared.ok) throw new Error(prepared.message);
  const catalog = await buildRenderableTargetCatalog(bytes, undefined, {}, prepared.source);
  if (!catalog.ok) throw new Error(catalog.message);
  const scene = catalog.entries.find((entry) => entry.target.kind === 'scene');
  if (!scene || !scene.previewSupported) throw new Error(scene?.unsupportedReason ?? 'Missing scene');
  return {
    authoredFrameCount: prepared.source.sceneTimelines[0]?.frameCount,
    playbackFrameCount: scene.target.frameCount,
    async render(selectedFrameIndex: number) {
      const result = await buildSvgForRenderTarget(bytes, { ...scene.target, selectedFrameIndex }, undefined, prepared.source);
      if (!result.ok) throw new Error(result.message);
      return result.svg;
    },
  };
}

describe('FLA MovieClip playback sampling', () => {
  it('keeps the authored scene on frame zero while the child advances on seek', async () => {
    const movie = await fixture(frame(0, clip));
    expect(movie.authoredFrameCount).toBe(1);
    expect(movie.playbackFrameCount).toBe(3);
    expect(await movie.render(2)).toContain('fill="#00ff00"');
    expect(await movie.render(0)).toContain('fill="#ff0000"');
    expect(await movie.render(1)).toContain('fill="#0000ff"');
    expect(await movie.render(2)).toContain('fill="#00ff00"');
  });

  it('preserves the instance clock across held frames and keyframes, then restarts after a gap', async () => {
    const movie = await fixture(frame(0, clip, 2) + frame(2, clip) + frame(3, '') + frame(4, clip, 2));
    expect(movie.playbackFrameCount).toBe(6);
    expect(await movie.render(5)).toContain('fill="#0000ff"');
    expect(await movie.render(2)).toContain('fill="#00ff00"');
    expect(await movie.render(4)).toContain('fill="#ff0000"');
    expect(await movie.render(1)).toContain('fill="#0000ff"');
  });

  it('holds a scripted MovieClip locally without preventing the scene from advancing', async () => {
    const movie = await fixture(frame(0, clip, 2) + frame(2, square('#ffaa00')), true);
    expect(await movie.render(1)).toContain('fill="#ff0000"');
    expect(await movie.render(2)).toContain('fill="#ffaa00"');
  });
});

interface SymbolFixtureSpec {
  readonly name: string;
  readonly symbolType?: string;
  readonly layers: readonly string[];
}

const scriptFrame = (index: number, elements: string, script?: string, duration = 1) =>
  `<DOMFrame index="${index}" duration="${duration}">` +
  (script !== undefined
    ? `<Actionscript><script><![CDATA[${script}]]></script></Actionscript>`
    : '') +
  `<elements>${elements}</elements></DOMFrame>`;

const layer = (frames: string, attrs = '') =>
  `<DOMLayer${attrs ? ` ${attrs}` : ''}><frames>${frames}</frames></DOMLayer>`;

const multiLayerTimeline = (layers: readonly string[]) =>
  `<DOMTimeline name="Test"><layers>${layers.join('')}</layers></DOMTimeline>`;

async function buildSceneFixture(sceneLayers: readonly string[], symbols: readonly SymbolFixtureSpec[]) {
  const zip = new JSZip();
  zip.file(
    'DOMDocument.xml',
    `<DOMDocument width="200" height="120" frameRate="24"><timelines>${multiLayerTimeline(sceneLayers)}</timelines></DOMDocument>`,
  );
  for (const sym of symbols) {
    const typeAttr = sym.symbolType ? ` symbolType="${sym.symbolType}"` : '';
    zip.file(
      `LIBRARY/${sym.name}.xml`,
      `<DOMSymbolItem name="${sym.name}"${typeAttr}><timeline>${multiLayerTimeline(sym.layers)}</timeline></DOMSymbolItem>`,
    );
  }
  const bytes = await zip.generateAsync({ type: 'uint8array' });
  const prepared = await prepareFlaStaticSnapshotDisplaySource(bytes, 'preview');
  if (!prepared.ok) throw new Error(prepared.message);
  const catalog = await buildRenderableTargetCatalog(bytes, undefined, {}, prepared.source);
  if (!catalog.ok) throw new Error(catalog.message);
  const scene = catalog.entries.find((entry) => entry.target.kind === 'scene');
  if (!scene || !scene.previewSupported) throw new Error(scene?.unsupportedReason ?? 'Missing scene');
  return {
    source: prepared.source,
    authoredFrameCount: prepared.source.sceneTimelines[0]?.frameCount,
    playbackFrameCount: scene.target.frameCount,
    async render(selectedFrameIndex: number) {
      const result = await buildSvgForRenderTarget(
        bytes,
        { ...scene.target, selectedFrameIndex },
        undefined,
        prepared.source,
      );
      if (!result.ok) throw new Error(result.message);
      return result.svg;
    },
  };
}

const fourPoseLayers = (actionsFrames: string, actionsLayerAttrs = 'name="actions"') => [
  layer(actionsFrames, actionsLayerAttrs),
  layer(
    scriptFrame(0, square('#e11d48')) +
      scriptFrame(1, square('#2563eb')) +
      scriptFrame(2, square('#16a34a')) +
      scriptFrame(3, square('#f59e0b')),
    'name="art"',
  ),
];

describe('FLA MovieClip deterministic stop() fidelity (#1257)', () => {
  it('plays a 4-pose MovieClip with terminal stop() from frame 0, then holds on frame 3', async () => {
    const movie = await buildSceneFixture(
      [layer(scriptFrame(0, '<DOMSymbolInstance libraryItemName="HeroMC" name="hero"/>', undefined, 7))],
      [
        {
          name: 'HeroMC',
          layers: fourPoseLayers(
            scriptFrame(0, '', undefined, 3) + scriptFrame(3, '', 'stop();'),
          ),
        },
      ],
    );

    expect(movie.source.movieClipSymbols?.get('HeroMC')?.movieClipStopFrames).toEqual([3]);
    expect(movie.source.movieClipSymbols?.get('HeroMC')?.movieClipHasScript).toBeUndefined();
    expect(movie.playbackFrameCount).toBe(7);

    // Out-of-order and forward seek: 0 -> red, 1 -> blue, 2 -> green, 3..6 -> amber (held)
    expect(await movie.render(5)).toContain('fill="#f59e0b"');
    expect(await movie.render(0)).toContain('fill="#e11d48"');
    expect(await movie.render(1)).toContain('fill="#2563eb"');
    expect(await movie.render(2)).toContain('fill="#16a34a"');
    expect(await movie.render(3)).toContain('fill="#f59e0b"');
    expect(await movie.render(6)).toContain('fill="#f59e0b"');
  });

  it('supports this.stop(), hidden actions layers, frame-0 stop, and earliest of multiple stop frames', async () => {
    const frame0Stop = await buildSceneFixture(
      [layer(scriptFrame(0, '<DOMSymbolInstance libraryItemName="FirstStop" name="a"/>', undefined, 4))],
      [
        {
          name: 'FirstStop',
          layers: fourPoseLayers(scriptFrame(0, '', 'this.stop();', 4), 'name="actions" visible="false"'),
        },
      ],
    );
    expect(frame0Stop.source.movieClipSymbols?.get('FirstStop')?.movieClipStopFrames).toEqual([0]);
    expect(await frame0Stop.render(0)).toContain('fill="#e11d48"');
    expect(await frame0Stop.render(3)).toContain('fill="#e11d48"');

    const multiStop = await buildSceneFixture(
      [layer(scriptFrame(0, '<DOMSymbolInstance libraryItemName="MultiStop" name="b"/>', undefined, 5))],
      [
        {
          name: 'MultiStop',
          layers: fourPoseLayers(
            scriptFrame(0, '') +
              scriptFrame(1, '', 'this.stop();') +
              scriptFrame(2, '') +
              scriptFrame(3, '', 'stop();'),
            'name="actions" visible="false"',
          ),
        },
      ],
    );
    expect(multiStop.source.movieClipSymbols?.get('MultiStop')?.movieClipStopFrames).toEqual([1, 3]);
    expect(await multiStop.render(0)).toContain('fill="#e11d48"');
    expect(await multiStop.render(1)).toContain('fill="#2563eb"');
    expect(await multiStop.render(2)).toContain('fill="#2563eb"');
    expect(await multiStop.render(4)).toContain('fill="#2563eb"');
  });

  it('does not freeze MovieClips with empty, comment-only, or literal trace scripts', async () => {
    const movie = await buildSceneFixture(
      [layer(scriptFrame(0, '<DOMSymbolInstance libraryItemName="HarmlessMC" name="h"/>', undefined, 6))],
      [
        {
          name: 'HarmlessMC',
          layers: fourPoseLayers(
            scriptFrame(0, '', '  ') +
              scriptFrame(1, '', '// stop();') +
              scriptFrame(2, '', '/* this.stop(); */') +
              scriptFrame(3, '', 'trace("stop()", 3);'),
          ),
        },
      ],
    );

    expect(movie.source.movieClipSymbols?.get('HarmlessMC')?.movieClipHasScript).toBeUndefined();
    expect(movie.source.movieClipSymbols?.get('HarmlessMC')?.movieClipStopFrames).toBeUndefined();
    // Loops 0 -> 1 -> 2 -> 3 -> 0 -> 1
    expect(await movie.render(0)).toContain('fill="#e11d48"');
    expect(await movie.render(3)).toContain('fill="#f59e0b"');
    expect(await movie.render(4)).toContain('fill="#e11d48"');
    expect(await movie.render(5)).toContain('fill="#2563eb"');
  });

  it('conservatively falls back on conditional, jump, external, function-body, and mixed scripts without affecting siblings', async () => {
    const cases: readonly { readonly name: string; readonly script0?: string; readonly script2: string }[] = [
      { name: 'FnBodyMC', script2: 'function done() { stop(); }' },
      { name: 'OtherStopMC', script2: 'other.stop();' },
      { name: 'CondStopMC', script2: 'if (ready) { stop(); }' },
      { name: 'GotoStopMC', script2: 'gotoAndStop(2);' },
      { name: 'MixedMC', script0: 'gotoAndPlay(2);', script2: 'stop();' },
    ];

    for (const tc of cases) {
      const movie = await buildSceneFixture(
        [
          layer(scriptFrame(0, `<DOMSymbolInstance libraryItemName="${tc.name}" name="bad"/>`, undefined, 4)),
          layer(scriptFrame(0, '<DOMSymbolInstance libraryItemName="GoodMC" name="good"/>', undefined, 4)),
        ],
        [
          {
            name: tc.name,
            layers: fourPoseLayers(
              scriptFrame(0, '', tc.script0 ?? '', 2) + scriptFrame(2, '', tc.script2, 2),
            ),
          },
          {
            name: 'GoodMC',
            layers: [
              layer(
                scriptFrame(0, square('#111111')) +
                  scriptFrame(1, square('#222222')) +
                  scriptFrame(2, square('#333333'), 'stop();'),
              ),
            ],
          },
        ],
      );

      expect(movie.source.movieClipSymbols?.get(tc.name)?.movieClipHasScript).toBe(true);
      expect(movie.source.movieClipSymbols?.get(tc.name)?.movieClipStopFrames).toBeUndefined();
      // Bad MC is held at frame 0 (#e11d48), while sibling GoodMC plays to frame 2 (#333333) and holds
      const f2 = await movie.render(2);
      expect(f2).toContain('fill="#e11d48"');
      expect(f2).toContain('fill="#333333"');
      const f3 = await movie.render(3);
      expect(f3).toContain('fill="#e11d48"');
      expect(f3).toContain('fill="#333333"');
    }
  });

  it('plays staggered instances independently and restarts cleanly after a gap', async () => {
    const movie = await buildSceneFixture(
      [
        layer(
          scriptFrame(0, '<DOMSymbolInstance libraryItemName="StopMC" name="first"/>', undefined, 4) +
            scriptFrame(4, '') +
            scriptFrame(5, '<DOMSymbolInstance libraryItemName="StopMC" name="first"/>', undefined, 3),
          'name="layerA"',
        ),
        layer(
          scriptFrame(0, '', undefined, 2) +
            scriptFrame(2, '<DOMSymbolInstance libraryItemName="StopMC" name="second"/>', undefined, 6),
          'name="layerB"',
        ),
      ],
      [
        {
          name: 'StopMC',
          layers: [
            layer(
              scriptFrame(0, square('#aa0000')) +
                scriptFrame(1, square('#00aa00')) +
                scriptFrame(2, square('#0000aa'), 'stop();'),
            ),
          ],
        },
      ],
    );

    // Frame 2: first reaches stop (#0000aa), second just appeared (#aa0000)
    const f2 = await movie.render(2);
    expect(f2).toContain('fill="#0000aa"');
    expect(f2).toContain('fill="#aa0000"');

    // Frame 3: first holds (#0000aa), second is at frame 1 (#00aa00)
    const f3 = await movie.render(3);
    expect(f3).toContain('fill="#0000aa"');
    expect(f3).toContain('fill="#00aa00"');

    // Frame 5: first reappeared after gap at frame 0 (#aa0000), second holds at frame 2 (#0000aa)
    const f5 = await movie.render(5);
    expect(f5).toContain('fill="#aa0000"');
    expect(f5).toContain('fill="#0000aa"');
  });

  it('keeps nested independent MovieClip advancing while stopped parent holds, and keeps nested Graphic locked to parent frame', async () => {
    const movie = await buildSceneFixture(
      [layer(scriptFrame(0, '<DOMSymbolInstance libraryItemName="ParentMC" name="parent"/>', undefined, 7))],
      [
        {
          name: 'ParentMC',
          layers: [
            layer(scriptFrame(0, '', undefined, 2) + scriptFrame(2, '', 'stop();'), 'name="actions"'),
            layer(
              scriptFrame(
                0,
                '<DOMSymbolInstance libraryItemName="ChildLoopMC" name="childMc"/>' +
                  '<DOMSymbolInstance libraryItemName="ChildGfx" symbolType="graphic" loop="loop"/>',
                undefined,
                3,
              ),
              'name="content"',
            ),
          ],
        },
        {
          name: 'ChildLoopMC',
          layers: [
            layer(
              scriptFrame(0, square('#101010')) +
                scriptFrame(1, square('#202020')) +
                scriptFrame(2, square('#303030')) +
                scriptFrame(3, square('#404040')),
            ),
          ],
        },
        {
          name: 'ChildGfx',
          symbolType: 'graphic',
          layers: [
            layer(
              scriptFrame(0, square('#a10000')) +
                scriptFrame(1, square('#a20000')) +
                scriptFrame(2, square('#a30000')) +
                scriptFrame(3, square('#a40000')),
            ),
          ],
        },
      ],
    );

    // Out-of-order seek to frame 4: ParentMC stopped at frame 2 -> ChildGfx stays at #a30000,
    // while ChildLoopMC has age 4 -> 4 % 4 = 0 (#101010)
    const f4 = await movie.render(4);
    expect(f4).toContain('fill="#a30000"');
    expect(f4).toContain('fill="#101010"');

    // Frame 5: ParentMC still stopped at 2 -> ChildGfx stays at #a30000, ChildLoopMC advances to 5 % 4 = 1 (#202020)
    const f5 = await movie.render(5);
    expect(f5).toContain('fill="#a30000"');
    expect(f5).toContain('fill="#202020"');

    // Frame 1: ParentMC at 1 -> ChildGfx at #a20000, ChildLoopMC at 1 (#202020)
    const f1 = await movie.render(1);
    expect(f1).toContain('fill="#a20000"');
    expect(f1).toContain('fill="#202020"');
  });

  it('expands single-authored-scene-frame playback count to reach deterministic stop frames', async () => {
    const terminalStopScene = await buildSceneFixture(
      [layer(scriptFrame(0, '<DOMSymbolInstance libraryItemName="HeroMC" name="hero"/>'))],
      [
        {
          name: 'HeroMC',
          layers: fourPoseLayers(scriptFrame(0, '', undefined, 3) + scriptFrame(3, '', 'stop();')),
        },
      ],
    );

    expect(terminalStopScene.authoredFrameCount).toBe(1);
    expect(terminalStopScene.playbackFrameCount).toBe(4);
    expect(await terminalStopScene.render(0)).toContain('fill="#e11d48"');
    expect(await terminalStopScene.render(2)).toContain('fill="#16a34a"');
    expect(await terminalStopScene.render(3)).toContain('fill="#f59e0b"');

    const earlyStopScene = await buildSceneFixture(
      [layer(scriptFrame(0, '<DOMSymbolInstance libraryItemName="EarlyMC" name="early"/>'))],
      [
        {
          name: 'EarlyMC',
          layers: fourPoseLayers(
            scriptFrame(0, '', undefined, 2) + scriptFrame(2, '', 'stop();', 2),
          ),
        },
      ],
    );

    expect(earlyStopScene.authoredFrameCount).toBe(1);
    expect(earlyStopScene.playbackFrameCount).toBe(3);
    expect(await earlyStopScene.render(2)).toContain('fill="#16a34a"');
  });

  it('expands single-authored-scene-frame playback count for an independent looping child inside a frame-0 stopped parent (#1259)', async () => {
    const movie = await buildSceneFixture(
      [layer(scriptFrame(0, '<DOMSymbolInstance libraryItemName="StoppedParent" name="parent"/>'))],
      [
        {
          name: 'StoppedParent',
          layers: [
            layer(scriptFrame(0, '', 'stop();', 2), 'name="actions"'),
            layer(
              scriptFrame(0, square('#111111') + '<DOMSymbolInstance libraryItemName="FanChild" name="fan"/>') +
                scriptFrame(1, square('#999999') + '<DOMSymbolInstance libraryItemName="FanChild" name="fan"/>'),
              'name="content"',
            ),
          ],
        },
        {
          name: 'FanChild',
          layers: [
            layer(
              scriptFrame(0, square('#e11d48')) +
                scriptFrame(1, square('#2563eb')) +
                scriptFrame(2, square('#16a34a')) +
                scriptFrame(3, square('#f59e0b')),
            ),
          ],
        },
      ],
    );

    expect(movie.authoredFrameCount).toBe(1);
    expect(movie.playbackFrameCount).toBe(4);

    // Out-of-order seek across 0..3: parent stays on frame 0 (#111111), child plays all 4 frames
    const f3 = await movie.render(3);
    expect(f3).toContain('fill="#111111"');
    expect(f3).toContain('fill="#f59e0b"');
    const f0 = await movie.render(0);
    expect(f0).toContain('fill="#111111"');
    expect(f0).toContain('fill="#e11d48"');
    const f2 = await movie.render(2);
    expect(f2).toContain('fill="#111111"');
    expect(f2).toContain('fill="#16a34a"');
    const f1 = await movie.render(1);
    expect(f1).toContain('fill="#111111"');
    expect(f1).toContain('fill="#2563eb"');
  });

  it('covers delayed looping child and locked Graphic on a non-zero stop frame without advancing Graphic (#1259)', async () => {
    const movie = await buildSceneFixture(
      [layer(scriptFrame(0, '<DOMSymbolInstance libraryItemName="ParentStop2" name="parent"/>'))],
      [
        {
          name: 'ParentStop2',
          layers: [
            layer(scriptFrame(0, '', undefined, 2) + scriptFrame(2, '', 'stop();'), 'name="actions"'),
            layer(
              scriptFrame(0, '<DOMSymbolInstance libraryItemName="LockedGfx" symbolType="graphic" loop="loop"/>', undefined, 3),
              'name="gfx"',
            ),
            layer(
              scriptFrame(0, '', undefined, 2) +
                scriptFrame(2, '<DOMSymbolInstance libraryItemName="DelayedFan" name="fan"/>'),
              'name="fan"',
            ),
          ],
        },
        {
          name: 'DelayedFan',
          layers: [
            layer(
              scriptFrame(0, square('#e11d48')) +
                scriptFrame(1, square('#2563eb')) +
                scriptFrame(2, square('#16a34a')) +
                scriptFrame(3, square('#f59e0b')),
            ),
          ],
        },
        {
          name: 'LockedGfx',
          symbolType: 'graphic',
          layers: [
            layer(
              scriptFrame(0, square('#a10000')) +
                scriptFrame(1, square('#a20000')) +
                scriptFrame(2, square('#a30000')) +
                scriptFrame(3, square('#a40000')) +
                scriptFrame(4, square('#a50000')) +
                scriptFrame(5, square('#a60000')) +
                scriptFrame(6, square('#a70000')),
            ),
          ],
        },
      ],
    );

    // Parent stops at frame 2; DelayedFan appears at tick 2 and loops 4 frames -> 2 + 4 = 6 (NOT 7 from LockedGfx)
    expect(movie.authoredFrameCount).toBe(1);
    expect(movie.playbackFrameCount).toBe(6);

    // Frame 1: LockedGfx at #a20000, DelayedFan not yet present
    const f1 = await movie.render(1);
    expect(f1).toContain('fill="#a20000"');
    expect(f1).not.toContain('fill="#e11d48"');

    // Frame 2: Parent stops at 2 -> LockedGfx locks at #a30000, DelayedFan starts at frame 0 (#e11d48)
    const f2 = await movie.render(2);
    expect(f2).toContain('fill="#a30000"');
    expect(f2).toContain('fill="#e11d48"');

    // Frame 5 (out-of-order): LockedGfx STILL locked at #a30000 (not #a60000), DelayedFan reaches frame 3 (#f59e0b)
    const f5 = await movie.render(5);
    expect(f5).toContain('fill="#a30000"');
    expect(f5).not.toContain('fill="#a60000"');
    expect(f5).toContain('fill="#f59e0b"');
  });

  it('bounds delayed stopped child to its reachable stop frame and ignores disappeared, hidden, or unsupported children (#1259)', async () => {
    // Delayed child with 5 frames stopping at frame 1 on parent stop frame 2 -> 2 + (1 + 1) = 4
    const delayedStopChild = await buildSceneFixture(
      [layer(scriptFrame(0, '<DOMSymbolInstance libraryItemName="ParentA" name="p"/>'))],
      [
        {
          name: 'ParentA',
          layers: [
            layer(scriptFrame(0, '', undefined, 2) + scriptFrame(2, '', 'stop();'), 'name="actions"'),
            layer(
              scriptFrame(0, '', undefined, 2) +
                scriptFrame(2, '<DOMSymbolInstance libraryItemName="ChildStop1" name="c"/>'),
              'name="child"',
            ),
          ],
        },
        {
          name: 'ChildStop1',
          layers: [
            layer(scriptFrame(0, '') + scriptFrame(1, '', 'stop();', 4), 'name="actions"'),
            layer(
              scriptFrame(0, square('#110000')) +
                scriptFrame(1, square('#220000')) +
                scriptFrame(2, square('#330000')) +
                scriptFrame(3, square('#440000')) +
                scriptFrame(4, square('#550000')),
              'name="art"',
            ),
          ],
        },
      ],
    );
    expect(delayedStopChild.playbackFrameCount).toBe(4);
    expect(await delayedStopChild.render(2)).toContain('fill="#110000"');
    expect(await delayedStopChild.render(3)).toContain('fill="#220000"');

    // Disappeared child (only on frame 0), hidden child, and unsupported-script child must NOT inflate length past 3
    const nonInflating = await buildSceneFixture(
      [layer(scriptFrame(0, '<DOMSymbolInstance libraryItemName="ParentB" name="p"/>'))],
      [
        {
          name: 'ParentB',
          layers: [
            layer(scriptFrame(0, '', undefined, 2) + scriptFrame(2, '', 'stop();'), 'name="actions"'),
            layer(
              scriptFrame(0, '<DOMSymbolInstance libraryItemName="LongLoop" name="gone"/>') +
                scriptFrame(1, '', undefined, 2),
              'name="disappeared"',
            ),
            layer(
              scriptFrame(0, '<DOMSymbolInstance libraryItemName="LongLoop" name="hidden"/>', undefined, 3),
              'name="hiddenLayer" visible="false"',
            ),
            layer(
              scriptFrame(0, '<DOMSymbolInstance libraryItemName="BadScriptChild" name="bad"/>', undefined, 3),
              'name="badChild"',
            ),
          ],
        },
        {
          name: 'LongLoop',
          layers: [
            layer(
              scriptFrame(0, square('#010101'), undefined, 10),
            ),
          ],
        },
        {
          name: 'BadScriptChild',
          layers: [
            layer(scriptFrame(0, square('#020202'), 'if (x) stop();', 8)),
          ],
        },
      ],
    );
    expect(nonInflating.playbackFrameCount).toBe(3);
  });
});
