import { z } from "zod";

const nonNegativeInteger = z.number().int().nonnegative();
const positiveInteger = z.number().int().positive();
const positiveSafeInteger = z.number().int().positive().safe();
const vocaDbDateSchema = z.string().min(1).refine((value) => {
  const hasZone = /(?:z|[+-]\d{2}:?\d{2})$/i.test(value);
  return !Number.isNaN(Date.parse(hasZone ? value : `${value}Z`));
}, "Invalid VocaDB date");

export const vocaDbLocalizedStringSchema = z.object({
  language: z.string().min(1),
  value: z.string(),
});

export const vocaDbArtistSchema = z.object({
  id: positiveInteger,
  name: z.string().min(1),
  artistType: z.string().min(1),
  status: z.string().min(1),
  version: nonNegativeInteger,
  deleted: z.boolean().optional().default(false),
  additionalNames: z.string().optional(),
});

export const vocaDbArtistCreditSchema = z.object({
  id: positiveInteger,
  artist: vocaDbArtistSchema.nullish().transform((value) => value ?? null),
  name: z.string().nullable(),
  categories: z.string(),
  roles: z.string(),
  effectiveRoles: z.string(),
  isSupport: z.boolean(),
  isCustomName: z.boolean(),
});

export const vocaDbTagSchema = z.object({
  id: positiveInteger,
  name: z.string().min(1),
  additionalNames: z.string().optional().default(""),
  categoryName: z.string().nullable().optional(),
  urlSlug: z.string().nullable().optional(),
});

export const vocaDbTagUsageSchema = z.object({
  count: nonNegativeInteger,
  tag: vocaDbTagSchema,
});

export const vocaDbPvSchema = z.object({
  id: positiveInteger,
  pvId: z.string().min(1),
  service: z.string().min(1),
  pvType: z.string().min(1),
  url: z.string().min(1),
  name: z.string().nullable().optional(),
  author: z.string().nullable().optional(),
  thumbUrl: z.string().nullable().optional(),
  publishDate: vocaDbDateSchema.nullable().optional(),
  length: nonNegativeInteger.nullable().optional(),
  disabled: z.boolean().optional().default(false),
});

export const vocaDbMainPictureSchema = z.object({
  urlOriginal: z.string().min(1),
  urlThumb: z.string().min(1),
});

/**
 * Contract for the exact optional fields requested by the song client.
 * Relationship collections deliberately have no defaults: a response that
 * omitted a requested field is incomplete and must not be persisted.
 */
export const vocaDbSongSchema = z.object({
  id: positiveInteger,
  name: z.string().min(1),
  defaultName: z.string().min(1),
  defaultNameLanguage: z.string().min(1),
  artistString: z.string(),
  songType: z.string().min(1),
  status: z.string().min(1),
  deleted: z.boolean().optional().default(false),
  createDate: vocaDbDateSchema,
  publishDate: vocaDbDateSchema.nullable().optional(),
  lengthSeconds: nonNegativeInteger,
  favoritedTimes: nonNegativeInteger,
  ratingScore: nonNegativeInteger,
  originalVersionId: positiveInteger.optional(),
  version: nonNegativeInteger,
  updateDate: vocaDbDateSchema.nullable().optional(),
  artists: z.array(vocaDbArtistCreditSchema),
  names: z.array(vocaDbLocalizedStringSchema),
  pvs: z.array(vocaDbPvSchema),
  tags: z.array(vocaDbTagUsageSchema),
  mainPicture: vocaDbMainPictureSchema.nullable().optional(),
  cultureCodes: z.array(z.string().min(1)),
});

export type VocaDbSong = z.infer<typeof vocaDbSongSchema>;
export type VocaDbArtistCredit = z.infer<typeof vocaDbArtistCreditSchema>;
export type VocaDbPv = z.infer<typeof vocaDbPvSchema>;

export const vocaDbSongIdsSchema = z
  .array(positiveSafeInteger)
  .nonempty()
  .transform((ids) => [...new Set(ids)].sort((left, right) => left - right));

const vocaDbActivityEntryCandidateSchema = z.object({
  createDate: vocaDbDateSchema,
  editEvent: z.string().min(1),
  entry: z.object({
    id: positiveSafeInteger,
    entryType: z.literal("Song"),
  }),
});

export const vocaDbActivityEntriesResponseSchema = z
  .object({
    items: z.array(vocaDbActivityEntryCandidateSchema),
  })
  .transform(({ items }) => items);

export type VocaDbActivityEntry = z.infer<
  typeof vocaDbActivityEntryCandidateSchema
>;

// Acronym-preserving aliases for callers that use the VocaDB spelling.
export const vocaDBSongSchema = vocaDbSongSchema;
export type VocaDBSong = VocaDbSong;
