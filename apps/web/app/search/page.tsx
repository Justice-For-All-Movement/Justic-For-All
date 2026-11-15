import type { Metadata } from "next";
import Link from "next/link";
import { buildSiteIndex, initiatives, participationPaths, publicResources, searchSitePages } from "@jfa/core";
import { loadPublicSearch, parseSearchQuery, SEARCH_TYPES } from "@jfa/db";

export const dynamic = "force-dynamic";
// Result pages are never indexed by search engines.
export const metadata: Metadata = { title: "Search — Justice For All", robots: { index: false, follow: true } };

const siteIndex = buildSiteIndex(initiatives, participationPaths, publicResources);
type Context = { searchParams: Promise<Record<string, string | string[] | undefined>> };
const one = (v: string | string[] | undefined) => typeof v === "string" ? v : "";

export default async function Search({ searchParams }: Context) {
  const params = await searchParams;
  const raw = one(params.q);
  const query = raw ? parseSearchQuery({ q: raw, type: one(params.type), locale: one(params.locale), page: one(params.page) }) : null;
  const siteHits = query && query.page === 1 ? searchSitePages(siteIndex, query.q) : [];
  const content = query ? await loadPublicSearch(query) : null;
  const pageHref = (page: number) => {
    const next = new URLSearchParams({ q: query?.q ?? "" });
    if (query?.type) next.set("type", query.type);
    next.set("page", String(page));
    return `/search?${next.toString()}`;
  };
  return <div className="wrap public-article">
    <p className="eyebrow">Search</p>
    <h1>Search this site</h1>
    <p className="lede">Search covers this site&apos;s public pages and published, editorially reviewed articles only. It never includes drafts, private submissions or personal information.</p>
    <form role="search" method="get" action="/search">
      <label className="ui-label" htmlFor="search-q">Search terms</label>
      <input className="ui-input" id="search-q" name="q" type="search" defaultValue={raw} minLength={2} maxLength={100} required />
      <label className="ui-label" htmlFor="search-type">Content type</label>
      <select className="ui-input" id="search-type" name="type" defaultValue={query?.type ?? ""}>
        <option value="">All types</option>
        {SEARCH_TYPES.map(t => <option key={t} value={t}>{t === "faq" ? "FAQ" : t[0].toUpperCase() + t.slice(1)}</option>)}
      </select>
      <button type="submit">Search</button>
    </form>
    {raw && !query ? <p role="alert">Enter 2 to 100 characters. Page numbers go up to 20.</p> : null}
    {query ? <section aria-labelledby="results-heading" aria-live="polite">
      <h2 id="results-heading">Results for “{query.q}”</h2>
      {siteHits.length ? <section aria-labelledby="site-results"><h3 id="site-results">Site pages</h3>
        <ul>{siteHits.map(hit => <li key={hit.href}><Link href={hit.href}>{hit.title}</Link> <span className="ui-hint">({hit.section})</span></li>)}</ul>
      </section> : null}
      <section aria-labelledby="article-results"><h3 id="article-results">Published articles</h3>
        {content?.status === "unavailable" ? <p>Article search is temporarily unavailable. Site pages above are still searchable.</p>
          : content?.status === "ok" && content.result.total > 0 ? <>
            <p>{content.result.total} {content.result.total === 1 ? "article" : "articles"} found.</p>
            <ol>{content.result.hits.map(hit => <li key={`${hit.locale}/${hit.slug}`}>
              <h4><Link href={hit.url}>{hit.title}</Link></h4>
              <p className="ui-hint">{hit.type} · published <time dateTime={hit.publishedAt}>{hit.publishedAt.slice(0, 10)}</time> · {hit.evidenceLabel}</p>
              <p>{hit.snippet.map((part, i) => part.match ? <mark key={i}>{part.text}</mark> : <span key={i}>{part.text}</span>)}</p>
            </li>)}</ol>
            {content.result.pageCount > 1 ? <nav aria-label="Search result pages"><ul>
              {query.page > 1 ? <li><Link href={pageHref(query.page - 1)} rel="prev">Previous page</Link></li> : null}
              <li aria-current="page">Page {query.page} of {content.result.pageCount}</li>
              {query.page < content.result.pageCount ? <li><Link href={pageHref(query.page + 1)} rel="next">Next page</Link></li> : null}
            </ul></nav> : null}
          </> : <p>No published articles match.</p>}
      </section>
    </section> : null}
  </div>;
}
