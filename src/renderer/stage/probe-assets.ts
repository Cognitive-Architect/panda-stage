import {
  PROBE_BACKGROUND_ASSET_ID,
  PROBE_CHARACTER_ASSET_ID,
} from '../../shared/probe/probe-project';
import { BFM_S08_PROBE_IDS } from '../../shared/probe/bfm-s08-project';
import type { StageAssetUrlMap } from '../../shared/stage/render-model';

function publicAssetUrl(relativePath: string): string {
  return new URL(relativePath, document.baseURI).href;
}

export const PROBE_ASSET_URLS: StageAssetUrlMap = Object.freeze({
  [PROBE_BACKGROUND_ASSET_ID]: publicAssetUrl('probe/stage-background.svg'),
  [PROBE_CHARACTER_ASSET_ID]: publicAssetUrl('probe/panda-character.png'),
});

export const BFM_S08_PROBE_ASSET_URLS: StageAssetUrlMap = Object.freeze({
  [BFM_S08_PROBE_IDS.bodyAsset]: publicAssetUrl('probe/bfm-s08-body.svg'),
  [BFM_S08_PROBE_IDS.faceNormalAsset]: publicAssetUrl(
    'probe/bfm-s08-face-normal.svg',
  ),
  [BFM_S08_PROBE_IDS.faceAngryAsset]: publicAssetUrl(
    'probe/bfm-s08-face-angry.svg',
  ),
  [BFM_S08_PROBE_IDS.mouthAsset]: publicAssetUrl('probe/bfm-s08-mouth.svg'),
});

export const PROBE_AUDIO_URL = publicAssetUrl('probe/preview-tone.wav');
