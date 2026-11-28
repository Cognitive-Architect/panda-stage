import { describe, expect, it } from 'vitest';
import {
  CharacterService,
  DEFAULT_ARM_CHAIN_ID,
  LayerService,
  ProjectSchema,
  characterArmTipOnStage,
  deleteCharacterArmChain,
  migrateProject,
  planCharacterArmIk,
  renameCharacterArmChain,
  resolveCharacterArmChain,
  resolveCharacterArmChains,
  saveCharacterArmChain,
  type AdaptivePartsCharacter,
  type CharacterArmChain,
  type Project,
} from '../../src/domain';
import { adaptivePartsFixture } from '../helpers/adaptivePartsFixtures';
import { IDS, buildProject } from './domain/testProject';

const LIMITS = [
  { minDeg: -180, maxDeg: 180 },
  { minDeg: -145, maxDeg: 145 },
  { minDeg: -120, maxDeg: 120 },
] as const;

const CHAIN_A = '00000000-0000-4000-8000-000000000201';
const CHAIN_B = '00000000-0000-4000-8000-000000000202';
const CHAIN_LEG = '00000000-0000-4000-8000-000000000203';

function chainFor(partIds: readonly string[]): CharacterArmChain {
  return {
    segments: partIds.map((partId, index) => ({ partId, joint: { x: 0, y: 0 }, ...LIMITS[index]! })),
    tip: { x: 55, y: 0 },
  };
}

/** Builds an adaptive-parts character with horizontally spaced parts and a placed layer. */
function fixture(partCount = 5) {
  const parts = adaptivePartsFixture(IDS.assetChar).slice(0, partCount).map((part, index) => ({
    ...part, restTransform: { a: 1, b: 0, c: 0, d: 1, tx: index * 65, ty: 0 },
  }));
  const created = new CharacterService().createAdaptiveParts(buildProject(), { name: '多骨链角色', parts });
  const character = created.characters.at(-1)!;
  const placement = new LayerService().createFromAdaptiveCharacter(created, IDS.shot, character.id, { x: 650, y: 450 });
  return {
    project: placement.project,
    characterId: character.id,
    partIds: parts.map(({ partId }) => partId),
    address: { shotId: IDS.shot, layerId: placement.layer.id, timeMs: 500 },
  };
}

function adaptiveCharacter(project: Project): AdaptivePartsCharacter {
  const character = project.characters.at(-1);
  if (!character || character.mode !== 'adaptive-parts') throw new Error('Expected an adaptive-parts fixture.');
  return character;
}

