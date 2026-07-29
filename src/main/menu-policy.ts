export interface ApplicationMenuMode {
  isPackaged: boolean;
  gateA: boolean;
}

export function shouldExposeDevelopmentMenu({
  isPackaged,
  gateA,
}: ApplicationMenuMode): boolean {
  return !isPackaged && !gateA;
}
