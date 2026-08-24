import JSZip from 'jszip';

const SIMPLE_RECT_CUBICS = '!0 0|100 0|100 100|0 100|0 0';

/**
 * Repo-safe multi-frame FLA/XFL fixture for the R2 identity bridge tests.
 * It contains one graphic-symbol target with two renderable timeline frames;
 * no private or licensed source bytes are used.
 */
export async function buildMultiFrameGraphicFla(): Promise<Uint8Array> {
  const zip = new JSZip();
  const symbolName = 'r2-multi-frame-fixture';
  const docXml = `<?xml version="1.0" encoding="UTF-8"?>
<DOMDocument xmlns="http://ns.adobe.com/xfl/2008/" width="550" height="400" frameRate="24">
  <timelines>
    <DOMTimeline name="scene1">
      <layers>
        <DOMLayer name="layer1">
          <frames>
            <DOMFrame index="0">
              <elements>
                <DOMSymbolInstance libraryItemName="${symbolName}">
                  <matrix a="1" d="1" tx="0" ty="0"/>
                </DOMSymbolInstance>
              </elements>
            </DOMFrame>
          </frames>
        </DOMLayer>
      </layers>
    </DOMTimeline>
  </timelines>
</DOMDocument>`;
  zip.file('DOMDocument.xml', docXml);

  const frames = [0, 1].map((frameIndex) => `<DOMFrame index="${frameIndex}">
              <DOMGroup>
                <matrix><Matrix a="2" d="2" tx="${10 + frameIndex}" ty="20"/></matrix>
                <members>
                  <DOMShape>
                    <matrix><Matrix a="1" d="1" tx="0" ty="0"/></matrix>
                    <fills>
                      <FillStyle index="1"><SolidColor color="#336699" alpha="1"/></FillStyle>
                    </fills>
                    <strokes/>
                    <edges>
                      <Edge cubics="${SIMPLE_RECT_CUBICS}"/>
                    </edges>
                  </DOMShape>
                </members>
              </DOMGroup>
            </DOMFrame>`).join('\n            ');
  const libXml = `<?xml version="1.0" encoding="UTF-8"?>
<DOMSymbolItem xmlns="http://ns.adobe.com/xfl/2008/" name="${symbolName}" symbolType="graphic">
  <timeline>
    <DOMTimeline name="symbolTimeline">
      <layers>
        <DOMLayer name="symbolLayer">
          <frames>
            ${frames}
          </frames>
        </DOMLayer>
      </layers>
    </DOMTimeline>
  </timeline>
</DOMSymbolItem>`;
  zip.file(`LIBRARY/${symbolName}.xml`, libXml);
  return zip.generateAsync({ type: 'uint8array' });
}
