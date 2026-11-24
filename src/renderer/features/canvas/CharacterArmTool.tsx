import { createContext, useContext, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import type { CharacterArmChain, resolveCharacterArmAssemblyParts } from '../../../domain';

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

const CharacterArmToolContext = createContext<{
  target?: CharacterArmToolTarget;
  setTarget: (target?: CharacterArmToolTarget) => void;
  assembly?: CharacterArmAssembly;
  setAssembly: Dispatch<SetStateAction<CharacterArmAssembly | undefined>>;
} | null>(null);

export function CharacterArmToolProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [target, setTarget] = useState<CharacterArmToolTarget>();
  const [assembly, setAssembly] = useState<CharacterArmAssembly>();
  return <CharacterArmToolContext.Provider value={{ target, setTarget, assembly, setAssembly }}>
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
  };
}

export function useCharacterArmAssembly() {
  return useContext(CharacterArmToolContext)?.assembly;
}

export function updateArmAssemblyPart(assembly: CharacterArmAssembly, index: number, partId: string): CharacterArmAssembly {
  const part = assembly.parts.get(partId);
  const { chain } = assembly;
  if (!part || chain.segments.some((segment, i) => i !== index && segment.partId === partId)) return assembly;
  return {
    ...assembly,
    chain: {
      segments: chain.segments.map((segment, i) => i === index ? { ...segment, partId, joint: part.pivot } : segment),
      tip: index === chain.segments.length - 1 ? { x: part.pivot.x + 40, y: part.pivot.y } : chain.tip,
    },
    nextPoint: 0,
  };
}
