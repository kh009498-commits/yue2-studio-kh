import type { StylePreset } from "./styleTypes";
import { playableSong } from "./liveJukebox";
export const LIVE_SELECTION_KEY = "yue2-live-selection-v1";
export const NIGHT_GUIDANCE = "Quiet night listening; gentle dynamics throughout, softened attacks, warm restrained highs, no loud percussion, distortion, harsh vocals, abrupt transitions, drops or climactic swells. If vocals are used, sing softly with space between phrases; no belting, shouting or dense choir.";
export const NIGHT_EXCLUSIONS = "loud percussion, distorted guitars, harsh vocals, screaming, abrupt climaxes, explosive drops, sharp cymbals, aggressive bass";
export type LiveSelection = { version: 1; mode: "custom" | "night"; custom: Record<string, boolean>; night: Record<string, boolean>; customDefault: boolean; nightDefault: boolean; customVoices: "mixed" | "prefer" | "only"; nightVoices: "mixed" | "prefer" | "only"; approved: { custom: string[]; night: string[] } };
export function templateId(name: string, preset: StylePreset) {
  const value = preset.id || `legacy:${encodeURIComponent(name)}`;
  if (value.length <= 240) return value;
  let hash = 14695981039346656037n;
  for (const character of value) hash = BigInt.asUintN(64, (hash ^ BigInt(character.codePointAt(0)!)) * 1099511628211n);
  return `long-template:${hash.toString(16)}`;
}
function decisions(value: unknown): Record<string, boolean> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([id, enabled]) => id.length > 0 && id.length <= 240 && typeof enabled === "boolean").slice(0, 5000));
}
const voices = (value: unknown, fallback: "mixed" | "prefer") => value === "mixed" || value === "prefer" || value === "only" ? value : fallback;
function approvedIds(value: unknown): string[] {
  return Array.isArray(value) ? [...new Set(value.filter((id): id is string => typeof id === "string" && id.length > 0 && id.length <= 512))].slice(0, 20000) : [];
}
export function approvedSongs(settings: LiveSelection) { return settings.approved[settings.mode]; }
export function loadLiveSelection(raw?: string | null): LiveSelection {
  const defaults: LiveSelection = { version: 1, mode: "custom", custom: {}, night: {}, customDefault: true, nightDefault: true, customVoices: "mixed", nightVoices: "prefer", approved: { custom: [], night: [] } };
  if (!raw) return defaults;
  try {
    const data = JSON.parse(raw);
    if (data?.version !== 1 || !["custom", "night"].includes(data.mode)) throw new Error("invalid selection");
    return { ...defaults, mode: data.mode, custom: decisions(data.custom), night: decisions(data.night), customDefault: data.customDefault === true,
      nightDefault: data.nightDefault === true, customVoices: voices(data.customVoices, "mixed"), nightVoices: voices(data.nightVoices, "prefer"),
      approved: { custom: approvedIds(data.approved?.custom), night: approvedIds(data.approved?.night) } };
  } catch { return { ...defaults, customDefault: false, nightDefault: false }; } // corrupt saved exclusions never broaden
}
export function templateEnabled(name: string, preset: StylePreset, settings: LiveSelection) {
  const decision = settings[settings.mode][templateId(name, preset)];
  if (decision != null) return decision;
  return settings.mode === "night" ? settings.nightDefault && preset.nightEligible === true : settings.customDefault;
}
export function selectedTemplates(presets: Record<string, StylePreset>, settings: LiveSelection) {
  return Object.keys(presets).filter(name => templateEnabled(name, presets[name], settings));
}
export function vocalPreference(settings: LiveSelection) { return settings.mode === "night" ? settings.nightVoices : settings.customVoices; }
type HistoricalSong = { id: string; audio_url?: string; duration?: number; template_id?: string; genre?: string; instrumental?: boolean };
export function songTemplate(song: HistoricalSong, presets: Record<string, StylePreset>): string | null {
  if (song.template_id) {
    const matches = Object.keys(presets).filter(name => templateId(name, presets[name]) === song.template_id);
    return matches.length === 1 ? matches[0] : null;
  }
  const genre = song.genre?.trim().toLowerCase();
  if (!genre) return null;
  const matches = Object.keys(presets).filter(name => name.trim().toLowerCase() === genre);
  return matches.length === 1 ? matches[0] : null; // no fuzzy "ambient" guesses
}
export function songEligible(song: HistoricalSong, presets: Record<string, StylePreset>, settings: LiveSelection) {
  const chosen = selectedTemplates(presets, settings);
  if (!chosen.length || !playableSong(song) || (vocalPreference(settings) === "only" && song.instrumental !== true)) return false;
  const name = songTemplate(song, presets);
  if (name) return templateEnabled(name, presets[name], settings); // approval cannot bypass known exclusions
  return approvedSongs(settings).includes(song.id) || (settings.mode === "custom" && chosen.length === Object.keys(presets).length);
}
export function selectTemplates(settings: LiveSelection, presets: Record<string, StylePreset>, enabled: boolean): LiveSelection {
  const mode = settings.mode;
  const choices = Object.fromEntries(Object.keys(settings[mode]).map(id => [id, enabled]));
  for (const name of Object.keys(presets)) choices[templateId(name, presets[name])] = enabled;
  return { ...settings, [mode]: choices, [mode === "night" ? "nightDefault" : "customDefault"]: enabled };
}
