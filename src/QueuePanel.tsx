import { useState } from "react";
import { clientId, clientName, isStudioPc, setClientName, type Job } from "./api";

const KIND_LABEL: Record<string, string> = {
  yue2: "Song", music3: "Song", cover_art: "Cover art", stems: "Stems", audio_export: "Export",
  lyrics_sync: "Lyric sync", sheetsage: "Transcription", stable_sfx: "Sound effect",
};

/** The one shared line of work for this PC's GPU: every person's songs, in order. */
export function QueuePanel({ queue, onCancel, alwaysShow = false }: { queue: Job[]; onCancel: (job: Job) => void; alwaysShow?: boolean }) {
  const me = clientId();
  const studioPc = isStudioPc();
  const [name, setName] = useState(clientName());
  const [editing, setEditing] = useState(false);
  if (!queue.length && !alwaysShow) return null;

  const saveName = () => { setClientName(name); setName(clientName()); setEditing(false); };
  const mine = queue.filter((job) => job.owner === me).length;

  return <section className="queue-panel" aria-label="Song queue">
    <header>
      <div>
        <div className="eyebrow">SONG QUEUE</div>
        <strong>{queue.length ? `${queue.length} in line${mine ? ` · ${mine} yours` : ""}` : "Nobody's waiting — your song starts right away"}</strong>
      </div>
      <div className="queue-me">
        {editing
          ? <><input value={name} maxLength={40} autoFocus aria-label="Your name in the queue" onChange={(event) => setName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") saveName(); if (event.key === "Escape") { setName(clientName()); setEditing(false); } }} /><button onClick={saveName}>Save</button></>
          : <button className="queue-name" title="Change the name other people see next to your songs" onClick={() => setEditing(true)}>You: <b>{clientName()}</b> ✎</button>}
      </div>
    </header>
    {queue.length > 0 && <ol>
      {queue.map((job) => {
        const yours = job.owner === me;
        const canCancel = yours || studioPc;
        return <li key={job.id} className={`${job.status}${yours ? " yours" : ""}`}>
          <span className="queue-pos">{job.status === "running" ? "▶" : job.queue_position ?? "·"}</span>
          <div className="queue-info">
            <strong>{job.title || KIND_LABEL[job.kind] || "Job"}</strong>
            <small>{KIND_LABEL[job.kind] || job.kind} · {yours ? "you" : job.owner_name || "Studio"} · {job.phase}</small>
            {job.status === "running" && <div className="progress"><i style={{ width: `${Math.round(job.progress * 100)}%` }} /></div>}
          </div>
          {canCancel && <button className="danger" title={yours ? "Remove your song from the line" : "Studio PC: cancel this person's song"} onClick={() => onCancel(job)}>Cancel</button>}
        </li>;
      })}
    </ol>}
  </section>;
}
