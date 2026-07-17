export const vocaDbSongFixture = {
  artists: [
    {
      artist: {
        additionalNames: "Producer Alias",
        artistType: "Producer",
        deleted: false,
        id: 100,
        name: "Producer",
        status: "Approved",
        version: 4,
      },
      categories: "Producer, Animator",
      effectiveRoles: "Composer, Arranger",
      id: 1000,
      isCustomName: false,
      isSupport: false,
      name: "Producer",
      roles: "Composer, Arranger",
    },
    {
      artist: null,
      categories: "Other",
      effectiveRoles: "Default",
      id: 1001,
      isCustomName: true,
      isSupport: true,
      name: "Custom chorus",
      roles: "Default",
    },
  ],
  artistString: "Producer feat. Singer",
  createDate: "2026-07-01T12:30:00",
  defaultName: "Fixture Song",
  defaultNameLanguage: "English",
  deleted: false,
  favoritedTimes: 42,
  id: 123,
  lengthSeconds: 180,
  mainPicture: {
    urlOriginal: "https://example.test/cover.jpg",
    urlThumb: "https://example.test/cover-thumb.jpg",
  },
  name: "Fixture Song",
  names: [
    { language: "English", value: "Fixture Song" },
    { language: "Japanese", value: "フィクスチャ曲" },
  ],
  originalVersionId: 122,
  publishDate: "2026-06-01T00:00:00Z",
  pvs: [
    {
      author: "Uploader",
      disabled: false,
      id: 200,
      length: 181,
      name: "Fixture video",
      publishDate: "2026-06-01T08:00:00",
      pvId: "video-id",
      service: "Youtube",
      pvType: "Original",
      thumbUrl: "https://example.test/video-thumb.jpg",
      url: "https://www.youtube.com/watch?v=video-id",
    },
  ],
  ratingScore: 100,
  songType: "Original",
  status: "Approved",
  tags: [
    {
      count: 3,
      tag: {
        additionalNames: "electronic, synth",
        categoryName: "Genres",
        id: 300,
        name: "Electronic",
        urlSlug: "electronic",
      },
    },
  ],
  version: 8,
  cultureCodes: ["ja", "en"],
} as const;

export function makeVocaDbSongFixture() {
  return structuredClone(vocaDbSongFixture);
}

export const vocaDBSongFixture = vocaDbSongFixture;
export const makeVocaDBSongFixture = makeVocaDbSongFixture;
