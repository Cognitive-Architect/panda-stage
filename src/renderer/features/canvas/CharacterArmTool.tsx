import { createContext, useContext, useRef, useState, type Dispatch, type ReactNode, type RefObject, type SetStateAction } from 'react';
import type { CharacterArmChain, CharacterArmIkAddress, resolveCharacterArmAssemblyParts } from '../../../domain';
import type { EditorProjectSnapshot } from '../../stores/EditorProjectStore';

export interface CharacterArmToolTarget {
  projectInstanceId: number | null;
  shotId: string;
  layerId: string;
}

export interface CharacterArmAssembly {
  target: CharacterArmToolTarget;
  revision: number;
  timeMs: number;
  parts: ReturnType<typeof resolveCharacterArmAssemblyParts>;
  chain: CharacterArmChain;
  /** Index of the next point to place. The final index is the tip. */
  nextPoint: number;
}

type ReadAssemblyParts = (snapshot: EditorProjectSnapshot, address: CharacterArmIkAddress) =>
  ReturnType<typeof resolveCharacterArmAssemblyParts>;

const CharacterArmToolContext = createContext<{
  target?: CharacterArmToolTarget;
  setTarget: (target?: CharacterArmToolTarget) => void;
  assembly?: CharacterArmAssembly;
  setAssembly: Dispatch<SetStateAction<CharacterArmAssembly | undefined>>;
  readAssemblyParts: RefObject<ReadAssemblyParts | undefined>;
} | null>(null);

export function CharacterArmToolProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [target, setTarget] = useState<CharacterArmToolTarget>();
  const [assembly, setAssembly] = useState<CharacterArmAssembly>();
  const readAssemblyParts = useRef<ReadAssemblyParts | undefined>(undefined);
  return <CharacterArmToolContext.Provider value={{ target, setTarget, assembly, setAssembly, readAssemblyParts }}>
    {children}
  </CharacterArmToolContext.Provider>;
}

function sameTarget(candidate: CharacterArmToolTarget | undefined, address: CharacterArmToolTarget): boolean {
  return candidate?.projectInstanceId === address.projectInstanceId &&
    candidate?.shotId === address.shotId && candidate?.layerId === address.layerId;
}

export function useCharacterArmTool(address: CharacterArmToolTarget) {
  const tool = useContext(CharacterArmToolContext);
  const assembly = sameTarget(tool?.assembly?.target, address) ? tool?.assembly : undefined;
  const active = !assembly && sameTarget(tool?.target, address);
  return {
    active,
    toggle: () => tool?.setTarget(active ? undefined : address),
    assembly,
    setAssembly: tool?.setAssembly,
    readAssemblyParts: tool?.readAssemblyParts,
  };
}

export function useCharacterArmAssembly() {
  return useContext(CharacterArmToolContext)?.assembly;
}

export function replaceArmChainPart(
  chain: CharacterArmChain, index: number, partId: string, pivot?: { x: number; y: number },
): CharacterArmChain {
  if (partId && chain.segments.some((segment, i) => i !== index && segment.partId === partId)) return chain;
  return {
    segments: chain.segments.map((segment, i) => i === index
      ? { ...segment, partId, joint: pivot ? { x: pivot.x, y: pivot.y } : { x: 0, y: 0 } } : segment),
    tip: index === chain.segments.length - 1 && pivot ? { x: pivot.x + 40, y: pivot.y } : chain.tip,
  };
}

export function updateArmAssemblyPart(assembly: CharacterArmAssembly, index: number, partId: string): CharacterArmAssembly {
  const part = assembly.parts.get(partId);
  if (partId && !part) return assembly;
  const chain = replaceArmChainPart(assembly.chain, index, partId, part?.pivot);
  return chain === assembly.chain ? assembly : { ...assembly, chain, nextPoint: 0 };
}
