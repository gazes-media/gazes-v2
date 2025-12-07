

export interface AnimeSeason {
  name: string;
  url: string;
  type: string; // e.g. 'Anime', 'Kai', 'Film', etc.
}

export interface AnimeInfo {
  title: string;
  altTitle?: string;
  cover: string;
  banner?: string;
  synopsis: string;
  genres: string[];
  manga: { name: string; url: string }[];
  seasons: AnimeSeason[];
}

// Helper function to extract season number from name or URL
function extractSeasonNumber(text: string): number | null {
  if (!text) return null;

  // Look for patterns like "Saison 1", "Season 1", "S1", etc.
  const patterns = [
    /saison\s*(\d+)/i,
    /season\s*(\d+)/i,
    /\bs(\d+)\b/i,
    /(\d+)(?:st|nd|rd|th)?\s*(?:saison|season)/i
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      return parseInt(match[1]);
    }
  }

  // If no season number found, check if it's a special case like "Film" or "OAV"
  if (text.toLowerCase().includes('film') || text.toLowerCase().includes('oav')) {
    return 0; // Special season number for movies/OAVs
  }

  return null;
}

export function parseAnimePage(html: string): AnimeInfo {
  // Extract title
  const titleMatch = html.match(/id="titreOeuvre"[^>]*>([^<]+)</i);
  const title = titleMatch ? (titleMatch[1]?.trim() || "Unknown Title") : "Unknown Title";

  // Extract alt title
  const altTitleMatch = html.match(/id="titreAlter"[^>]*>([^<]+)</i);
  const altTitle = altTitleMatch && altTitleMatch[1]?.trim() ? altTitleMatch[1]?.trim() : undefined;

  // Extract cover
  const coverMatch = html.match(/id="coverOeuvre"[^>]*src="([^"]+)"/i);
  const ogImageMatch = html.match(/property="og:image"[^>]*content="([^"]+)"/i);
  let cover = coverMatch?.[1] || ogImageMatch?.[1] || "";
  let banner = ogImageMatch?.[1] || undefined;
  if (banner && cover && banner === cover) banner = undefined;

  // Extract synopsis
  const synopsisMatch = html.match(/<h2[^>]*>Synopsis<\/h2>\s*<p[^>]*>([^<]+)<\/p>/i);
  const synopsis = synopsisMatch ? (synopsisMatch[1]?.trim() || "") : "";

  // Extract genres
  const genresMatch = html.match(/<h2[^>]*>Genres<\/h2>\s*<a[^>]*>([^<]+)<\/a>/i);
  const genres = genresMatch ? (genresMatch[1] || "").split(",").map(g => g.trim()).filter(Boolean) : [];

  // For seasons and manga, use regex to find panneauAnime and panneauScan calls
  const seasons: AnimeSeason[] = [];
  const manga: { name: string; url: string }[] = [];

  // Parse panneauAnime calls - exclude commented ones
  // Remove all comments (/* ... */) from HTML first
  const uncommentedHtml = html.replace(/\/\*[\s\S]*?\*\//g, '');

  let match;
  const panneauAnimeRegex = /panneauAnime\(\s*"([^"]+)"\s*,\s*"([^"]+)"\s*\)/g;
  while ((match = panneauAnimeRegex.exec(uncommentedHtml)) !== null) {
    const name = (match[1] || "").trim();
    const url = (match[2] || "").trim();
    if (name && url && name.toLowerCase() !== "nom" && !url.includes("/catalogue/naruto/url")) {
      // Determine type from context or default to Anime
      // For simplicity, assume Anime unless Kai
      let type = "Anime";
      if (html.includes("Anime Version Kai") && html.indexOf("Anime Version Kai") < match.index) {
        type = "Kai";
      }
      seasons.push({ name, url, type });
    }
  }

  // Find all panneauScan calls for manga
  const mangaLinkRegex = /<a[^>]*href="([^"]*)"[^>]*class="[^"]*shrink-0[^"]*grid[^"]*items-center[^"]*grayscale[^"]*"[^>]*>[\s\S]*?<div[^>]*>([^<]*)<\/div><\/a>/gi;
  while ((match = mangaLinkRegex.exec(html)) !== null) {
    const url = (match[1] || "").trim();
    const name = (match[2] || "").trim();
    if (name && url) {
      manga.push({ name, url });
    }
  }

  // Fallback for manga: if no manga found with the new method, try the old JavaScript parsing method
  if (manga.length === 0) {
    const panneauScanRegex = /panneauScan\(\s*"([^"]+)"\s*,\s*"([^"]+)"\s*\)/g;
    while ((match = panneauScanRegex.exec(html)) !== null) {
      const name = (match[1] || "").trim();
      const url = (match[2] || "").trim();
      if (name && url) {
        manga.push({ name, url });
      }
    }
  }

  // Deduplicate seasons - use URL as the primary deduplication key to preserve distinct content
  const seasonMap = new Map<string, AnimeSeason>();
  const uniqueSeasons = seasons.filter(s => {
    // Create a unique key based on the content path (without language)
    const contentPath = s.url.replace(/\/(vostfr|vf|va|var|vkr|vcn|vqc|vf1|vf2|vj|vo|raw|vq)$/, '');

    // If we haven't seen this content path yet, keep it
    if (!seasonMap.has(contentPath)) {
      seasonMap.set(contentPath, s);
      return true;
    }

    // This is a duplicate (same content, different language)
    return false;
  });

  // Deduplicate manga
  const seenManga = new Set<string>();
  const uniqueManga = manga.filter(m => {
    if (seenManga.has(m.url)) return false;
    seenManga.add(m.url);
    return true;
  });

  return {
    title,
    altTitle,
    cover,
    banner,
    synopsis,
    genres,
    manga: uniqueManga,
    seasons: uniqueSeasons,
  };
}
import type { SearchResponse } from "../types/searchResponse";

