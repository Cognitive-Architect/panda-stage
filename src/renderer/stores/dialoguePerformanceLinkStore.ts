import {
  layerCompositeAuthoredValuesAtTime,
  layerCompositeKeyTimes,
  type BatchLayerMotionKeyMove,
  type BatchLayerMotionSpanRef,
  type PlannedPerformanceRow,
  type Project,
  type Shot,
} from '../../domain';

interface LinkedKeyIdentity {
  readonly properties: ReadonlySet<string>;
  /** Authored values at capture time; a re-created key with other values is a different product. */
  readonly values: Readonly<Record<string, number>>;
}

interface DialoguePerformanceLink {
  readonly shotId: string;
  readonly eventIds: Set<string>;
  readonly motionKeysByLayer: Map<string, Map<number, LinkedKeyIdentity>>;
}

export interface ResolvedDialoguePerformanceLinks {
  readonly eventIds: readonly string[];
  readonly layerMotionSpans: readonly BatchLayerMotionSpanRef[];
  /** Referenced events/keys no longer exist (edited/deleted since generation). */
  readonly missingCount: number;
  /**
   * Keys whose timestamp now carries an extra, unlinked property. Moving the
   * composite key would drag unrelated work, so it is skipped locally.
   */
  readonly blockedCount: number;
}

/** Per-layer key moves actually applied by the official batch retime. */
export interface DialoguePerformanceMove {
  readonly layerId: string;
  readonly keyMoves: readonly BatchLayerMotionKeyMove[];
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
 * - a successful linked move rewrites key references with the **real** per-key
 *   from->to moves, otherwise the next resolve looks for keys that moved away.
 * - a key is identified by (property, time) **and** its authored values; a key
 *   re-created at the same time on the same property is a different product.
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
        motionKeysByLayer: new Map<string, Map<number, LinkedKeyIdentity>>(),
      };
      for (const eventId of row.eventIds) link.eventIds.add(eventId);
      if (row.layerId && row.motionKeyTimes?.length) {
        const keys =
          link.motionKeysByLayer.get(row.layerId) ??
          new Map<number, LinkedKeyIdentity>();
        const layer = project?.shots
          .find((shot) => shot.id === row.shotId)
          ?.layers.find((candidate) => candidate.id === row.layerId);
        for (const timeMs of row.motionKeyTimes) {
          if (keys.has(timeMs)) continue;
          if (!layer) {
            keys.set(timeMs, { properties: new Set(), values: {} });
            continue;
          }
          const values = layerCompositeAuthoredValuesAtTime(layer, timeMs);
          keys.set(timeMs, {
            properties: new Set(Object.keys(values)),
            values,
          });
        }
        link.motionKeysByLayer.set(row.layerId, keys);
      }
      merged.set(row.dialogueId!, link);
    }
    for (const [dialogueId, link] of merged) {
      this.links.set(dialogueId, link);
    }
  }

  /**
   * Rewrites key references with the exact per-key moves the batch applied.
   * A uniform integer delta would fabricate identities (42->83 and 83->125
   * differ), and keys that did not move must not be shifted at all.
   */
  remapAfterMove(
    projectId: string,
    shotId: string,
    dialogueIds: readonly string[],
    moves: readonly DialoguePerformanceMove[],
  ): void {
    this.ensureProject(projectId);
    if (moves.length === 0) return;
    const movesByLayer = new Map(
      moves.map((move) => [move.layerId, move.keyMoves]),
    );
    for (const dialogueId of dialogueIds) {
      const link = this.links.get(dialogueId);
      if (!link || link.shotId !== shotId) continue;
      for (const [layerId, keys] of link.motionKeysByLayer) {
        const keyMoves = movesByLayer.get(layerId);
        if (!keyMoves || keyMoves.length === 0) continue;
        const toByFrom = new Map(
          keyMoves.map((move) => [move.fromTimeMs, move.toTimeMs]),
        );
        const remapped = new Map<number, LinkedKeyIdentity>();
        for (const [timeMs, identity] of keys) {
          remapped.set(toByFrom.get(timeMs) ?? timeMs, identity);
        }
        link.motionKeysByLayer.set(layerId, remapped);
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
    let blockedCount = 0;

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
      for (const [layerId, keys] of link.motionKeysByLayer) {
        const layer = layersById.get(layerId);
        if (!layer) {
          missingCount += keys.size;
          continue;
        }
        const currentTimes = new Set(layerCompositeKeyTimes(layer));
        for (const [timeMs, identity] of keys) {
          if (!currentTimes.has(timeMs)) {
            missingCount += 1;
            continue;
          }
          const values = layerCompositeAuthoredValuesAtTime(layer, timeMs);
          const currentProperties = Object.keys(values);
          const recorded = [...identity.properties];
          if (recorded.length === 0) {
            const target = motionByLayer.get(layerId) ?? new Set<number>();
            target.add(timeMs);
            motionByLayer.set(layerId, target);
            continue;
          }
          if (recorded.some((property) => !(property in values))) {
            // The linked property was deleted or replaced by another one.
            missingCount += 1;
            continue;
          }
          if (currentProperties.some((property) => !identity.properties.has(property))) {
            // An unrelated property was authored on the same timestamp; the
            // composite retime would move it too, so skip and report instead.
            blockedCount += 1;
            continue;
          }
          const valuesChanged = recorded.some(
            (property) => values[property] !== identity.values[property],
          );
          if (valuesChanged) {
            // Same slot, different authored values: a re-created key, not ours.
            missingCount += 1;
            continue;
          }
          const target = motionByLayer.get(layerId) ?? new Set<number>();
          target.add(timeMs);
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
      blockedCount,
    };
  }
}

export const dialoguePerformanceLinkStore = new DialoguePerformanceLinkStore();
