import { z } from 'zod';
import { ColorSchema } from '../models/common';
import {
  ProjectSchema,
  SUBTITLE_STYLE_FONT_SIZE_MAX,
  SUBTITLE_STYLE_FONT_SIZE_MIN,
  SUBTITLE_STYLE_STROKE_WIDTH_MAX,
  SubtitleStyleSchema,
  type Project,
  type SubtitleStyle,
} from '../models';

const SubtitleStylePatchSchema = z
  .object({
    fontSize: z
      .number()
      .int()
      .min(SUBTITLE_STYLE_FONT_SIZE_MIN)
      .max(SUBTITLE_STYLE_FONT_SIZE_MAX)
      .optional(),
    textColor: ColorSchema.optional(),
    strokeColor: ColorSchema.optional(),
    strokeWidth: z
      .number()
      .finite()
      .min(0)
      .max(SUBTITLE_STYLE_STROKE_WIDTH_MAX)
      .optional(),
    position: z.enum(['top', 'center', 'bottom']).optional(),
  })
  .strict();

export type SubtitleStylePatch = z.infer<typeof SubtitleStylePatchSchema>;

export type SubtitleStyleServiceErrorCode =
  | 'SUBTITLE_STYLE_NOT_FOUND'
  | 'INVALID_SUBTITLE_STYLE_PATCH';

export class SubtitleStyleServiceError extends Error {
  constructor(
    readonly code: SubtitleStyleServiceErrorCode,
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'SubtitleStyleServiceError';
  }
}

export interface SubtitleStyleServiceOptions {
  now?: () => Date;
}

/**
 * Project-owned mutation boundary for shared SubtitleStyle values.
 * Dialogues keep only their subtitleStyleId reference; this service updates
 * the one shared style and leaves all referencing Dialogues intact.
 */
export class SubtitleStyleService {
  private readonly now: () => Date;

  constructor(options: SubtitleStyleServiceOptions = {}) {
    this.now = options.now ?? (() => new Date());
  }

  update(
    project: Project,
    styleId: string,
    rawPatch: SubtitleStylePatch,
  ): Project {
    const style = project.subtitleStyles.find(
      (candidate) => candidate.id === styleId,
    );
    if (!style) {
      throw new SubtitleStyleServiceError(
        'SUBTITLE_STYLE_NOT_FOUND',
        `找不到字幕样式：${styleId}`,
      );
    }

    const parsedPatch = SubtitleStylePatchSchema.safeParse(rawPatch);
    if (!parsedPatch.success) {
      throw new SubtitleStyleServiceError(
        'INVALID_SUBTITLE_STYLE_PATCH',
        '字幕样式修改无效。',
        parsedPatch.error,
      );
    }

    const nextStyle: SubtitleStyle = SubtitleStyleSchema.parse({
      ...style,
      ...parsedPatch.data,
    });
    if (JSON.stringify(nextStyle) === JSON.stringify(style)) return project;

    return ProjectSchema.parse({
      ...project,
      subtitleStyles: project.subtitleStyles.map((candidate) =>
        candidate.id === styleId ? nextStyle : candidate,
      ),
      updatedAt: this.now().toISOString(),
    });
  }
}
