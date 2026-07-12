import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs/promises';
import { FPS } from '../../../shared/constants';

export interface FFmpegProgress {
  percent: number;
  frame: number;
  fps: number;
  time: string;
}

export class FFmpegAdapter {
  private ffmpegPath: string = 'ffmpeg';

  setPath(ffmpegPath: string): void {
    this.ffmpegPath = ffmpegPath;
  }

  async getVersion(): Promise<string> {
    return new Promise((resolve, reject) => {
      const proc = spawn(this.ffmpegPath, ['-version']);
      let stdout = '';
      proc.stdout.on('data', (data: Buffer) => {
        stdout += data.toString();
      });
      proc.on('close', (code: number | null) => {
        if (code === 0) {
          const firstLine = stdout.split('\n')[0];
          resolve(firstLine || 'unknown');
        } else {
          reject(new Error(`FFmpeg exited with code ${code}`));
        }
      });
      proc.on('error', (err: Error) => reject(err));
    });
  }

  async validatePath(ffmpegPath: string): Promise<boolean> {
    try {
      await fs.access(ffmpegPath);
      const stats = await fs.stat(ffmpegPath);
      return stats.isFile();
    } catch {
      return false;
    }
  }

  async findFfmpeg(): Promise<string> {
    // 1. 检查 bundled
    const resourcesPath = process.resourcesPath || path.dirname(process.execPath);
    const bundledPaths = [
      path.join(resourcesPath, 'ffmpeg', 'ffmpeg.exe'),
      path.join(resourcesPath, 'ffmpeg', 'ffmpeg'),
      path.join(resourcesPath, '..', 'ffmpeg', 'ffmpeg.exe'),
    ];

    for (const p of bundledPaths) {
      if (await this.validatePath(p)) {
        return p;
      }
    }

    // 2. 检查 PATH
    try {
      await this.getVersion();
      return 'ffmpeg';
    } catch {
      // 继续
    }

    // 3. 配置路径（由外部设置）
    throw new Error('FFmpeg not found. Please install FFmpeg or configure its path.');
  }

  async encodeFrames(
    frameListPath: string,
    outputPath: string,
    onProgress?: (progress: FFmpegProgress) => void
  ): Promise<void> {
    const args = [
      '-f', 'concat',
      '-safe', '0',
      '-i', frameListPath,
      '-framerate', String(FPS),
      '-pix_fmt', 'yuv420p',
      '-c:v', 'libx264',
      '-preset', 'fast',
      '-crf', '23',
      '-movflags', '+faststart',
      '-y',
      outputPath,
    ];

    return this.runFFmpeg(args, onProgress);
  }

  private runFFmpeg(args: string[], onProgress?: (progress: FFmpegProgress) => void): Promise<void> {
    return new Promise((resolve, reject) => {
      const proc = spawn(this.ffmpegPath, args);

      let stderr = '';
      proc.stderr.on('data', (data: Buffer) => {
        const text = data.toString();
        stderr += text;

        // 实时解析 stderr 获取编码进度
        const frameMatch = text.match(/frame=\s*(\d+)/);
        const fpsMatch = text.match(/fps=\s*([\d.]+)/);
        const timeMatch = text.match(/time=\s*([\d:.]+)/);

        if (frameMatch && onProgress) {
          onProgress({
            frame: parseInt(frameMatch[1], 10),
            fps: fpsMatch ? parseFloat(fpsMatch[1]) : 0,
            time: timeMatch ? timeMatch[1] : '',
            percent: 0,
          });
        }
      });

      proc.on('close', (code: number | null) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`FFmpeg exited with code ${code}: ${stderr.slice(-500)}`));
        }
      });

      proc.on('error', (err: Error) => reject(err));
    });
  }
}
