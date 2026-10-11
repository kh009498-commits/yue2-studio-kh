import type { Song } from "./api";

export const EQ_BANDS = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000] as const;
export const EQ_BAND_LABELS = ["32", "64", "125", "250", "500", "1k", "2k", "4k", "8k", "16k"];
export const EQ_FLAT = EQ_BANDS.map(() => 0);

export const EQ_PRESETS: Record<string, number[]> = {
  Flat: EQ_FLAT,
  // Subtle tonal choices for mastered music; playback compensates for the
  // combined filter boost. Bass avoids boosting the muddy 125–250 Hz region.
  Bass: [3, 2, 0, -1, 0, 0, 0, 1, 1, 1],
  Treble: [-1, -1, 0, 0, 0, 0, 1, 2, 2, 2],
  Vocal: [-1, -1, 0, 1, 2, 1, 1, 0, 0, -1],
  Electronic: [2, 2, 0, -1, -1, 0, 1, 1, 2, 2],
  Rock: [2, 1, 0, 0, -1, 0, 1, 2, 1, 1],
  Jazz: [1, 1, 0, -1, -1, 0, 0, 1, 1, 1],
  Acoustic: [0, 0, 0, 1, 1, 0, 0, 1, 1, 0],
  Night: [1, 1, 0, 0, 0, 0, -1, -1, -2, -2],
  Loudness: [2, 1, 0, -1, -1, 0, 0, 1, 2, 1],
};

export function automaticPreset(song: Song | null) {
  if (!song) return "Flat";
  const genre = (song.genre || "").toLowerCase();
  const details = `${song.description || ""} ${song.title || ""}`.toLowerCase();
  const profileFor = (text: string) => {
    if (/edm|electronic|techno|house|trance|drum\s*(&|and)\s*bass|\bdnb\b/.test(text)) return "Electronic";
    if (/rock|metal|punk|grunge/.test(text)) return "Rock";
    if (/jazz/.test(text)) return "Jazz";
    if (/acoustic|folk|orchestra|classical|bluegrass|country/.test(text)) return "Acoustic";
    if (/reggae|hip[- ]?hop|rap|trap|phonk|afrobeat|funk/.test(text)) return "Bass";
    if (/ambient|lullaby|cinematic|soundtrack/.test(text)) return "Night";
    if (!song.instrumental && /pop|r&b|rnb|soul|vocal|gospel/.test(text)) return "Vocal";
    return "";
  };
  return profileFor(genre) || profileFor(details) || "Flat";
}
