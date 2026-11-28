import { createContext, useContext, useRef, useState, type Dispatch, type ReactNode, type RefObject, type SetStateAction } from 'react';
import {
  DEFAULT_ARM_CHAIN_ID, type CharacterArmChain, type CharacterArmChainKind, type CharacterArmIkAddress,
  type resolveCharacterArmAssemblyParts,
} from '../../../domain';
import type { EditorProjectSnapshot } from '../../stores/EditorProjectStore';

export interface CharacterArmToolTarget {
  projectInstanceId: number | null;
  shotId: string;
  layerId: string;
  /** Named chain the tool operates on. Omitted matches any chain for read-only callers. */
  chainId?: string;
}

export interface CharacterArmAssembly {
  target: CharacterArmToolTarget;
  revision: number;
  timeMs: number;
  parts: ReturnType<typeof resolveCharacterArmAssemblyParts>;
  chain: CharacterArmChain;
  kind?: CharacterArmChainKind;
  /** Index of the next point to place. The final index is the tip. */
  nextPoint: number;
}

/** Copy and joint names for the selected chain's limb role. */
export interface CharacterArmChainLabels {
  parts: readonly string[];
  joints: readonly string[];
  tip: string;
  handle: string;
  showHandle: string;
  hideHandle: string;
}

export function characterArmChainLabels(kind?: CharacterArmChainKind): CharacterArmChainLabels {
  if (kind === 'left-leg' || kind === 'right-leg') {
    return {
      parts: ['大腿', '小腿', '脚部'],
      joints: ['髋', '膝', '踝', '末端'],
      tip: '踝点',
      handle: '脚踝',
      showHandle: '显示脚踝拖柄',
      hideHandle: '隐藏脚踝拖柄',
    };
  }
  return {
    parts: ['上臂', '前臂', '手部'],
    joints: ['肩', '肘', '腕', '末端'],
    tip: '腕点',
    handle: '手腕',
    showHandle: '显示手腕拖柄',
    hideHandle: '隐藏手腕拖柄',
  };
}

type ReadAssemblyParts = (snapshot: EditorProjectSnapshot, address: CharacterArmIkAddress) =>
  ReturnType<typeof resolveCharacterArmAssemblyParts>;

const CharacterArmToolContext = createContext<{
  target?: CharacterArmToolTarget;
  setTarget: (target?: CharacterArmToolTarget) => void;
  chainId: string;
  selectChain: (chainId: string) => void;
  assembly?: CharacterArmAssembly;
  setAssembly: Dispatch<SetStateAction<CharacterArmAssembly | undefined>>;
  readAssemblyParts: RefObject<ReadAssemblyParts | undefined>;
} | null>(null);

export function CharacterArmToolProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [target, setTarget] = useState<CharacterArmToolTarget>();
  const [chainId, selectChain] = useState<string>(DEFAULT_ARM_CHAIN_ID);
  const [assembly, setAssembly] = useState<CharacterArmAssembly>();
  const readAssemblyParts = useRef<ReadAssemblyParts | undefined>(undefined);
  return <CharacterArmToolContext.Provider value={{ target, setTarget, chainId, selectChain, assembly, setAssembly, readAssemblyParts }}>
    {children}
  </CharacterArmToolContext.Provider>;
}

function sameTarget(candidate: CharacterArmToolTarget | undefined, address: CharacterArmToolTarget): boolean {
  return candidate?.projectInstanceId === address.projectInstanceId &&
    candidate?.shotId === address.shotId && candidate?.layerId === address.layerId &&
    (address.chainId === undefined || candidate?.chainId === address.chainId);
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
    chainId: tool?.chainId ?? DEFAULT_ARM_CHAIN_ID,
    selectChain: tool?.selectChain,
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
