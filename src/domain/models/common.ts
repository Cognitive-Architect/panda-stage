import { z } from 'zod';

export const IdSchema = z.uuid();
export const NameSchema = z.string().trim().min(1).max(200);
export const NonEmptyTextSchema = z.string().trim().min(1).max(10_000);
export const MillisecondsSchema = z.number().int().nonnegative();
export const PositiveMillisecondsSchema = z.number().int().positive();
export const FiniteNumberSchema = z.number().finite();
export const IsoDateTimeSchema = z.iso.datetime({ offset: true });
export const ColorSchema = z
  .string()
  .regex(/^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/iu, 'Expected #RRGGBB or #RRGGBBAA.');

export const RelativeProjectPathSchema = z
  .string()
  .trim()
  .min(1)
  .refine((value) => !/^(?:[a-zA-Z]:[\\/]|[\\/])/.test(value), {
    message: 'Path must be relative to the project directory.',
  })
  .refine(
    (value) =>
      !value
        .replaceAll('\\', '/')
        .split('/')
        .some((segment) => segment === '..'),
    { message: 'Path cannot traverse outside the project directory.' },
  );
