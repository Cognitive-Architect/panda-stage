import {
  layerCompositeKeyTimes,
  type BatchLayerMotionSpanRef,
  type PlannedPerformanceRow,
  type Shot,
} from '../../domain';

interface DialoguePerformanceLink {
  readonly shotId: string;
  readonly eventIds: Set<string>;
  readonly motionKeyTimesByLayer: Map<string, Set<number>>;
}

export interface ResolvedDialoguePerformanceLinks {
  readonly eventIds: readonly string[];
  readonly layerMotionSpans: readonly BatchLayerMotionSpanRef[];
  /** Referenced events/keys no longer exist (edited/deleted since generation). */
  readonly missingCount: number;
}

/**
 * Session-only ownership of script-generated dialogue -> performance links.
 * It deliberately does not persist into `project.json`; stale references are
 * dropped explicitly rather than guessed back to nearby content.
 */
export class DialoguePerformanceLinkStore {
  private readonly links = new Map<string, DialoguePerformanceLink>();

  capture(rows: readonly PlannedPerformanceRow[]): void {
    this.links.clear();
    for (const row of rows) {
      if (row.status !== 'ready' || !row.dialogueId || !row.shotId) continue;
      const existing = this.links.get(row.dialogueId);
      const link: DialoguePerformanceLink = existing ?? {
        shotId: row.shotId,
        eventIds: new Set<string>(),
        motionKeyTimesByLayer: new Map<string, Set<number>>(),
      };
      for (const eventId of row.eventIds) link.eventIds.add(eventId);
      if (row.layerId && row.motionKeyTimes?.length) {
        const times =
          link.motionKeyTimesByLayer.get(row.layerId) ?? new Set<number>();
        for (const timeMs of row.motionKeyTimes) times.add(timeMs);
        link.motionKeyTimesByLayer.set(row.layerId, times);
      }
      this.links.set(row.dialogueId, link);
    }
  }

  clear(): void {
    this.links.clear();
  }

  resolve(
    shot: Shot,
    dialogueIds: readonly string[],
  ): ResolvedDialoguePerformanceLinks {
    const eventIds = new Set<string>();
    const layersById = new Map(shot.layers.map((layer) => [layer.id, layer]));
    const motionByLayer = new Map<string, Set<number>>();
    let missingCount = 0;

    for (const dialogueId of dialogueIds) {
      const link = this.links.get(dialogueId);
      if (!link || link.shotId !== shot.id) continue;
      for (const eventId of link.eventIds) {
        if (shot.timelineEvents.some((event) => event.id === eventId)) {
          eventIds.add(eventId);
        } else {
          missingCount += 1;
        }
      }
      for (const [layerId, times] of link.motionKeyTimesByLayer) {
        const layer = layersById.get(layerId);
        if (!layer) {
          missingCount += times.size;
          continue;
        }
        const currentTimes = new Set(layerCompositeKeyTimes(layer));
        const validTimes = [...times].filter((timeMs) =>
          currentTimes.has(timeMs),
        );
        missingCount += times.size - validTimes.length;
        if (validTimes.length > 0) {
          const target = motionByLayer.get(layerId) ?? new Set<number>();
          for (const timeMs of validTimes) target.add(timeMs);
          motionByLayer.set(layerId, target);
        }
      }
    }

    const layerMotionSpans = [...motionByLayer.entries()].map(
      ([layerId, times]): BatchLayerMotionSpanRef => {
        const sorted = [...times].sort((left, right) => left - right);
        return {
          id: `dialogue-link:${layerId}:${sorted.join(':')}`,
          layerId,
          startMs: sorted[0]!,
          endMs: sorted[sorted.length - 1]!,
          keyTimesMs: sorted,
        };
      },
    );

    return {
      eventIds: [...eventIds],
      layerMotionSpans,
      missingCount,
    };
  }
}

export const dialoguePerformanceLinkStore = new DialoguePerformanceLinkStore();