describe('named rigid arm chains', () => {
  it('resolves a legacy armChain project as one default chain and round-trips it unchanged', () => {
    const { project, partIds, address } = fixture(3);
    const legacyChain = chainFor(partIds.slice(0, 2));
    const legacy = ProjectSchema.parse({
      ...project,
      characters: project.characters.map(character => character.mode === 'adaptive-parts'
        ? { ...character, armChain: legacyChain } : character),
    });
    const character = adaptiveCharacter(legacy);
    expect(character.armChain).toEqual(legacyChain);
    expect(character.armChains).toBeUndefined();
    const resolved = resolveCharacterArmChains(character);
    expect(resolved).toEqual([{ id: DEFAULT_ARM_CHAIN_ID, name: '手臂', kind: 'right-arm', chain: legacyChain }]);
    expect(resolveCharacterArmChain(character)).toEqual(resolved[0]);

    const reopened = migrateProject(JSON.parse(JSON.stringify(legacy)));
    const reopenedCharacter = adaptiveCharacter(reopened);
    expect(reopenedCharacter.armChain).toEqual(legacyChain);
    expect(reopenedCharacter.armChains).toBeUndefined();
    expect(resolveCharacterArmChains(reopenedCharacter)).toEqual(resolved);
    expect(() => characterArmTipOnStage(reopened, address)).not.toThrow();
  });

  it('saves several named chains, persists them after parse, and keeps Part references valid', () => {
    const { project, partIds, address } = fixture(5);
    const right = chainFor(partIds.slice(0, 2));
    const leftLeg = chainFor([partIds[2]!, partIds[3]!]);
    let next = saveCharacterArmChain(project, address, right, CHAIN_A, { name: '右手臂', kind: 'right-arm' });
    next = saveCharacterArmChain(next, address, leftLeg, CHAIN_LEG, { name: '左腿', kind: 'left-leg' });
    expect(adaptiveCharacter(next).armChain).toBeUndefined();

    const reopened = migrateProject(JSON.parse(JSON.stringify(next)));
    const character = adaptiveCharacter(reopened);
    expect(character.armChains?.map(({ id, name, kind }) => ({ id, name, kind }))).toEqual([
      { id: CHAIN_A, name: '右手臂', kind: 'right-arm' },
      { id: CHAIN_LEG, name: '左腿', kind: 'left-leg' },
    ]);
    const validPartIds = new Set(character.parts.map(({ partId }) => partId));
    for (const entry of resolveCharacterArmChains(character)) {
      expect(entry.chain.segments.every(({ partId }) => validPartIds.has(partId))).toBe(true);
    }
    expect(resolveCharacterArmChains(character)).toHaveLength(2);
    expect(() => characterArmTipOnStage(reopened, address, CHAIN_A)).not.toThrow();
    expect(() => characterArmTipOnStage(reopened, address, CHAIN_LEG)).not.toThrow();
  });

  it('keeps the legacy armChain in sync when the default chain is saved and does not touch it for extra chains', () => {
    const { project, partIds, address } = fixture(5);
    const defaultChain = chainFor(partIds.slice(0, 2));
    let next = saveCharacterArmChain(project, address, defaultChain);
    let character = adaptiveCharacter(next);
    expect(character.armChain).toEqual(defaultChain);
    expect(character.armChains).toHaveLength(1);
    expect(character.armChains?.[0]?.id).toBe(DEFAULT_ARM_CHAIN_ID);

    const leftLeg = chainFor([partIds[2]!, partIds[3]!]);
    next = saveCharacterArmChain(next, address, leftLeg, CHAIN_LEG, { name: '左腿', kind: 'left-leg' });
    character = adaptiveCharacter(next);
    expect(character.armChain).toEqual(defaultChain);
    expect(character.armChains?.map(({ name }) => name)).toEqual(['手臂', '左腿']);
  });

  it('plans IK on one chain without changing another chain target or bounds', () => {
    const { project, partIds, address } = fixture(5);
    const right = chainFor(partIds.slice(0, 2));
    const leftLeg = chainFor([partIds[2]!, partIds[3]!]);
    let next = saveCharacterArmChain(project, address, right, CHAIN_A, { name: '右手臂', kind: 'right-arm' });
    next = saveCharacterArmChain(next, address, leftLeg, CHAIN_LEG, { name: '左腿', kind: 'left-leg' });

    const rightTip = characterArmTipOnStage(next, address, CHAIN_A);
    const legTip = characterArmTipOnStage(next, address, CHAIN_LEG);
    const goal = { x: rightTip.x - 40, y: rightTip.y + 30 };
    const plan = planCharacterArmIk(next, address, goal, undefined, CHAIN_A);
    const reopened = migrateProject(JSON.parse(JSON.stringify(plan.project)));
    const character = adaptiveCharacter(reopened);

    // The untouched chain keeps its exact calibration and tip.
    expect(resolveCharacterArmChain(character, CHAIN_LEG)?.chain).toEqual(leftLeg);
    const reopenedLegTip = characterArmTipOnStage(reopened, address, CHAIN_LEG);
    expect(reopenedLegTip.x).toBeCloseTo(legTip.x, 9);
    expect(reopenedLegTip.y).toBeCloseTo(legTip.y, 9);
    // The dragged chain follows the new target.
    const reopenedRightTip = characterArmTipOnStage(reopened, address, CHAIN_A);
    expect(Math.hypot(reopenedRightTip.x - goal.x, reopenedRightTip.y - goal.y)).toBeLessThan(0.2);
    expect(resolveCharacterArmChain(character, CHAIN_A)?.chain).toEqual(right);
  });

  it('rejects a chain whose segments reuse another chain Part at save time', () => {
    const { project, partIds, address } = fixture(4);
    const right = chainFor(partIds.slice(0, 2));
    const next = saveCharacterArmChain(project, address, right, CHAIN_A, { name: '右手臂', kind: 'right-arm' });
    const conflicting = chainFor([partIds[1]!, partIds[2]!]);
    expect(() => saveCharacterArmChain(next, address, conflicting, CHAIN_B, { name: '左腿', kind: 'left-leg' }))
      .toThrow('已属于骨链「右手臂」');
    expect(resolveCharacterArmChains(adaptiveCharacter(next))).toHaveLength(1);
  });

  it('renames and deletes named chains while leaving the legacy default chain intact', () => {
    const { project, partIds, address } = fixture(5);
    const defaultChain = chainFor(partIds.slice(0, 2));
    const leftLeg = chainFor([partIds[2]!, partIds[3]!]);
    let next = saveCharacterArmChain(project, address, defaultChain);
    next = saveCharacterArmChain(next, address, leftLeg, CHAIN_LEG, { name: '左腿', kind: 'left-leg' });

    const renamed = renameCharacterArmChain(next, address, CHAIN_LEG, '右腿');
    expect(resolveCharacterArmChain(adaptiveCharacter(renamed), CHAIN_LEG)?.name).toBe('右腿');
    expect(adaptiveCharacter(renamed).armChain).toEqual(defaultChain);
    expect(() => renameCharacterArmChain(renamed, address, CHAIN_LEG, '手臂')).toThrow('骨链名称已存在');

    const deleted = deleteCharacterArmChain(renamed, address, CHAIN_LEG);
    const afterDelete = resolveCharacterArmChains(adaptiveCharacter(deleted));
    expect(afterDelete.map(({ id }) => id)).toEqual([DEFAULT_ARM_CHAIN_ID]);
    expect(adaptiveCharacter(deleted).armChain).toEqual(defaultChain);

    const cleared = deleteCharacterArmChain(deleted, address, DEFAULT_ARM_CHAIN_ID);
    expect(resolveCharacterArmChains(adaptiveCharacter(cleared))).toEqual([]);
    expect(adaptiveCharacter(cleared).armChain).toBeUndefined();
  });

  it('resolves no chains for characters without rigid arms', () => {
    expect(resolveCharacterArmChains(buildProject().characters[0]!)).toEqual([]);
    const { project } = fixture(3);
    const character = adaptiveCharacter(project);
    expect(resolveCharacterArmChains(character)).toEqual([]);
    expect(resolveCharacterArmChain(character)).toBeUndefined();
  });
});
