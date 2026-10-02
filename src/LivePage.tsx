import { useEffect, useMemo, useRef, useState } from "react";
import { abortWriting, assistWriting, generate, getJob, getLibrary, getStatus, getVoiceProfiles, voiceAvatarUrl, type Job, type Song } from "./api";
import { EMPTY_VOICE_SLOTS } from "./createForm";
import type { StylePreset } from "./styleTypes";
import type { VoiceProfile } from "./voiceProfiles";
import { CAST_ROLL, castHint, randomCast, randomSlots, reelVoices, vocalGenderFor, type LiveCast } from "./liveCast";
import SongVisualizer from "./SongVisualizer";
import EqPanel from "./EqPanel";
import useAutoEq from "./useAutoEq";
import "./LivePage.css";
import { LiveJukebox, LIVE_STORAGE_KEY, LIVE_REASON_LABELS, liveFailureReason, playableSong, withLiveDeadline, type LiveReason } from "./liveJukebox";
import { recordLiveEvent } from "./api";
import castInstrumental from "./assets/live/instrumental.png";
import castFemale from "./assets/live/female.png";
import castMale from "./assets/live/male.png";
import castDuet from "./assets/live/duet.png";
import castFemaleDuo from "./assets/live/female-duo.png";
import castMaleDuo from "./assets/live/male-duo.png";

const CAST_ART: Record<LiveCast, string> = {
  instrumental: castInstrumental,
  female: castFemale,
  male: castMale,
  duet: castDuet,
  "female-duo": castFemaleDuo,
  "male-duo": castMaleDuo,
};

const bundledVoices = import.meta.glob("./assets/voices/*.webp", { eager: true, import: "default" }) as Record<string, string>;

function voiceArt(id: string, voices: VoiceProfile[]) {
  if (!id) return "";
  const profile = voices.find((item) => item.id === id);
  if (profile?.avatar === "custom") return voiceAvatarUrl(profile.id, profile.updated_at || "");
  return bundledVoices[`./assets/voices/${id}.webp`] || "";
}

function voiceName(id: string, voices: VoiceProfile[]) {
  return voices.find((item) => item.id === id)?.name || "—";
}

const MIN_BUFFER_SIZE = 3;
const DEFAULT_BUFFER_SIZE = 5;
const INSTRUMENTAL_LOCK = "instrumental, no vocals, no humming, no vocables, no oohs, no aahs, no choir, no rap, no vocal chops, lead instrument only";

type Pick = { id: string; template: string; instrumental: boolean; cast: LiveCast; female: string; male: string; title?: string };
type Props = {
  ready: boolean;
  presets: Record<string, StylePreset>;
  art: Record<string, string>;
  songs: Song[];
  coverSources: Record<string, string>;
  onLeaveLibraryPlay: () => void;
  onRefresh: () => Promise<void>;
  onAnalyserChange: (analyser: AnalyserNode | null) => void;
  onPlaybackChange: (playing: boolean) => void;
  onCurrentChange: (songId: string | null) => void;
};

function liveSrc(song: Song) {
  const path = song.audio_url.split("?")[0];
  if ("__TAURI_INTERNALS__" in window) return `http://127.0.0.1:7794${path}`;
  return `${window.location.origin}${path}`;
}

function liveDescription(preset: StylePreset, instrumental: boolean, slots?: { female: string; male: string }) {
  const parts = [preset.genre];
  if (instrumental) parts.push(INSTRUMENTAL_LOCK);
  else {
    if (!(slots?.female || slots?.male)) parts.push(preset.voice);
    if (preset.delivery) parts.push(preset.delivery);
  }
  parts.push(preset.arrangement, preset.mood, preset.tempo, preset.production);
  return parts.filter(Boolean).join(", ");
}

function randomPick(names: string[], profiles: VoiceProfile[], avoid: string[] = []): Pick {
  const blocked = new Set(avoid);
  const pool = names.filter((name) => !blocked.has(name));
  const choices = pool.length ? pool : names;
  const cast = randomCast();
  const slots = randomSlots(cast, profiles);
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    template: choices[Math.floor(Math.random() * choices.length)],
    instrumental: cast === "instrumental",
    cast,
    female: slots.female,
    male: slots.male,
  };
}

