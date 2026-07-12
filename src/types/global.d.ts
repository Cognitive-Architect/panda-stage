import type {
  Project,
  Asset,
  ExportConfig,
  ExportProgress,
  RenderFrameRequest,
  RenderFrameResult,
} from '@shared/types';

interface MainWindowAPI {
  project: {
    create: () => Promise<Project>;
    open: () => Promise<Project | null>;
    save: (project: Project) => Promise<void>;
  };
  asset: {
    import: () => Promise<{ asset: Asset; buffer: ArrayBuffer } | null>;
    getUrl: (assetId: string) => Promise<string>;
  };
  export: {
    start: (config: ExportConfig) => Promise<void>;
    cancel: () => Promise<void>;
    onProgress: (callback: (progress: ExportProgress) => void) => () => void;
  };
  ffmpeg: {
    getVersion: () => Promise<string>;
    validatePath: (path: string) => Promise<boolean>;
    setPath: (path: string) => Promise<void>;
  };
}

interface ExportWindowAPI {
  onExportStart: (callback: (project: Project) => void) => void;
  onRenderFrame: (callback: (req: RenderFrameRequest) => void) => void;
  onRenderCancel: (callback: () => void) => void;
  sendRenderReady: () => void;
  sendFrameReady: (frameIndex: number) => void;
  sendRenderFrameDone: (result: RenderFrameResult) => void;
  sendRenderError: (error: string) => void;
  resolveAssetUrl: (relativePath: string) => string;
}

declare global {
  interface Window {
    electronAPI: MainWindowAPI;
    exportAPI: ExportWindowAPI;
  }
}

export {};
