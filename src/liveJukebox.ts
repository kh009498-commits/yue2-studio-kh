// Pure shuffle/pause state: no provider calls, credentials or raw error storage.
export const LIVE_STORAGE_KEY = "yue2-live-jukebox-v1";
export type LiveReason = "credits" | "rate-limit" | "writing" | "generation" | "connection" | "timeout";
export type LiveEvent = "paused" | "resumed" | "unplayable" | "empty";
const reasons: LiveReason[] = ["credits", "rate-limit", "writing", "generation", "connection", "timeout"];
export const LIVE_REASON_LABELS: Record<LiveReason, string> = {
  credits: "Writing credits or quota need attention.",
  "rate-limit": "The writing provider is temporarily limited.",
  writing: "Writing is unavailable.", generation: "Generation is unavailable.",
  connection: "The local service is unavailable.", timeout: "A request took too long.",
};
export function liveFailureReason(error: unknown, fallback: LiveReason): LiveReason {
  // Inspect only to classify. Never return, persist or log the original message.
  const text = typeof error === "string" ? error : error && typeof error === "object" && "message" in error && typeof error.message === "string" ? error.message : "";
  if (/\b402\b|resource_exhausted|prepay|credits?[^\n]{0,40}(deplet|exhaust|insufficient)|quota/i.test(text)) return "credits";
  if (/\b429\b|rate.limit/i.test(text)) return "rate-limit";
  if (/timeout|timed out|took too long/i.test(text)) return "timeout";
  return fallback;
}
type Candidate = { id: string; audio_url?: string; duration?: number };
export function playableSong(song: Candidate | undefined): boolean {
  return Boolean(song && typeof song.id === "string" && song.id &&
    typeof song.audio_url === "string" && song.audio_url.startsWith("/api/library/") &&
    (song.duration == null || (Number.isFinite(song.duration) && song.duration > 0)));
}
type Snapshot = { version: 1; paused: boolean; reason: LiveReason; bag: string[]; seen: string[]; played: string[]; blocked: string[]; last: string | null };
const ids = (value: unknown): string[] => Array.isArray(value)
  ? [...new Set(value.filter((id): id is string => typeof id === "string" && id.length > 0 && id.length <= 512))].slice(-20000) : [];
function shuffle(items: string[], random: () => number) {
  for (let i = items.length - 1; i > 0; --i) {
    const j = Math.floor(random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}
export class LiveJukebox {
  state: Snapshot = { version: 1, paused: false, reason: "generation", bag: [], seen: [], played: [], blocked: [], last: null };
  constructor(raw?: string | null, private random: () => number = Math.random) {
    try {
      const saved = JSON.parse(raw || "null");
      if (saved?.version === 1) this.state = { version: 1, paused: saved.paused === true,
        reason: reasons.includes(saved.reason) ? saved.reason : "generation",
        bag: ids(saved.bag), seen: ids(saved.seen), played: ids(saved.played), blocked: ids(saved.blocked),
        last: typeof saved.last === "string" && saved.last.length <= 512 ? saved.last : null };
    } catch { /* Invalid/private storage starts clean. */ }
  }
  snapshot() { return JSON.stringify(this.state); }
  pause(reason: LiveReason) {
    if (this.state.paused) return false; // latch first failure; never retry automatically
    this.state.paused = true; this.state.reason = reason; return true;
  }
  resume() { this.state.paused = false; }
  block(id: string) { this.state.blocked = ids([...this.state.blocked, id]); this.state.bag = this.state.bag.filter(value => value !== id); }
  played(id: string) { this.state.last = id; this.state.played = ids([...this.state.played.filter(value => value !== id), id]); }
  reserve(queued: string[]) {
    this.state.seen = ids([...this.state.seen, ...queued]);
    const taken = new Set(queued); this.state.bag = this.state.bag.filter(id => !taken.has(id));
  }
  eligible(songs: Candidate[]) {
    const blocked = new Set(this.state.blocked);
    return [...new Set(songs.filter(song => playableSong(song) && !blocked.has(song.id)).map(song => song.id))];
  }
  draw(songs: Candidate[], count: number, reserved: string[] = [], boundary = this.state.last): string[] {
    const pool = this.eligible(songs); const available = new Set(pool);
    const occupied = new Set<string>(); // selections in this cycle/call
    const queued = reserved.filter(id => available.has(id));
    this.state.seen = this.state.seen.filter(id => available.has(id));
    this.state.bag = this.state.bag.filter(id => available.has(id) && !this.state.seen.includes(id));
    const added = pool.filter(id => !this.state.seen.includes(id) && !this.state.bag.includes(id));
    this.state.bag.push(...shuffle(added, this.random));
    const selected: string[] = [];
    for (let n = 0; n < Math.max(0, count); ++n) {
      if (!this.state.bag.length && pool.length) {
        // Drain the old cycle before reserving the next. Otherwise a buffer as
        // large as the catalog forces the same order forever. The last old
        // track can remain on air while the freshly shuffled cycle is queued.
        if (selected.length || queued.length > 1 || (pool.length === 1 && queued.length)) break;
        this.state.seen = []; this.state.bag = shuffle([...pool], this.random);
      }
      let i = this.state.bag.findIndex(id => !occupied.has(id) && id !== boundary);
      if (i < 0) i = this.state.bag.findIndex(id => !occupied.has(id));
      if (i < 0) break; // all remaining songs already queued; wait for playback
      const [id] = this.state.bag.splice(i, 1);
      selected.push(id); occupied.add(id); this.state.seen.push(id); boundary = id;
    }
    return selected;
  }
}
export function withLiveDeadline<T>(operation: Promise<T>, milliseconds: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Live request timeout")), milliseconds);
    operation.then(value => { clearTimeout(timer); resolve(value); }, error => { clearTimeout(timer); reject(error); });
  });
}
