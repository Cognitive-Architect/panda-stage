import { describe, expect, it } from 'vitest';
import { solveRigidArm } from '../../../src/domain/geometry/rigidArmIk';
import {
  CharacterMotionService, CharacterService, LayerService, ProjectSchema, characterArmTipOnStage, layerPivotStageVector, migrateProject,
  planCharacterArmIk, resolveCharacterArmAssemblyParts, saveCharacterArmChain,
} from '../../../src/domain';
import { adaptivePartsFixture } from '../../helpers/adaptivePartsFixtures';
import { IDS, buildProject } from './testProject';

describe('rigid arm IK', () => {
  const arm = [{ x: 0, y: 0 }, { x: 65, y: 0 }, { x: 120, y: 0 }];
  const limits = [{ minDeg: -180, maxDeg: 180 }, { minDeg: 0, maxDeg: 145 }];

  it('bends the joint with fixed lengths even when pulled along the straight axis', () => {
    const result = solveRigidArm(arm, { x: 75, y: 0 }, limits);
    expect(result.distance).toBeLessThan(0.06);
    expect(result.joints[0]).toEqual(arm[0]);
    expect(result.jointAnglesDeg[1]).toBeGreaterThan(20);
    const [root, elbow, end] = result.joints;
    expect(Math.hypot(elbow!.x - root!.x, elbow!.y - root!.y)).toBeCloseTo(65, 6);
    expect(Math.hypot(end!.x - elbow!.x, end!.y - elbow!.y)).toBeCloseTo(55, 6);
  });

  it('returns a bounded result outside its reach and preserves a seeded bend', () => {
    const first = solveRigidArm(arm, { x: 85, y: 24 }, limits);
    const next = solveRigidArm(arm, { x: 83, y: 26 }, limits, first.jointAnglesDeg);
    expect(next.distance).toBeLessThan(0.06);
    expect(Math.abs(next.jointAnglesDeg[1]! - first.jointAnglesDeg[1]!)).toBeLessThan(10);
    const blocked = solveRigidArm(arm, { x: 200, y: 40 }, [{ minDeg: -6, maxDeg: 6 }, { minDeg: 25, maxDeg: 60 }]);
    expect(blocked.distance).toBeGreaterThan(70);
    expect(blocked.jointAnglesDeg[0]).toBeLessThanOrEqual(6);
    expect(blocked.jointAnglesDeg[0]).toBeGreaterThanOrEqual(-6);
    expect(blocked.jointAnglesDeg[1]).toBeGreaterThanOrEqual(25);
  });

  it('supports an already bent three-segment local rest chain and rejects coincident joints', () => {
    const rest = [{ x: 14, y: 20 }, { x: 55, y: 4 }, { x: 78, y: 22 }, { x: 113, y: 20 }];
    const result = solveRigidArm(rest, { x: 76, y: 61 }, [...limits, { minDeg: -120, maxDeg: 120 }]);
    expect(result.distance).toBeLessThan(0.06);
    expect(result.joints).toHaveLength(4);
    expect(() => solveRigidArm([arm[0]!, arm[0]!, arm[2]!], arm[1]!, limits)).toThrow('distinct');
  });


  it('maps stage clicks on a posed mirror back to stable part coordinates', () => {
    const parts = adaptivePartsFixture(IDS.assetChar).slice(0, 3).map((part, index) => ({
      ...part, restTransform: { a: 1, b: 0, c: 0, d: 1, tx: index * 65, ty: 0 },
    }));
    const base = new CharacterService().createAdaptiveParts(buildProject(), { name: 'Rigid arm', parts });
    const placement = new LayerService().createFromAdaptiveCharacter(base, IDS.shot, base.characters.at(-1)!.id, { x: 650, y: 450 });
    const address = { shotId: IDS.shot, layerId: placement.layer.id, timeMs: 500 };
    const partId = parts[0]!.partId;
    const project = ProjectSchema.parse({ ...placement.project, shots: placement.project.shots.map(shot => ({ ...shot,
      layers: shot.layers.map(layer => layer.id === address.layerId ? {
        ...layer, x: 650, y: 450, flipX: true, rotationDeg: 90, scaleX: 2, scaleY: 1.5,
      } : layer),
    })) });
    const moved = new CharacterMotionService().apply(project, { ...address, partId, autoKey: true },
      { 'transform.offsetX': 30, 'transform.offsetY': 20 });
    const posed = resolveCharacterArmAssemblyParts(moved, address);
    const reference = resolveCharacterArmAssemblyParts(moved, { ...address, timeMs: 0 });
    const shoulder = { x: 220, y: 145 };
    const unposed = reference.get(partId)!.toStage(shoulder);
    const clicked = { x: unposed.x - 30, y: unposed.y - 60 };
    const stored = posed.get(partId)!.toPart(clicked);
    expect(stored.x).toBeCloseTo(shoulder.x);
    expect(stored.y).toBeCloseTo(shoulder.y);
    expect(posed.get(partId)!.toStage(stored)).toEqual(clicked);
    expect([...posed.keys()]).toEqual(parts.map(part => part.partId));
  });

  it('converts a mirrored stage-space wrist to local keys and persists only the selected occurrence', () => {
    const parts = adaptivePartsFixture(IDS.assetChar).slice(0, 2).map((part, index) => ({
      ...part, restTransform: { a: 1, b: 0, c: 0, d: 1, tx: index * 65, ty: 0 },
      sourceRestTransform: { a: 1, b: 0, c: 0, d: 1, tx: index * 65, ty: 0 },
    }));
    const base = new CharacterService().createAdaptiveParts(buildProject(), { name: 'Rigid arm', parts });
    const char = base.characters.at(-1)!;
    const layers = new LayerService();
    const one = layers.createFromAdaptiveCharacter(base, IDS.shot, char.id, { x: 650, y: 450 });
    const two = layers.createFromAdaptiveCharacter(one.project, IDS.shot, char.id, { x: 1400, y: 450 });
    const mirror = { flipX: true, rotationDeg: 28, scaleX: 1.7, scaleY: 1.15 };
    let project = ProjectSchema.parse({ ...two.project, shots: two.project.shots.map(shot => ({ ...shot,
      layers: shot.layers.map(layer => layer.id === one.layer.id ? { ...layer, ...mirror } : layer),
    })) });
    const address = { shotId: IDS.shot, layerId: one.layer.id, timeMs: 500 };
    const draft = { segments: parts.map(({ partId }, index) => ({ partId, joint: { x: 0, y: 0 }, ...limits[index]! })),
      tip: { x: 55, y: 0 } };
    expect(migrateProject({ ...project, schemaVersion: 36 })).toEqual(project);
    project = saveCharacterArmChain(project, address, draft);
    expect(() => migrateProject({ ...project, schemaVersion: 36 })).toThrow();
    const neutral = characterArmTipOnStage(project, address);
    const delta = layerPivotStageVector({ x: -36, y: 28 }, mirror.rotationDeg, mirror.scaleX, mirror.scaleY, mirror.flipX);
    const goal = { x: neutral.x + delta.x, y: neutral.y + delta.y };
    const plan = planCharacterArmIk(project, address, goal);
    const opened = migrateProject(JSON.parse(JSON.stringify(plan.project)));
    const actual = characterArmTipOnStage(opened, address);
    expect(Math.hypot(actual.x - goal.x, actual.y - goal.y)).toBeLessThan(0.1);
    expect(actual.x).toBeCloseTo(plan.tip.x, 6);
    expect(actual.y).toBeCloseTo(plan.tip.y, 6);
    expect(opened.shots[0]!.layers.find(({ id }) => id === two.layer.id)).toEqual(two.layer);
    expect(opened.shots[0]!.layers.find(({ id }) => id === one.layer.id)).toMatchObject(mirror);
    expect(project.shots[0]!.layers.find(({ id }) => id === one.layer.id)?.animationClip).toBeUndefined();
  });
});
