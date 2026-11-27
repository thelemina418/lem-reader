# Embedded content appears as cards captured at ingest; nothing third-party loads while reading

The content scope used to exclude embeds entirely: an iframe became an unsupported-content note with no link to what it was. That leaves a reader with nothing whenever an article is built around a video or a social post. We decided to bring embeds in as **embed cards**: when the article is added, ingestion records what the embedded thing is (video or post), its provider, author, text or title, and a thumbnail stored locally like a figure, plus a link to the original. A post's text is reading text: highlightable, read aloud, and counted in reading time. No third-party player, script, or frame is ever loaded while reading, and playback always opens the original. A YouTube card also offers to add the video's transcript to the library.

We chose captured cards because live embeds would break what the reader is for: the renderer never fetches remote content, the canonical document model is the security boundary, and third-party players bring motion, tracking, and layout shifts that work against calm, stable reading.

## Considered options

- **Card plus click-to-load player** (rejected): even an explicitly requested player brings third-party code and remote fetches into the reading surface, and it complicates pagination and the security boundary for little gain over opening the original.
- **Live embeds as on the original page** (rejected): for the reasons above.
- **Reusing figure or quotation blocks for cards** (rejected): a card needs its provider, link, and actions, and must be told apart from the author's own figures and quotations, so it is its own block type.

## Consequences

- Ingestion may contact known providers' public oEmbed and thumbnail endpoints (YouTube, Vimeo, X, Bluesky, Mastodon first). These requests go through the existing protections against reaching private or internal addresses, and count toward the existing size and time limits. When a lookup fails, the card is built from the page's own markup, still with a link.
- A card that could not capture its content (an Instagram post with only a link, an unrecognized embed) says so on itself. That alone does not flag the article, because the card discloses the limit where it occurs.
- Articles already in the library gain cards only through reprocessing, which is always the reader's explicit choice.
