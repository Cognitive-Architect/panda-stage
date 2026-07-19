import {
  PROBE_BACKGROUND_ASSET_ID,
  PROBE_CHARACTER_ASSET_ID,
} from '../../shared/probe/probe-project';
import type { StageAssetUrlMap } from '../../shared/stage/render-model';

function publicAssetUrl(relativePath: string): string {
  return new URL(relativePath, document.baseURI).href;
}

export const PROBE_ASSET_URLS: StageAssetUrlMap = Object.freeze({
  [PROBE_BACKGROUND_ASSET_ID]: publicAssetUrl('probe/stage-background.svg'),
  [PROBE_CHARACTER_ASSET_ID]: publicAssetUrl('probe/panda-character.png'),
});
