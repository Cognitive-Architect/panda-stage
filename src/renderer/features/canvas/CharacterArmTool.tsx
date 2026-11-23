import { createContext, useContext, useState, type ReactNode } from 'react';

export interface CharacterArmToolTarget {
  projectInstanceId: number | null;
  shotId: string;
  layerId: string;
}

const CharacterArmToolContext = createContext<{
  target?: CharacterArmToolTarget;
  setTarget: (target?: CharacterArmToolTarget) => void;
} | null>(null);

export function CharacterArmToolProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [target, setTarget] = useState<CharacterArmToolTarget>();
  return <CharacterArmToolContext.Provider value={{ target, setTarget }}>{children}</CharacterArmToolContext.Provider>;
}

export function useCharacterArmTool(address: CharacterArmToolTarget) {
  const tool = useContext(CharacterArmToolContext);
  const active = tool?.target?.projectInstanceId === address.projectInstanceId &&
    tool?.target?.shotId === address.shotId && tool?.target?.layerId === address.layerId;
  return { active, toggle: () => tool?.setTarget(active ? undefined : address) };
}
