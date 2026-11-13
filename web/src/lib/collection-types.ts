export const COLLECTION_KINDS = ['album', 'playlist', 'shared'] as const;
export type CollectionKind = typeof COLLECTION_KINDS[number];
export type CollectionFavorite = { kind: CollectionKind; id: string; name: string; cover: string | null; sub: string; savedAt: number; available: boolean };
export const collectionHref = (kind: CollectionKind, id: string) => `/${kind}/${id}`;
