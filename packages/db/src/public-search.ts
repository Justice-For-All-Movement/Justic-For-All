import type { PoolClient } from "pg";
import { getSharedPool } from "./pool.ts";

export const SEARCH_TYPES = ["page", "article", "resource", "faq"] as const;
export type SearchType = typeof SEARCH_TYPES[number];
export const SEARCH_PAGE_SIZE = 10;
export const SEARCH_MAX_PAGE = 20;

export type SearchQuery = Readonly<{ q: string; type?: SearchType; locale: string; page: number }>;
export type SnippetPart = Readonly<{ text: string; match: boolean }>;
export type PublicSearchHit = Readonly<{
  slug: string; locale: string; type: SearchType; title: string; summary: string;
  snippet: readonly SnippetPart[]; url: string; publishedAt: string; evidenceLabel: string;
}>;
export type PublicSearchResult = Readonly<{ query: SearchQuery; total: number; hits: readonly PublicSearchHit[]; pageCount: number }>;

const LOCALE = /^[a-z]{2}(?:-[A-Z]{2})?$/;
const START = "\u0002", STOP = "\u0003";

/** Validates untrusted query-string input; returns null for anything unusable. */
export function parseSearchQuery(input: { q?: unknown; type?: unknown; locale?: unknown; page?: unknown }): SearchQuery | null {
  const q = typeof input.q === "string" ? input.q.normalize("NFKC").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim() : "";
  if (q.length < 2 || q.length > 100) return null;
  const type = typeof input.type === "string" && input.type !== "" ? input.type : undefined;
  if (type !== undefined && !(SEARCH_TYPES as readonly string[]).includes(type)) return null;
  const locale = typeof input.locale === "string" && input.locale !== "" ? input.locale : "en";
  if (!LOCALE.test(locale)) return null;
  const rawPage = typeof input.page === "string" && input.page !== "" ? input.page : "1";
  if (!/^\d{1,2}$/.test(rawPage)) return null;
  const page = Number(rawPage);
  if (page < 1 || page > SEARCH_MAX_PAGE) return null;
  return Object.freeze({ q, type: type as SearchType | undefined, locale, page });
}

/** Turns ts_headline output with control-character delimiters into text parts. */
export function splitHighlight(headline: string): SnippetPart[] {
  const parts: SnippetPart[] = [];
  let rest = headline;
  while (rest.length) {
    const start = rest.indexOf(START);
    if (start < 0) { parts.push({ text: rest, match: false }); break; }
    if (start > 0) parts.push({ text: rest.slice(0, start), match: false });
    const stop = rest.indexOf(STOP, start + 1);
    const end = stop < 0 ? rest.length : stop;
    parts.push({ text: rest.slice(start + 1, end), match: true });
    rest = stop < 0 ? "" : rest.slice(stop + 1);
  }
  return parts.filter(p => p.text.length > 0).map(p => ({ text: p.text.replace(/[\u0002\u0003]/g, ""), match: p.match }));
}

type Row = { slug: string; locale: string; entry_type: SearchType; title: string; summary: string; headline: string; published_at: Date; total: string };

/** Reads only the core_public_search view (current, public, two-person-approved revisions). */
export async function searchPublicContent(client: PoolClient, query: SearchQuery): Promise<PublicSearchResult> {
  const offset = (query.page - 1) * SEARCH_PAGE_SIZE;
  const result = await client.query<Row>(`
    WITH q AS (SELECT websearch_to_tsquery('english', $1) AS tsq)
    SELECT s.slug, s.locale, s.entry_type, s.title, s.summary, s.published_at,
      ts_headline('english', s.body_text, q.tsq,
        'StartSel=' || chr(2) || ', StopSel=' || chr(3) || ', MaxWords=30, MinWords=12, MaxFragments=2, FragmentDelimiter=" … "') AS headline,
      count(*) OVER () AS total
    FROM core_public_search s, q
    WHERE s.search_vector @@ q.tsq AND s.locale = $2 AND ($3::text IS NULL OR s.entry_type = $3)
    ORDER BY ts_rank_cd(s.search_vector, q.tsq) DESC, s.published_at DESC, s.slug
    LIMIT $4 OFFSET $5`, [query.q, query.locale, query.type ?? null, SEARCH_PAGE_SIZE, offset]);
  const total = result.rows.length ? Number(result.rows[0].total) : 0;
  const hits = result.rows.map(row => Object.freeze({
    slug: row.slug, locale: row.locale, type: row.entry_type, title: row.title, summary: row.summary,
    snippet: Object.freeze(splitHighlight(row.headline)), url: `/articles/${row.slug}`,
    publishedAt: row.published_at.toISOString(),
    evidenceLabel: "Editorially reviewed publication — not independent verification of every claim."
  }));
  return Object.freeze({ query, total, hits: Object.freeze(hits), pageCount: Math.min(SEARCH_MAX_PAGE, Math.ceil(total / SEARCH_PAGE_SIZE)) });
}

export async function loadPublicSearch(query: SearchQuery, env: NodeJS.ProcessEnv = process.env):
  Promise<{ status: "ok"; result: PublicSearchResult } | { status: "unavailable" }> {
  const pool = getSharedPool(env);
  if (!pool) return { status: "unavailable" };
  try {
    const client = await pool.connect();
    try { return { status: "ok", result: await searchPublicContent(client, query) }; }
    finally { client.release(); }
  } catch {
    return { status: "unavailable" };
  }
}

/** Current published articles for the sitemap; empty (never an error) when the DB is unavailable. */
export async function loadSitemapArticles(env: NodeJS.ProcessEnv = process.env): Promise<{ slug: string; publishedAt: string }[]> {
  const pool = getSharedPool(env);
  if (!pool) return [];
  try {
    const result = await pool.query<{ slug: string; published_at: Date }>(
      "SELECT slug, published_at FROM core_public_search WHERE locale = 'en' ORDER BY published_at DESC LIMIT 5000");
    return result.rows.map(r => ({ slug: r.slug, publishedAt: r.published_at.toISOString() }));
  } catch {
    return [];
  }
}