export default function LivePage({ ready, presets, art, songs, coverSources, onLeaveLibraryPlay, onRefresh, onAnalyserChange, onPlaybackChange, onCurrentChange }: Props) {
  // Parent refresh changes identity on every render, including the render caused
  // by completing a song. It must not tear down the in-flight job poll.
  const refreshRef = useRef(onRefresh);
  refreshRef.current = onRefresh;
  const names = useMemo(() => Object.keys(presets), [presets]);
  const [voices, setVoices] = useState<VoiceProfile[]>([]);
  const [on, setOn] = useState(false);
  const [flash, setFlash] = useState<Pick | null>(null);
  const [locked, setLocked] = useState<Pick | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [queue, setQueue] = useState<string[]>([]);
  const [generatedIds, setGeneratedIds] = useState<Set<string>>(() => new Set());
  const [bufferSize, setBufferSize] = useState(DEFAULT_BUFFER_SIZE);
  const [pending, setPending] = useState<Pick[]>([]);
  const [activePick, setActivePick] = useState<Pick | null>(null);
  const [index, setIndex] = useState(0);
  const [primed, setPrimed] = useState(false);
  const [waitingForNext, setWaitingForNext] = useState(false);
  const jukebox = useRef<LiveJukebox | null>(null);
  if (!jukebox.current) {
    let saved: string | null = null;
    try { saved = localStorage.getItem(LIVE_STORAGE_KEY); } catch { /* private window */ }
    jukebox.current = new LiveJukebox(saved);
  }
  const radio = jukebox.current;
  const [generationPaused, setGenerationPaused] = useState(radio.state.paused);
  const [pauseReason, setPauseReason] = useState<LiveReason>(radio.state.reason);
  const [outstandingRequests, setOutstandingRequests] = useState(0);
  const [resumeChecking, setResumeChecking] = useState(false);
  const [resumeNote, setResumeNote] = useState("");
  const requestCount = useRef(0);
  const generationEpochRef = useRef(0);
  const [playSequence, setPlaySequence] = useState(0);
  const playingSongRef = useRef<Song | null>(null);
  const allSongsRef = useRef<Song[]>(songs);
  allSongsRef.current = songs;
  function saveRadio() {
    try { localStorage.setItem(LIVE_STORAGE_KEY, radio.snapshot()); } catch { /* stay latched in memory */ }
  }
  function event(kind: "paused" | "resumed" | "unplayable" | "empty", reason: LiveReason = radio.state.reason) {
    void recordLiveEvent(kind, reason).catch(() => undefined);
  }
  async function liveRequest<T>(operation: Promise<T>, timeout: number): Promise<T> {
    requestCount.current += 1; setOutstandingRequests(requestCount.current);
    // Keep the real request accounted for even after a UI deadline. Explicit
    // resume cannot duplicate an ambiguous submission still being handled.
    const tracked = operation.finally(() => {
      requestCount.current -= 1; setOutstandingRequests(requestCount.current);
    });
    return withLiveDeadline(tracked, timeout);
  }
  function pauseGeneration(reason: unknown, fallback: LiveReason) {
    const code = liveFailureReason(reason, fallback);
    if (!radio.pause(code)) return;
    generationEpochRef.current += 1;
    saveRadio(); event("paused", code);
    setGenerationPaused(true); setPauseReason(code);
    replacePending([]); preparedRef.current = null;
    if (drawTimerRef.current !== null) window.clearInterval(drawTimerRef.current);
    drawTimerRef.current = null; picking.current = false;
    setWritingPhase("");
    // Do not cancel a running GPU job or change the current player/queue.
    refillIfStarving();
  }
  async function resumeGeneration() {
    if (requestCount.current || generating || !ready || resumeChecking) return;
    setResumeChecking(true); setResumeNote("");
    const epoch = liveEpochRef.current;
    try {
      // Read-only reconciliation also protects reloads after an ambiguous POST.
      const status = await withLiveDeadline(getStatus(), 15000);
      if (epoch !== liveEpochRef.current) return;
      if (status.jobs.some(item => item.kind === "yue2" && ["queued", "running"].includes(item.status))) {
        setResumeNote("A song job is still finishing. Resume after it completes."); return;
      }
      generationEpochRef.current += 1;
      radio.resume(); saveRadio(); event("resumed");
      submitting.current = false; setActivePick(null); setJob(null);
      setGenerationPaused(false);
    } catch {
      setResumeNote("The local service could not be checked. Jukebox remains on.");
    } finally { setResumeChecking(false); }
  }
  const [writingPhase, setWritingPhase] = useState("");
  const picking = useRef(false);
  const recentTemplates = useRef<string[]>([]);
  const queueRef = useRef<string[]>([]);
  const indexRef = useRef(0);
  const pendingRef = useRef<Pick[]>([]);
  const submitting = useRef(false);
  const preparedRef = useRef<{ pick: Pick; title: string; lyrics: string } | null>(null);
  const prefetching = useRef(false);
  const catalogBufferRef = useRef<Song[]>([]);
  const liveEpochRef = useRef(0);
  const drawTimerRef = useRef<number | null>(null);

  useEffect(() => () => {
    liveEpochRef.current += 1;
    generationEpochRef.current += 1;
    if (drawTimerRef.current !== null) window.clearInterval(drawTimerRef.current);
    drawTimerRef.current = null;
    picking.current = false;
    if (submitting.current || prefetching.current) void abortWriting().catch(() => undefined);
  }, []);

  useEffect(() => { queueRef.current = queue; }, [queue]);
  useEffect(() => { indexRef.current = index; }, [index]);

  const catalog = useMemo(() => Object.fromEntries(songs.map((song) => [song.id, song])), [songs]);
  const catalogBuffer = useMemo(() => songs.filter((song) => playableSong(song) && (song.instrumental || Boolean(song.timed_lyrics?.lines?.length))), [songs]);
  const catalogBufferIds = useMemo(() => new Set(catalogBuffer.map((song) => song.id)), [catalogBuffer]);
  const queuedCurrent = catalog[queue[index]];
  if (queuedCurrent) playingSongRef.current = queuedCurrent;
  const current = queuedCurrent || (playingSongRef.current?.id === queue[index] ? playingSongRef.current : null);
  const { autoEq, setAutoEq, autoPreset, preset, displayGains, applyPreset, setBand } = useAutoEq(current);
  const upcoming = queue.slice(index + 1).map((id) => catalog[id]).filter(Boolean);
  const ahead = upcoming.length;
  const generating = Boolean(job && ["queued", "running"].includes(job.status));
  const readySongs = current ? 1 + ahead : 0;
  const catalogReady = queue.filter((id) => catalogBufferIds.has(id)).length;
  const startupTarget = generationPaused ? 1 : catalogReady >= MIN_BUFFER_SIZE ? catalogReady : bufferSize;
  const buffering = on && !primed && readySongs < startupTarget;

  useEffect(() => { catalogBufferRef.current = catalogBuffer; }, [catalogBuffer]);

  useEffect(() => { onCurrentChange(current?.id ?? null); }, [current?.id, onCurrentChange]);

  useEffect(() => {
    if (on && !primed && readySongs >= startupTarget) setPrimed(true);
  }, [on, primed, readySongs, startupTarget]);

  useEffect(() => {
    if (waitingForNext && index + 1 < queue.length) {
      setWaitingForNext(false);
      indexRef.current = index + 1;
      setIndex(indexRef.current);
      setPlaySequence(value => value + 1);
    }
  }, [index, queue.length, waitingForNext]);

  function replacePending(next: Pick[]) {
    pendingRef.current = next;
    setPending(next);
  }

  useEffect(() => { onLeaveLibraryPlay(); }, []);
  useEffect(() => { void getVoiceProfiles(false).then((result) => setVoices(result.items)).catch(() => setVoices([])); }, []);

  useEffect(() => {
    if (!on || !job || job.kind !== "yue2" || ["succeeded", "failed", "cancelled"].includes(job.status)) return;
    const epoch = liveEpochRef.current;
    let active = true;
    let polling = false;
    let nextPollAt = 0;
    const currentTurn = () => active && epoch === liveEpochRef.current;
    const timer = window.setInterval(async () => {
      if (polling || !currentTurn() || Date.now() < nextPollAt) return;
      polling = true;
      try {
        const next = (await withLiveDeadline(getJob(job.id), 15000)).job;
        nextPollAt = Date.now() + (radio.state.paused ? 30000 : 0);
        if (!currentTurn()) return;
        if (next.status === "succeeded") {
          const folder = String(next.result?.folder_name || "");
          await refreshRef.current();
          if (!currentTurn()) return;
          let library = await getLibrary();
          if (!currentTurn()) return;
          let song = library.items.find((item) => item.folder_name === folder);
          if (song) {
            setGeneratedIds((ids) => new Set(ids).add(song!.id));
            setQueue((ids) => {
              if (ids.includes(song!.id)) return ids;
              const taken = new Set(
                ids.map((id) => library.items.find((item) => item.id === id)?.title.trim().toLowerCase()).filter(Boolean),
              );
              if (taken.has(song.title.trim().toLowerCase())) return ids;
              queueRef.current = [...ids, song!.id];
              radio.reserve([song!.id]); saveRadio();
              return queueRef.current;
            });
          }
        }
        if (["failed", "cancelled"].includes(next.status)) pauseGeneration(next.error, "generation");
        setJob(next);
        if (["succeeded", "failed", "cancelled"].includes(next.status)) {
          setActivePick(null);
          submitting.current = false;
        }
      } catch (reason: any) {
        if (!currentTurn()) return;
        nextPollAt = Date.now() + 30000;
        pauseGeneration(reason, "connection");
      } finally { polling = false; }
    }, 1500);
    return () => { active = false; window.clearInterval(timer); };
  }, [on, job?.id, job?.status]);

  async function writeSong(preset: StylePreset, pick: Pick, announce = true) {
    const note = (phase: string) => { if (announce) setWritingPhase(phase); };
    const description = liveDescription(preset, pick.instrumental, pick);
    try {
      if (pick.instrumental) {
        note("Requesting title");
        const result = await liveRequest(assistWriting({
          action: "title", idea: `${pick.template}. ${preset.mood}. Instrumental, no vocals.`,
          description, language: preset.language || "en", instrumental: true,
        }), 180000);
        const title = (result.title || "").trim() || pick.template;
        note(`Title ready: ${title}`);
        return { title, lyrics: "" };
      }
      note("Writing title and lyrics");
      const idea = `${pick.template}. ${preset.mood}. ${castHint(pick.cast)} Write a distinctive song title and full tagged lyrics.`;
      const result = await liveRequest(assistWriting({
        action: "generate", idea, description, language: preset.language || "en", instrumental: false,
      }), 180000);
      const title = (result.title || "").trim();
      const lyrics = (result.lyrics || "").trim();
      if (!title || !lyrics) throw new Error("Writing returned an empty title or lyrics");
      note(`Title ready: ${title}`);
      return { title, lyrics };
    } catch (reason) {
      if (announce) setWritingPhase("");
      throw reason;
    }
  }

  async function submit(pick: Pick) {
    const preset = presets[pick.template];
    if (!preset || radio.state.paused) return;
    const epoch = liveEpochRef.current;
    const generationEpoch = generationEpochRef.current;
    setLocked(pick);
    let failureKind: LiveReason = "writing";
    try {
      const ready = preparedRef.current?.pick.id === pick.id ? preparedRef.current : null;
      preparedRef.current = null;
      setWritingPhase(ready ? `Title ready: ${ready.title}` : "Writing title and lyrics");
      const written = ready || await writeSong(preset, pick, true);
      if (epoch !== liveEpochRef.current || generationEpoch !== generationEpochRef.current || radio.state.paused) return;
      const named = { ...pick, title: written.title };
      setLocked(named);
      setFlash(named);
      setWritingPhase("Ready — starting YuE2");
      failureKind = "generation";
      const submission = generate({
        title: written.title,
        genre: pick.template,
        description: liveDescription(preset, pick.instrumental, pick),
        lyrics: written.lyrics,
        lyrics_language: preset.language || "en",
        instrumental: pick.instrumental,
        seed: null,
        cot_mode: "melody",
        cfg: 1.0,
        steps: 32,
        top_k: 100,
        temperature: 1.0,
        exclude_styles: "",
        vocal_gender: vocalGenderFor(pick.cast),
        voice_slots: pick.instrumental ? EMPTY_VOICE_SLOTS : { female: pick.female, male: pick.male, backing: "" },
      });
      // A late accepted job is observed, never resubmitted after a deadline.
      void submission.then(result => {
        if (epoch === liveEpochRef.current) setJob(result.job);
      }).catch(() => undefined);
      const result = await liveRequest(submission, 120000);
      if (epoch !== liveEpochRef.current) return;
      setJob(result.job);
      setWritingPhase("");
    } catch (reason: any) {
      if (epoch !== liveEpochRef.current) return;
      pauseGeneration(reason, failureKind);
      setWritingPhase("");
      setActivePick(null);
      submitting.current = false;
    }
  }

  function catalogFiller(count: number, ended = false) {
    const reserved = queueRef.current.slice(indexRef.current + (ended ? 1 : 0));
    const pool = radio.state.paused ? allSongsRef.current : catalogBufferRef.current;
    const boundary = reserved[reserved.length - 1] || queueRef.current[indexRef.current];
    const extra = radio.draw(pool, count, reserved, boundary);
    saveRadio(); return extra;
  }

  function refillIfStarving(ended = false) {
    const remaining = queueRef.current.length - indexRef.current - (ended ? 1 : 0);
    const target = radio.state.paused ? bufferSize : MIN_BUFFER_SIZE;
    if (remaining >= target) return [];
    const extra = catalogFiller(target - remaining, ended);
    if (extra.length) {
      queueRef.current = [...queueRef.current, ...extra]; setQueue(queueRef.current);
    }
    return extra;
  }

  function advancePlayback(unplayable = false) {
    const id = queueRef.current[indexRef.current];
    if (unplayable && id) { radio.block(id); event("unplayable"); }
    else if (id) radio.played(id);
    const playable = new Set(radio.eligible(allSongsRef.current));
    // Preserve current audio until it ends, but remove invalid/deleted future tracks.
    queueRef.current = [...queueRef.current.slice(0, indexRef.current + 1),
      ...queueRef.current.slice(indexRef.current + 1).filter(id => playable.has(id))];
    refillIfStarving(true); saveRadio();
    if (indexRef.current + 1 < queueRef.current.length) {
      indexRef.current += 1;
      // Bound playback history without touching the player on a mode change.
      if (indexRef.current > 64) {
        queueRef.current = queueRef.current.slice(indexRef.current - 32); indexRef.current = 32;
      }
      setQueue(queueRef.current); setIndex(indexRef.current);
      setPlaySequence(value => value + 1); setWaitingForNext(false);
    } else {
      setQueue(queueRef.current); setWaitingForNext(true); event("empty");
    }
  }

  function drawAndSubmit(lockedPick: Pick) {
    if (radio.state.paused || picking.current || !names.length) return;
    const epoch = liveEpochRef.current;
    picking.current = true;
    let ticks = 0;
    const timer = window.setInterval(() => {
      if (epoch !== liveEpochRef.current || radio.state.paused) {
        window.clearInterval(timer);
        drawTimerRef.current = null;
        picking.current = false;
        return;
      }
      setFlash(randomPick(names, voices));
      ticks += 1;
      if (ticks < 16) return;
      window.clearInterval(timer);
      drawTimerRef.current = null;
      setFlash(lockedPick);
      picking.current = false;
      void submit(lockedPick);
    }, 70);
    drawTimerRef.current = timer;
  }

  useEffect(() => {
    if (!on || radio.state.paused) return;
    const desiredAhead = queue.length ? bufferSize - 1 : bufferSize;
    const reserved = ahead + (activePick ? 1 : 0) + pending.length;
    const missing = desiredAhead - reserved;
    const avoid = [
      ...recentTemplates.current,
      ...pendingRef.current.map((item) => item.template),
      ...queue.slice(index).map((id) => catalog[id]?.genre || "").filter(Boolean),
    ];
    if (missing > 0) {
      const extra: Pick[] = [];
      const blocked = [...avoid];
      for (let i = 0; i < missing; i += 1) {
        const pick = randomPick(names, voices, blocked);
        extra.push(pick);
        blocked.push(pick.template);
      }
      replacePending([...pendingRef.current, ...extra]);
    } else if (!activePick && pending.length === 0) replacePending([randomPick(names, voices, avoid)]);
  }, [on, names, voices, queue.length, ahead, activePick, pending.length, bufferSize, catalog, index, generationPaused]);

  useEffect(() => {
    if (!on) return;
    refillIfStarving(waitingForNext);
  }, [on, index, queue.length, generationPaused, songs, bufferSize]);

  useEffect(() => {
    if (!on || !generationPaused) return;
    let refreshing = false;
    const timer = window.setInterval(() => {
      if (refreshing) return;
      refreshing = true;
      void refreshRef.current().catch(() => undefined).finally(() => { refreshing = false; });
    }, 30000);
    return () => window.clearInterval(timer);
  }, [on, generationPaused]);

  useEffect(() => {
    if (!on || radio.state.paused) return;
    const next = pending[0];
    if (!next || prefetching.current || preparedRef.current?.pick.id === next.id) return;
    if (activePick && next.id === activePick.id) return;
    if (!job || !["queued", "running"].includes(job.status)) return;
    const preset = presets[next.template];
    if (!preset) return;
    const epoch = liveEpochRef.current;
    const generationEpoch = generationEpochRef.current;
    prefetching.current = true;
    void writeSong(preset, next, false)
      .then((written) => {
        if (epoch !== liveEpochRef.current || generationEpoch !== generationEpochRef.current || radio.state.paused) return;
        preparedRef.current = { pick: next, title: written.title, lyrics: written.lyrics };
      })
      .catch((reason: any) => {
        if (epoch !== liveEpochRef.current || generationEpoch !== generationEpochRef.current) return;
        preparedRef.current = null;
        pauseGeneration(reason, "writing");
      })
      .finally(() => {
        prefetching.current = false;
      });
  }, [on, pending, job?.id, job?.status, activePick, presets, voices, generationPaused]);

  useEffect(() => {
    if (!on || radio.state.paused || activePick || picking.current || submitting.current) return;
    const next = pendingRef.current[0];
    if (!next) return;
    replacePending(pendingRef.current.slice(1));
    setActivePick(next);
    setJob(null);
    submitting.current = true;
    recentTemplates.current = [...recentTemplates.current.filter((name) => name !== next.template), next.template].slice(-8);
    drawAndSubmit(next);
  }, [on, activePick, pending.length, generationPaused]);

  function startLive() {
    if (!voices.length) void getVoiceProfiles(false).then((result) => setVoices(result.items)).catch(() => undefined);
    setGeneratedIds(new Set());
    recentTemplates.current = [];
    preparedRef.current = null;
    const pool = radio.state.paused ? allSongsRef.current : catalogBufferRef.current;
    queueRef.current = radio.draw(pool, bufferSize);
    saveRadio(); setQueue(queueRef.current);
    indexRef.current = 0; setIndex(0); setWaitingForNext(false);
    setPlaySequence(value => value + 1);
    setOn(true);
  }

  function stopLive() {
    liveEpochRef.current += 1;
    generationEpochRef.current += 1;
    if (drawTimerRef.current !== null) window.clearInterval(drawTimerRef.current);
    drawTimerRef.current = null;
    picking.current = false;
    setOn(false);
    setPrimed(false);
    setWaitingForNext(false);
    setGeneratedIds(new Set());
    replacePending([]);
    submitting.current = false;
    setActivePick(null);
    preparedRef.current = null;
    setWritingPhase("");
    void abortWriting().catch(() => undefined);
  }

  function skip() {
    advancePlayback();
  }

  const shown = flash || locked;
  const shownVoices = shown ? reelVoices(shown) : { a: "", b: "" };
  const pendingCount = pending.length;
  const activeLabel = generationPaused ? (generating ? "finishing a song" : "") : activePick ? (job?.kind === "lyrics_sync" ? "syncing lyrics" : generating ? (job?.status === "queued" ? "queued to be made" : "generating") : writingPhase || "preparing") : "";
  const stageEyebrow = generationPaused ? "JUKEBOX" : picking.current ? "DRAWING" : writingPhase.startsWith("Ready") ? "READY" : writingPhase.startsWith("Title ready") ? "TITLE READY" : writingPhase ? "WRITING" : activeLabel === "syncing lyrics" ? "SYNCING LYRICS" : activeLabel === "queued to be made" ? "QUEUED TO MAKE" : generating ? "GENERATING" : activePick ? "PREPARING" : locked ? "SELECTED" : "LIVE";
  const femalePool = voices.filter((profile) => !profile.archived && (profile.role === "female" || profile.role === "any"));
  const malePool = voices.filter((profile) => !profile.archived && (profile.role === "male" || profile.role === "any"));

  return <section className="live-page">
    <aside className="live-wing live-wing-cast" aria-label="Cast reel">
      {CAST_ROLL.map((item) => <div className={`live-wing-chip ${shown?.cast === item.id ? "on" : ""}`} key={item.id} title={item.label}><img src={CAST_ART[item.id]} alt={item.label} /></div>)}
    </aside>
    <div className="live-main">
    {!on && <div className="live-settings card"><label className="live-buffer-size">Keep ready<select value={bufferSize} onChange={(event) => setBufferSize(Math.max(MIN_BUFFER_SIZE, Number(event.target.value)))}><option value="3">3 songs · short</option><option value="5">5 songs · balanced</option><option value="8">8 songs · long</option><option value="12">12 songs · overnight</option></select></label><small>{catalogBuffer.length ? "Starts from the catalog, keeps generating ahead, and pulls a random catalog song if the queue would go empty. OBS can end the stream on its own clock." : "No playback-ready catalog songs found; Live will generate the starting buffer."}</small></div>}
    <div className="live-layout">
      <div className="live-stage card">
        <div className="live-stage-head">
          <div className="eyebrow">{stageEyebrow}</div>
          <strong>{generationPaused ? "Jukebox" : shown?.title || "Song generator"}</strong>
          <span>{ahead} ready ahead{pendingCount ? ` · ${pendingCount} queued` : ""}{activeLabel ? ` · ${activeLabel}` : ""}</span>
        </div>
        {shown ? <div className="live-reels">
          <div className={`live-reel ${picking.current ? "spinning" : "on"}`}>
            <small>Template</small>
            <img src={art[shown.template] || ""} alt="" />
            <b>{shown.template}</b>
          </div>
          <div className={`live-reel ${picking.current ? "spinning" : "on"}`}>
            <small>Cast</small>
            <img className="live-cast-art" src={CAST_ART[shown.cast]} alt={CAST_ROLL.find((item) => item.id === shown.cast)?.label || "Cast"} />
          </div>
          <div className={`live-reel ${picking.current ? "spinning" : shownVoices.a ? "on" : ""}`}>
            <small>Voice A</small>
            {shownVoices.a && voiceArt(shownVoices.a, voices) ? <img src={voiceArt(shownVoices.a, voices)} alt="" /> : <div className="live-reel-empty">—</div>}
            <b>{shownVoices.a ? voiceName(shownVoices.a, voices) : "None"}</b>
          </div>
          <div className={`live-reel ${picking.current ? "spinning" : shownVoices.b ? "on" : ""}`}>
            <small>Voice B</small>
            {shownVoices.b && voiceArt(shownVoices.b, voices) ? <img src={voiceArt(shownVoices.b, voices)} alt="" /> : <div className="live-reel-empty">—</div>}
            <b>{shownVoices.b ? voiceName(shownVoices.b, voices) : "None"}</b>
          </div>
        </div> : <div className="empty"><strong>Not live yet</strong><p>Start to draw template, cast, and voices, then generate.</p></div>}
        {!generationPaused && locked && presets[locked.template] && <small className="live-mood">{writingPhase || presets[locked.template].mood}</small>}
        {generating && <div className="job-banner running"><div><strong>{job?.status === "queued" ? "Song queued" : "Making the next song"}</strong><span>{Math.round((job?.progress || 0) * 100)}%</span></div></div>}
        <div className="live-actions">
          {!on && <button type="button" className="primary" disabled={!ready && !radio.eligible(songs).length} onClick={startLive}>Start live</button>}
          {on && <button type="button" className="danger" onClick={stopLive}>Stop</button>}
          <button type="button" disabled={!current} onClick={skip}>Skip</button>
        </div>
        {generationPaused && <details className="live-operator"><summary>Station controls · Jukebox</summary>
          <p>{LIVE_REASON_LABELS[pauseReason]} Generation is paused until you resume it. The selected provider is unchanged.</p>
          <p>{radio.eligible(songs).length === 0 ? "No playable library songs are available." : radio.eligible(songs).length === 1 ? "One playable song is available; it will repeat." : "Library songs shuffle once per cycle."}</p>
          <button type="button" disabled={outstandingRequests > 0 || generating || !ready || resumeChecking} onClick={() => void resumeGeneration()}>Resume generation</button>
          {resumeNote && <small>{resumeNote}</small>}
          {(outstandingRequests > 0 || generating) && <small>Waiting for the outstanding request or job to finish.</small>}
        </details>}
      </div>
      <div className="live-now card">
        {current ? <>
          <div className="radio-now">
            {coverSources[current.id] ? <img src={coverSources[current.id]} alt="" /> : <div className="radio-now-empty">♫</div>}
            <div><div className="eyebrow">{buffering ? "BUFFERING" : "NOW PLAYING"}</div><h3>{current.title}</h3><p>{current.instrumental ? "Instrumental" : "Vocal"}{current.genre ? ` · ${current.genre}` : ""}</p></div>
          </div>
          <aside className="live-eq">
            <div className="eyebrow">10-BAND EQ</div>
            <EqPanel autoEq={autoEq} setAutoEq={setAutoEq} autoPreset={autoPreset} preset={preset} displayGains={displayGains} applyPreset={applyPreset} setBand={setBand} note={autoEq ? `Auto EQ follows ${autoPreset}; sliders glide before each song. Custom sliders save on this machine.` : "Manual EQ is live on this station. Custom sliders save on this machine."} />
          </aside>
          {!on ? <div className="live-buffering">Station stopped</div> : buffering ? <div className="live-buffering">Buffering playback: {readySongs}/{startupTarget} songs ready</div> : waitingForNext ? <div className="live-buffering">Current song finished — waiting for the next buffered song</div> : <SongVisualizer key={`${current.id}:${playSequence}`} src={liveSrc(current)} timedLyrics={current.timed_lyrics} eqGains={displayGains} compact onAnalyser={onAnalyserChange} onPlayingChange={onPlaybackChange} onPlaybackError={() => advancePlayback(true)} onEnded={() => advancePlayback()} />}
        </> : <div className="empty"><strong>{generationPaused ? "Jukebox" : "Waiting on the first song"}</strong><p>{generationPaused ? "No playable library audio is currently available." : "The station plays as soon as a draw finishes generating."}</p></div>}
        {on && queue.length > 0 && <div className="live-queue">
          <div className="live-queue-head"><div className="eyebrow">PLAYBACK QUEUE</div><small>{index + 1}/{queue.length} · position</small></div>
          <div className="live-queue-list">
            {queue.slice(index).map((id, offset) => {
              const song = catalog[id];
              if (!song) return null;
              const position = index + offset + 1;
              const state = offset === 0 ? "ON AIR" : offset === 1 ? "UP NEXT" : "QUEUED";
              return <div className={`live-queue-row ${offset === 0 ? "current on-air" : ""}`} aria-current={offset === 0 ? "true" : undefined} key={`${id}:${position}`}>
                <b>{String(position).padStart(2, "0")}</b>
                <img src={coverSources[id] || art[song.genre || ""] || ""} alt="" />
                <span><strong>{song.title}</strong><small>{generatedIds.has(id) ? "GENERATED · " : ""}{state}</small></span>
              </div>;
            })}
          </div>
        </div>}
      </div>
    </div>
    <div className="live-grid">
      {names.map((name) => <button type="button" key={name} className={`live-card ${shown?.template === name ? "picked" : ""}`} disabled>
        <img src={art[name] || ""} alt="" />
        <span>{name}</span>
      </button>)}
    </div>
    </div>
    <aside className="live-wing live-wing-voices" aria-label="Voice reel">
      {[...femalePool, ...malePool.filter((profile) => !femalePool.some((item) => item.id === profile.id))].map((profile) => {
        const selected = shown?.female === profile.id || shown?.male === profile.id;
        return <div className={`live-wing-voice ${selected ? "on" : ""}`} key={profile.id}>
          {voiceArt(profile.id, voices) ? <img src={voiceArt(profile.id, voices)} alt="" /> : <span>{profile.name.slice(0, 1)}</span>}
          <b>{profile.name}</b>
        </div>;
      })}
    </aside>
  </section>;
}
