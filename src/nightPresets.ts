import type { StylePreset } from "./styleTypes";
// Reuse existing bundled artwork; no image/model downloads or paid generation.
import padsArt from "./assets/templates/ambient-trance.webp";
import pianoArt from "./assets/templates/bedtime-lullaby.webp";
import acousticArt from "./assets/templates/contemporary-folk.webp";
import spaceArt from "./assets/templates/fantasy-adventure.webp";
import downtempoArt from "./assets/templates/lofi-study-beats.webp";
import jazzArt from "./assets/templates/late-night-jazz.webp";
const production = "Quiet intimate mix, rounded attacks, warm low mids, restrained high frequencies and stable gentle dynamics. No loud percussion, distortion, sharp cymbals, risers, drops or abrupt climaxes.";
const softVoice = "Singer A, a close soft midrange with relaxed diction, narrow melodic range, warm breath and no belt, grit, shouting or choir";
const delivery = "Unhurried softly sung short phrases with long instrumental spaces; no dramatic chorus lift, rap or theatrical delivery";
export const NIGHT_STYLE_PRESETS: Record<string, StylePreset> = {
  "Ambient cloud pads": { id: "night-cloud-pads", nightEligible: true, instrumental: true, genre: "Slow warm ambient with evolving analog pads and a quiet single-note motif", tempo: "48 BPM implied, no drum pulse, sustained floating harmonies in D major", mood: "Peaceful suspended stillness, tiny changes of color, an even restful ending", voice: softVoice, arrangement: "Two warm pad layers, sparse rounded electric-piano notes and distant soft air. Slowly exchange voicings; no dramatic build or percussion", production },
  "Gentle midnight piano": { id: "night-midnight-piano", nightEligible: true, genre: "Minimal gentle felt-piano music with spacious lullaby phrasing", tempo: "58 BPM, C major, quiet unhurried 4/4 with pauses between phrases", mood: "Intimate reassurance, stable gentle feeling, a quiet resolving final phrase", voice: softVoice, delivery, arrangement: "Soft felt piano, a restrained warm pad and occasional low sustained notes. Space between melodies, no drums, bright treble flourishes or large crescendo", production },
  "Soft acoustic evening": { id: "night-soft-acoustic", nightEligible: true, genre: "Quiet fingerpicked acoustic folk with warm nylon-string detail", tempo: "66 BPM, G major, relaxed 4/4 without forceful strumming or backbeat", mood: "Calm close companionship, a modest tender refrain, an easy unwinding ending", voice: softVoice, delivery, arrangement: "Gentle nylon guitar and sparse warm bass; one quiet answering guitar phrase. No heavy percussion, fast picking, sharp string attacks or climactic ensemble entry", production },
  "Space ambient drift": { id: "night-space-drift", nightEligible: true, instrumental: true, genre: "Spacious soft cosmic ambient with deep warm drones and distant rounded synth tones", tempo: "40 BPM implied, free floating phrasing around A, no rhythmic urgency", mood: "Weightless quiet wonder, slow drift, suspended restful closure rather than suspense", voice: softVoice, arrangement: "A low warm drone, a soft slowly moving pad and occasional rounded bell-like tones. Gentle gradual changes only; no ominous hits, piercing shimmer or trailer swell", production },
  "Quiet downtempo glow": { id: "night-downtempo-glow", nightEligible: true, genre: "Soft ambient downtempo with muted electric piano and a barely present brushed pulse", tempo: "64 BPM, E major, easy laid-back 4/4 with low-intensity rhythm", mood: "Low-lit calm, even warm focus, a gradual soft fade with no peak-energy moment", voice: softVoice, delivery, arrangement: "Muted electric piano, pillowy bass, warm pad and a very quiet brushed pulse. No hard kick, snare crack, fast hats, sub-bass drops or dramatic hook entrance", production },
  "Hushed lounge trio": { id: "night-hushed-trio", nightEligible: true, genre: "Quiet intimate late-night jazz trio with soft piano and warm upright bass", tempo: "62 BPM, F major, restrained slow swing without double-time runs", mood: "Sleepy room warmth, unhurried tender melody, a small gentle cadence", voice: softVoice, delivery, arrangement: "Soft piano, warm upright bass and optional barely audible brushes. Sparse exchanges, no bright brass, busy fills, loud solo climax or cymbal crash", production },
};
export const NIGHT_TEMPLATE_ART: Record<string, string> = {
  "Ambient cloud pads": padsArt, "Gentle midnight piano": pianoArt, "Soft acoustic evening": acousticArt,
  "Space ambient drift": spaceArt, "Quiet downtempo glow": downtempoArt, "Hushed lounge trio": jazzArt,
};
