import { createContext } from 'react';

export type FloatingCharacterMode = 'single-image' | 'composite';

export const CharacterFloatHost = createContext<{
  target: HTMLElement | null;
  setMode: (mode: FloatingCharacterMode | null) => void;
} | null>(null);
