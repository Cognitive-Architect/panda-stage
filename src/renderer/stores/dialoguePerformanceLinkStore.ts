import {
  layerCompositeKeyPropertiesAtTime,
  layerCompositeKeyTimes,
  type BatchLayerMotionSpanRef,
  type PlannedPerformanceRow,
  type Project,
  type Shot,
} from '../../domain';

interface DialoguePerformanceLink {
  readonly shotId: string;
  readonly eventIds: Set<string>;
  readonly motionKeyTimesByLayer: Map<string, Set<number>>;
  /** (layerId -> keyTimeMs -> authored properties) gives keys a real identity. */
  readonly motionKeyPropertiesByLayer: Map<string, Map<number, Set<string>>>;
}

export interface ResolvedDialoguePerformanceLinks {
  readonly eventIds: readonly string[];
  readonly layerMotionSpans: readonly BatchLayerMotionSpanRef[];
  /** Referenced events/keys no longer exist (edited/deleted since generation). */
  readonly missingCount: number;
}

/** Per-layer frame-aligned delta actually applied to this batch. */
export interface DialoguePerformanceMove {
  readonly layerId: string;
  readonly deltaMs: number;
}

/**
 * Session-only ownership of script-generated dialogue -> performance links.
 * It deliberately does not persist into `project.json`; stale references are
 * dropped explicitly rather than guessed back to nearby content.
 *
 * Lifecycle rules:
 * - one project per session: switching/closing the project drops every link.
 * - capturing a generation replaces only the links of the shots it produced, so
 *   generating a second scene never erases the first one.
 * - a successful linked move rewrites the moved key times, otherwise the next
 *   resolve would look for keys that already moved away.
 * - a key is identified by (property, time): a brand-new key at the same
 *   timestamp on another property is never treated as the linked one.
 */
export class DialoguePerformanceLinkStore {
  private projectId: string | null = null;
  private readonly links = new Map<string, DialoguePerformanceLink>();

  private ensureProject(projectId: string): void {
    if (this.projectId === projectId) return;
    this.projectId = projectId;
    this.links.clear();
  }

  capture(
    projectId: string,
    rows: readonly PlannedPerformanceRow[],
    project?: Project,
  ): void {
    this.ensureProject(projectId);
    const readyRows = rows.filter(
      (row) => row.status === 'ready' && row.dialogueId && row.shotId,
    );
    const touchedShots = new Set(readyRows.map((row) => row.shotId!));
    // Replace only the regenerated shots; other shots keep their links.
    for (const [dialogueId, link] of [...this.links]) {
      if (touchedShots.has(link.shotId)) this.links.delete(dialogueId);
    }
    // One dialogue can appear across several directives: merge them first, so
    // the last row never overwrites earlier event/key references.
    const merged = new Map<string, DialoguePerformanceLink>();
    for (const row of readyRows) {
      const existing = merged.get(row.dialogueId!);
      const link: DialoguePerformanceLink = existing ?? {
        shotId: row.shotId!,
        eventIds: new Set<string>(),
        motionKeyTimesByLayer: new Map<string, Set<number>>(),
        motionKeyPropertiesByLayer: new Map<string, Map<number, Set<string>>>(),
      };
      for (const eventId of row.eventIds) link.eventIds.add(eventId);
      if (row.layerId && row.motionKeyTimes?.length) {
        const times =
          link.motionKeyTimesByLayer.get(row.layerId) ?? new Set<number>();
        const properties =
          link.motionKeyPropertiesByLayer.get(row.layerId) ??
          new Map<number, Set<string>>();
        const layer = project?.shots
          .find((shot) => shot.id === row.shotId)
          ?.layers.find((candidate) => candidate.id === row.layerId);
        for (const timeMs of row.motionKeyTimes) {
          times.add(timeMs);
          if (!layer) continue;
          const authored = layerCompositeKeyPropertiesAtTime(layer, timeMs);
          if (authored.length === 0) continue;
          properties.set(timeMs, new Set(authored));
        }
        link.motionKeyTimesByLayer.set(row.layerId, times);
        link.motionKeyPropertiesByLayer.set(row.layerId, properties);
      }
      merged.set(row.dialogueId!, link);
    }
    for (const [dialogueId, link] of merged) {
      this.links.set(dialogueId, link);
    }
  }

  /**
   * Rewrites the key times of links that were moved, using the applied layer
   * deltas. Events keep their IDs, so only keyframe times need remapping.
   */
  remapAfterMove(
    projectId: string,
    shotId: string,
    dialogueIds: readonly string[],
    moves: readonly DialoguePerformanceMove[],
  ): void {
    this.ensureProject(projectId);
    if (moves.length === 0) return;
    const deltaByLayer = new Map(
      moves.map((move) => [move.layerId, move.deltaMs]),
    );
    for (const dialogueId of dialogueIds) {
      const link = this.links.get(dialogueId);
      if (!link || link.shotId !== shotId) continue;
      for (const [layerId, times] of link.motionKeyTimesByLayer) {
        const deltaMs = deltaByLayer.get(layerId);
        if (!deltaMs) continue;
        link.motionKeyTimesByLayer.set(
          layerId,
          new Set([...times].map((timeMs) => timeMs + deltaMs)),
        );
        const properties = link.motionKeyPropertiesByLayer.get(layerId);
        if (!properties) continue;
        const remapped = new Map<number, Set<string>>();
        for (const [timeMs, authored] of properties) {
          remapped.set(timeMs + deltaMs, authored);
        }
        link.motionKeyPropertiesByLayer.set(layerId, remapped);
      }
    }
  }

  clear(): void {
    this.links.clear();
    this.projectId = null;
  }

  resolve(
    projectId: string,
    shot: Shot,
    dialogueIds: readonly string[],
  ): ResolvedDialoguePerformanceLinks {
    this.ensureProject(projectId);
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
        const recordedProperties =
          link.motionKeyPropertiesByLayer.get(layerId) ?? new Map();
        const validTimes = [...times].filter((timeMs) => {
          if (!currentTimes.has(timeMs)) return false;
          const recorded = recordedProperties.get(timeMs);
          if (!recorded || recorded.size === 0) return true;
          const current = layerCompositeKeyPropertiesAtTime(layer, timeMs);
          return current.some((property) => recorded.has(property));
        });
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