export function parseAnimeResults(html: string, baseUrl?: string): SearchResponse {
  const results: SearchResponse = [];

  // Try multiple regex patterns to handle different HTML structures
  // Ignoring domain pattern - accept any domain
  const regexPatterns = [
    // New pattern with asn-search-result classes and subtitle <p>
    /<a[^>]*class="asn-search-result"[^>]*href="[^"]*\/catalogue\/([^"\/]+)\/?[^"]*"[^>]*>[\s\S]*?<img[^>]*src="([^"]*)"[^>]*>[\s\S]*?<h3[^>]*class="asn-search-result-title"[^>]*>([^<]*)<\/h3>[\s\S]*?<p[^>]*class="asn-search-result-subtitle"[^>]*>([^<]*)<\/p>[\s\S]*?<\/a>/gi,
    // Original pattern with <p> for aliases
    /<a[^>]*href="[^"]*\/catalogue\/([^"\/]+)\/?[^"]*"[^>]*>[\s\S]*?<img[^>]*src="([^"]*)"[^>]*>[\s\S]*?<h3[^>]*>([^<]*)<\/h3>[\s\S]*?<p[^>]*>([^<]*)<\/p>[\s\S]*?<\/a>/gi,
    // Pattern without <p> (title only)
    /<a[^>]*href="[^"]*\/catalogue\/([^"\/]+)\/?[^"]*"[^>]*>[\s\S]*?<img[^>]*src="([^"]*)"[^>]*>[\s\S]*?<h3[^>]*>([^<]*)<\/h3>[\s\S]*?<\/a>/gi,
    // Alternative pattern with div instead of h3
    /<a[^>]*href="[^"]*\/catalogue\/([^"\/]+)\/?[^"]*"[^>]*>[\s\S]*?<img[^>]*src="([^"]*)"[^>]*>[\s\S]*?<div[^>]*>([^<]*)<\/div>[\s\S]*?<\/a>/gi
  ];

  console.log(`[PARSE_SEARCH] Parsing HTML (accepting any domain)`)

  for (let patternIndex = 0; patternIndex < regexPatterns.length; patternIndex++) {
    const animeRegex = regexPatterns[patternIndex];
    if (!animeRegex) continue;

    console.log(`[PARSE_SEARCH] Trying pattern ${patternIndex + 1}:`, animeRegex.source.substring(0, 100) + '...')

    let match: RegExpExecArray | null;
    let matchCount = 0;

    while ((match = animeRegex.exec(html)) !== null) {
      matchCount++;
      const groups = match.length;
      const slug = match[1]; // The catalogue slug
      const image = match[2];
      const title = match[3];
      const aliasesText = groups > 4 ? match[4] : ''; // aliases might not exist in some patterns

      console.log(`[PARSE_SEARCH] Pattern ${patternIndex + 1} match ${matchCount}: title="${title}", slug="${slug}", image="${image}"`)

      if (!title?.trim() || !slug) {
        console.log(`[PARSE_SEARCH] Skipping match ${matchCount}: missing title or slug`)
        continue;
      }

      const aliases = aliasesText?.trim()
        ? aliasesText
          .split(",")
          .map((alias) => alias.trim())
          .filter(Boolean)
        : [];

      // The slug is already extracted correctly
      const id = slug;

      if (!id || id === "catalogue") {
        console.log(`[PARSE_SEARCH] Skipping match ${matchCount}: invalid id "${id}"`)
        continue;
      }

      results.push({
        title: title.trim(),
        id,
        image: image || "",
      });
    }

    console.log(`[PARSE_SEARCH] Pattern ${patternIndex + 1} found ${matchCount} matches`)

    // If we found results with this pattern, stop trying other patterns
    if (results.length > 0) {
      break;
    }
  }

  console.log(`[PARSE_SEARCH] Total valid results: ${results.length}`)

  return results;
}

export interface CatalogueItem {
  id: string;
  title: string;
  image: string;
  type?: string; // e.g. 'Anime', 'Scans', etc.
}

// Parse the catalogue grid page for items. It contains anchors with posters and titles.
// We use regex for basic parsing.
export function parseCataloguePage(html: string): CatalogueItem[] {
  const items: CatalogueItem[] = [];

  // Try multiple regex patterns to handle different HTML structures
  const itemRegexPatterns = [
    // New structure with asn-search-result classes
    /<a[^>]*href="(?:https?:\/\/[^\/]+)?\/catalogue\/([^"\/]+)\/?[^"]*"[^>]*class="asn-search-result"[^>]*>[\s\S]*?<img[^>]*src="([^"]*)"[^>]*>[\s\S]*?<h3[^>]*class="asn-search-result-title"[^>]*>([^<]*)<\/h3>/gi,
    // Old structure with card-title
    /<a[^>]*href="(?:https?:\/\/[^\/]+)?\/catalogue\/([^"\/]+)\/?[^"]*"[^>]*>[\s\S]*?<img[^>]*src="([^"]*)"[^>]*>[\s\S]*?<h2[^>]*class="card-title"[^>]*>([^<]*)<\/h2>/gi,
    // Fallback pattern without specific classes
    /<a[^>]*href="(?:https?:\/\/[^\/]+)?\/catalogue\/([^"\/]+)\/?[^"]*"[^>]*>[\s\S]*?<img[^>]*src="([^"]*)"[^>]*>[\s\S]*?<(?:h2|h3)[^>]*>([^<]*)<\/(?:h2|h3)>/gi,
  ];

  for (const itemRegex of itemRegexPatterns) {
    let match;
    while ((match = itemRegex.exec(html)) !== null) {
      const slug = match[1];
      const image = match[2];
      const title = match[3]?.trim() || "";

      if (slug && image && title) {
        // Determine type: default to Anime, check for Scans or Film
        let type: string = 'Anime';
        const anchorText = match[0];
        if (anchorText.includes(' Scans')) type = 'Scans';
        else if (anchorText.includes(' Film ')) type = 'Film';

        items.push({ id: slug, title, image, type });
      }
    }

    // If we found results with this pattern, stop trying other patterns
    if (items.length > 0) {
      break;
    }
  }

  // Deduplicate by id
  const seen = new Set<string>();
  return items.filter(item => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}
