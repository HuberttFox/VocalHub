export type ArtistListItemDto = {
  id: string;
  name: string;
  aliases: Array<{ language: string | null; value: string }>;
  avatarUrl: string | null;
  publicSongCount: number;
};

export type ArtistListDto = {
  items: ArtistListItemDto[];
  query: { q: string | null };
  pagination: {
    page: number;
    pageSize: number;
    totalItems: number;
    totalPages: number;
  };
};
