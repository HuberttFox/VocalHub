export const vocaDbArtistFixture = {
  id: 100,
  name: "Producer",
  defaultName: "Producer",
  defaultNameLanguage: "English",
  additionalNames: "Producer Alias, 制作者",
  description: "Independent artist description.\nSecond line.",
  artistType: "Producer",
  status: "Finished",
  version: 8,
  createDate: "2020-01-02T03:04:05",
  releaseDate: null,
  names: [
    { language: "English", value: "Producer" },
    { language: "Japanese", value: "制作者" },
  ],
  mainPicture: {
    mime: "image/png",
    urlOriginal: "https://example.test/artist.png",
    urlThumb: "https://example.test/artist-thumb.png",
    urlSmallThumb: "https://example.test/artist-small.png",
    urlTinyThumb: "https://example.test/artist-tiny.png",
  },
  webLinks: [
    {
      id: 500,
      url: "https://example.test/artist",
      description: "Official site",
      category: "Official",
      disabled: false,
    },
    {
      id: 501,
      url: "https://example.test/old",
      description: "Old site",
      category: "Official",
      disabled: true,
    },
  ],
};

export function makeVocaDbArtistFixture(
  overrides: Record<string, unknown> = {},
) {
  return structuredClone({ ...vocaDbArtistFixture, ...overrides });
}
