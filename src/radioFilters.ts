import type { Song } from "./api";

export const RADIO_FILTERS_KEY = "yue2-radio-filters-v1";
export type RadioFilters = { genres: string[]; languages: string[]; kinds: string[]; search: string };
export const emptyRadioFilters = (): RadioFilters => ({ genres: [], languages: [], kinds: [], search: "" });
const normalize = (value?: string) => value?.trim().toLowerCase() || "";
export const radioGenre = (song: Song) => normalize(song.genre) || "__unknown__";
export const radioLanguage = (song: Song) => song.instrumental ? "__instrumental__" : normalize(song.lyrics_language)?.replaceAll("_", "-") || "__unknown__";
export function languageLabel(value: string) {
  if (value === "__instrumental__") return "No vocals / instrumental";
  if (value === "__unknown__") return "Unknown language";
  try { return new Intl.DisplayNames(["en"], { type: "language" }).of(value) || value; } catch { return value; }
}
export function loadRadioFilters(raw: string | null): RadioFilters {
  try {
    const saved = JSON.parse(raw || "null");
    const list = (value: unknown) => Array.isArray(value) ? [...new Set(value.filter((item): item is string => typeof item === "string"))].slice(0, 1000) : [];
    return { genres: list(saved?.genres), languages: list(saved?.languages), kinds: list(saved?.kinds).filter(kind => kind === "vocal" || kind === "instrumental"), search: typeof saved?.search === "string" ? saved.search.slice(0, 500) : "" };
  } catch { return emptyRadioFilters(); }
}
export function filterRadioSongs(songs: Song[], filters: RadioFilters): Song[] {
  const search = normalize(filters.search);
  return songs.filter(song => (!filters.genres.length || filters.genres.includes(radioGenre(song)))
    && (!filters.languages.length || filters.languages.includes(radioLanguage(song)))
    && (!filters.kinds.length || filters.kinds.includes(song.instrumental ? "instrumental" : "vocal"))
    && (!search || `${song.title} ${song.artist || ""} ${song.genre || ""}`.toLowerCase().includes(search)));
}
export function radioFilterOptions(songs: Song[], key: "genre" | "language") {
  const options = new Map<string, { value: string; label: string; count: number }>();
  for (const song of songs) {
    const value = key === "genre" ? radioGenre(song) : radioLanguage(song);
    const label = key === "genre" ? song.genre?.trim() || "Unknown genre / style" : languageLabel(value);
    const existing = options.get(value);
    options.set(value, { value, label: existing?.label || label, count: (existing?.count || 0) + 1 });
  }
  return [...options.values()].sort((a, b) => a.label.localeCompare(b.label));
}
