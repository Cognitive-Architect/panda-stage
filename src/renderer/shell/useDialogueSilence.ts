import { useEffect, useMemo, useRef, useState } from 'react';
import type { Project } from '../../domain';
import type { DialogueSilence, DialogueSilenceIntervals } from '../../shared/dialogue-silence';

export function useDialogueSilence(project: Project | undefined, projectRoot: string | undefined): DialogueSilence {
  const assets = useMemo(() => {
    if (!project) return [];
    const characters = new Set(project.characters.filter(character =>
      character.talkingAnimationId && (character.mode !== 'adaptive-parts' || character.faceBinding),
    ).map(character => character.id));
    if (characters.size === 0) return [];
    const used = new Set<string>();
    for (const shot of project.shots) {
      const placed = new Set(shot.layers.flatMap(({ source }) =>
        source.kind === 'character' ? [source.characterId] : [],
      ));
      const clipIds = new Set(shot.dialogues.flatMap(dialogue =>
        dialogue.characterId && characters.has(dialogue.characterId) && placed.has(dialogue.characterId) && dialogue.audioClipId
          ? [dialogue.audioClipId] : [],
      ));
      for (const clip of shot.audioClips) {
        if (clip.role === 'dialogue' && clip.endMs > clip.startMs && clipIds.has(clip.id)) used.add(clip.assetId);
      }
    }
    return project.assets.flatMap(asset =>
      asset.kind === 'audio' && asset.sha256 && used.has(asset.id)
        ? [{ assetId: asset.id, sha256: asset.sha256 }] : [],
    );
  }, [project]);
  const cache = useRef<{
    projectRoot: string; projectId: string;
    requests: Map<string, Promise<DialogueSilenceIntervals | null>>;
  }>(undefined);
  const [ready, setReady] = useState<{ projectRoot: string; projectId: string; data: DialogueSilence }>();
  const projectId = project?.id;
  useEffect(() => {
    const analyze = window.pandaStage?.assets?.analyzeDialogueSilence;
    if (!projectId || !projectRoot || assets.length === 0 || !analyze) return;
    if (cache.current?.projectRoot !== projectRoot || cache.current?.projectId !== projectId) {
      cache.current = { projectRoot, projectId, requests: new Map() };
    }
    const requests = cache.current.requests;
    let active = true;
    void (async () => {
      for (const asset of assets) {
        if (!active) return;
        const key = asset.assetId + ':' + asset.sha256;
        let request = requests.get(key);
        if (!request) {
          request = analyze({ projectRoot, ...asset }).catch(() => null);
          requests.set(key, request);
        }
        const intervals = await request;
        if (!active || !intervals?.length) continue;
        setReady(previous => {
          const previousData = previous?.projectRoot === projectRoot && previous.projectId === projectId ? previous.data : {};
          if (previousData[asset.assetId]?.sha256 === asset.sha256) return previous;
          return {
            projectRoot, projectId,
            data: { ...previousData, [asset.assetId]: { sha256: asset.sha256, intervals } },
          };
        });
      }
    })();
    return () => { active = false; };
  }, [assets, projectId, projectRoot]);

  return useMemo(() => {
    if (!ready || ready.projectRoot !== projectRoot || ready.projectId !== projectId) return {};
    return Object.fromEntries(assets.flatMap(asset => {
      const entry = ready.data[asset.assetId];
      return entry?.sha256 === asset.sha256 ? [[asset.assetId, entry]] : [];
    }));
  }, [assets, projectId, projectRoot, ready]);
}
