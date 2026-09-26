import type { GraphClient } from './graphClient.js';

/**
 * Content Publishing API (Instagram API with Instagram Login).
 *
 *   POST /{ig-user-id}/media           → cria o container
 *   GET  /{container-id}?fields=status_code
 *   POST /{ig-user-id}/media_publish   → publica (creation_id)
 *
 * A mídia precisa estar numa URL pública: a Meta faz o download (cURL) dela.
 */

export type ContainerStatusCode = 'EXPIRED' | 'ERROR' | 'FINISHED' | 'IN_PROGRESS' | 'PUBLISHED';

export interface ContainerStatus {
  statusCode: ContainerStatusCode;
  status: string | null;
}

export interface ImageItem {
  kind: 'image';
  url: string;
}
export interface VideoItem {
  kind: 'video';
  url: string;
}
export type MediaItem = ImageItem | VideoItem;

export async function createSingleContainer(
  graph: GraphClient,
  token: string,
  igUserId: string,
  input:
    | { type: 'IMAGE'; item: ImageItem; caption: string }
    | { type: 'REEL'; item: VideoItem; caption: string; coverUrl?: string; thumbOffsetMs?: number; shareToFeed: boolean }
    | { type: 'STORY'; item: MediaItem },
): Promise<string> {
  let params: Record<string, string | number | boolean | undefined>;
  switch (input.type) {
    case 'IMAGE':
      params = { image_url: input.item.url, caption: input.caption || undefined };
      break;
    case 'REEL':
      params = {
        media_type: 'REELS',
        video_url: input.item.url,
        caption: input.caption || undefined,
        cover_url: input.coverUrl,
        thumb_offset: input.thumbOffsetMs,
        share_to_feed: input.shareToFeed,
      };
      break;
    case 'STORY':
      params = {
        media_type: 'STORIES',
        ...(input.item.kind === 'image' ? { image_url: input.item.url } : { video_url: input.item.url }),
      };
      break;
  }
  const res = await graph.post<{ id: string }>(`${igUserId}/media`, params, token);
  return res.id;
}

export async function createCarouselItem(graph: GraphClient, token: string, igUserId: string, item: MediaItem): Promise<string> {
  const params =
    item.kind === 'image'
      ? { image_url: item.url, is_carousel_item: true }
      : { media_type: 'VIDEO', video_url: item.url, is_carousel_item: true };
  const res = await graph.post<{ id: string }>(`${igUserId}/media`, params, token);
  return res.id;
}

export async function createCarouselContainer(
  graph: GraphClient,
  token: string,
  igUserId: string,
  children: string[],
  caption: string,
): Promise<string> {
  const res = await graph.post<{ id: string }>(
    `${igUserId}/media`,
    { media_type: 'CAROUSEL', children: children.join(','), caption: caption || undefined },
    token,
  );
  return res.id;
}

export async function getContainerStatus(graph: GraphClient, token: string, containerId: string): Promise<ContainerStatus> {
  const res = await graph.get<{ status_code: ContainerStatusCode; status?: string }>(
    containerId,
    { fields: 'status_code,status' },
    token,
  );
  return { statusCode: res.status_code, status: res.status ?? null };
}

export async function publishContainer(graph: GraphClient, token: string, igUserId: string, creationId: string): Promise<string> {
  const res = await graph.post<{ id: string }>(`${igUserId}/media_publish`, { creation_id: creationId }, token);
  return res.id;
}

export interface PublishedMedia {
  id: string;
  permalink: string | null;
  timestamp: string | null;
  mediaType: string | null;
  productType: string | null;
  caption: string | null;
  thumbnailUrl: string | null;
  mediaUrl: string | null;
}

const MEDIA_FIELDS = 'id,caption,media_type,media_product_type,permalink,thumbnail_url,media_url,timestamp';

type RawMedia = {
  id: string;
  caption?: string;
  media_type?: string;
  media_product_type?: string;
  permalink?: string;
  thumbnail_url?: string;
  media_url?: string;
  timestamp?: string;
};

function toPublishedMedia(m: RawMedia): PublishedMedia {
  return {
    id: m.id,
    permalink: m.permalink ?? null,
    timestamp: m.timestamp ?? null,
    mediaType: m.media_type ?? null,
    productType: m.media_product_type ?? null,
    caption: m.caption ?? null,
    thumbnailUrl: m.thumbnail_url ?? null,
    mediaUrl: m.media_url ?? null,
  };
}

export async function getMedia(graph: GraphClient, token: string, mediaId: string): Promise<PublishedMedia> {
  return toPublishedMedia(await graph.get<RawMedia>(mediaId, { fields: MEDIA_FIELDS }, token));
}

export async function listRecentMedia(graph: GraphClient, token: string, igUserId: string, limit = 25): Promise<PublishedMedia[]> {
  const res = await graph.get<{ data: RawMedia[] }>(`${igUserId}/media`, { fields: MEDIA_FIELDS, limit }, token);
  return res.data.map(toPublishedMedia);
}

export interface PublishingLimit {
  quotaUsage: number;
  quotaTotal: number | null;
  quotaDurationSeconds: number | null;
}

export async function getPublishingLimit(graph: GraphClient, token: string, igUserId: string): Promise<PublishingLimit> {
  const res = await graph.get<{ data: { quota_usage?: number; config?: { quota_total?: number; quota_duration?: number } }[] }>(
    `${igUserId}/content_publishing_limit`,
    { fields: 'config,quota_usage' },
    token,
  );
  const entry = res.data[0] ?? {};
  return {
    quotaUsage: entry.quota_usage ?? 0,
    quotaTotal: entry.config?.quota_total ?? null,
    quotaDurationSeconds: entry.config?.quota_duration ?? null,
  };
}
