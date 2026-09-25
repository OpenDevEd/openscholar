import type { AuthorPublication } from "@/components/authors/types";
export type TopicPublication = AuthorPublication & {locations: {name: string; url: string}[]; metadataLocation: {libraryId: string; itemKey: string}};
export type TopicPublicationPage = {papers: TopicPublication[]; nextCursor: string | null; unavailableCount: number; updating: boolean; complete: boolean};
