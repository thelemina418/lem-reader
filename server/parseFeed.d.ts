import type { FeedItemPreview } from "../src/content/schema";
/** The bounded, display-ready feed shape parseFeedXml returns. */
export interface ParsedFeed {
    title: string;
    description?: string;
    items: FeedItemPreview[];
}
/**
 * parseFeedXml — parse fetched feed XML into the bounded ParsedFeed.
 * Recognizes RSS 2.0 (rss.channel.item) and Atom (feed.entry); anything
 * else — malformed XML, hostile DTDs, non-feed XML (including an HTML
 * challenge page that slipped a text/xml header) — refuses
 * `feed-unreadable`. A STRUCTURALLY VALID feed with zero items is accepted
 * with an empty items array (the Discover surface renders its honest
 * no-recent-items line) — the refusal is for payloads with no recognizable
 * feed shape, not for quiet feeds. `fallbackTitle` is the hostname the
 * caller derived from the final URL (the article title chain's hostname
 * fallback) for channels that ship no title.
 */
export declare function parseFeedXml(text: string, fallbackTitle: string): ParsedFeed;
