"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, FileVideo, UploadCloud, XCircle } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { KnowledgeUploadJob } from "@/types/domain";

const MAX_FILE_BYTES = 500 * 1024 * 1024;
const ACCEPTED = "video/mp4,video/quicktime,video/webm,video/x-matroska,video/x-msvideo,audio/mpeg,audio/mp4,audio/wav,audio/webm";

type UploadRow = KnowledgeUploadJob & { local?: boolean; progress?: number };

function platformFor(filename: string) {
  const name = filename.toLowerCase();
  if (name.includes("youtube") || name.includes("youtu.be")) return "youtube";
  if (name.includes("tiktok")) return "tiktok";
  if (name.includes("facebook") || name.includes("fb_")) return "facebook";
  return null;
}

function statusLabel(row: UploadRow) {
  if (row.status === "uploading") return `Uploading${row.progress != null ? ` · ${row.progress}%` : ""}`;
  if (row.status === "queued") return "Waiting for transcription";
  if (row.status === "transcribing") return "Transcribing audio";
  if (row.status === "extracting") return "Extracting knowledge";
  if (row.status === "completed") return `${row.knowledge_points_added} knowledge points added`;
  return row.error || "Processing failed";
}

export function KnowledgeVideoUpload({ initialJobs }: { initialJobs: KnowledgeUploadJob[] }) {
  const [rows, setRows] = useState<UploadRow[]>(initialJobs);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const [supabase] = useState(() => createClient());

  useEffect(() => {
    const hasActive = rows.some((row) => ["queued", "transcribing", "extracting"].includes(row.status));
    if (!hasActive) return;
    const timer = window.setInterval(async () => {
      const { data } = await supabase
        .from("knowledge_upload_jobs")
        .select("id,original_filename,status,knowledge_points_added,error,source_platform,created_at")
        .order("created_at", { ascending: false })
        .limit(100);
      if (data) setRows((current) => {
        const localUploads = current.filter((row) => row.local && row.status === "uploading");
        return [...localUploads, ...(data as KnowledgeUploadJob[])];
      });
    }, 2000);
    return () => window.clearInterval(timer);
  }, [rows, supabase]);

  const uploadFiles = useCallback(async (files: File[]) => {
    const { data: claimsData } = await supabase.auth.getClaims();
    const userId = claimsData?.claims?.sub;
    const role = (claimsData?.claims?.app_metadata as { role?: string } | undefined)?.role;
    if (!userId || role !== "rivali_admin") return;

    await Promise.all(files.map(async (file) => {
      const localId = crypto.randomUUID();
      const base: UploadRow = {
        id: localId, original_filename: file.name, status: "uploading", progress: 0,
        knowledge_points_added: 0, error: null, source_platform: platformFor(file.name),
        created_at: new Date().toISOString(), local: true,
      };
      setRows((current) => [base, ...current]);
      try {
        if (file.size > MAX_FILE_BYTES) throw new Error("File exceeds the 500 MB upload limit.");
        if (!file.type.startsWith("video/") && !file.type.startsWith("audio/")) throw new Error("Choose a saved video or audio file.");
        const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
        const storagePath = `${userId}/${localId}/${safeName}`;
        const { error: uploadError } = await supabase.storage
          .from("knowledge-video-intake")
          .upload(storagePath, file, { contentType: file.type, upsert: false });
        if (uploadError) throw uploadError;
        setRows((current) => current.map((row) => row.id === localId ? { ...row, progress: 100, status: "queued" } : row));
        const { data: job, error: jobError } = await supabase
          .from("knowledge_upload_jobs")
          .insert({
            id: localId, uploader_id: userId, original_filename: file.name,
            storage_path: storagePath, mime_type: file.type, size_bytes: file.size,
            source_platform: platformFor(file.name), status: "queued",
          })
          .select("id,original_filename,status,knowledge_points_added,error,source_platform,created_at")
          .single();
        if (jobError) {
          await supabase.storage.from("knowledge-video-intake").remove([storagePath]);
          throw jobError;
        }
        setRows((current) => current.map((row) => row.id === localId ? job as KnowledgeUploadJob : row));
      } catch (error) {
        setRows((current) => current.map((row) => row.id === localId ? {
          ...row, status: "failed", error: error instanceof Error ? error.message : "Upload failed.", local: false,
        } : row));
      }
    }));
  }, [supabase]);

  return (
    <section className="card knowledge-video-card">
      <div className="knowledge-video-heading">
        <div>
          <div className="eyebrow">AUTOMATIC VIDEO INTAKE</div>
          <h2>Drop training videos. Rivali handles the rest.</h2>
          <p className="muted">Files are transcribed, distilled into paraphrased claims, and deleted after successful processing.</p>
        </div>
        <span className="admin-only-badge">ADMIN ONLY</span>
      </div>
      <div
        className={`knowledge-dropzone ${dragging ? "dragging" : ""}`}
        onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault(); setDragging(false);
          void uploadFiles(Array.from(event.dataTransfer.files));
        }}
      >
        <UploadCloud aria-hidden="true" />
        <strong>Drag saved videos here</strong>
        <span>MP4, MOV, WebM, MKV, AVI, or audio · up to 500 MB each</span>
        <button type="button" className="button" onClick={() => inputRef.current?.click()}>Browse files</button>
        <input
          ref={inputRef} hidden type="file" multiple accept={ACCEPTED}
          onChange={(event) => { void uploadFiles(Array.from(event.target.files ?? [])); event.target.value = ""; }}
        />
      </div>
      <div className="knowledge-upload-list" aria-live="polite">
        {rows.length === 0 ? <p className="muted">No videos uploaded yet.</p> : rows.map((row) => (
          <article className={`knowledge-upload-row ${row.status}`} key={row.id}>
            <FileVideo aria-hidden="true" />
            <div className="knowledge-upload-copy">
              <strong>{row.original_filename}</strong>
              <span>{statusLabel(row)}</span>
              {row.status === "uploading" && <i style={{ width: `${row.progress ?? 8}%` }} />}
            </div>
            {row.status === "completed" && <CheckCircle2 className="upload-success" aria-label="Done" />}
            {row.status === "failed" && <XCircle className="upload-failed" aria-label="Failed" />}
            {["queued", "transcribing", "extracting"].includes(row.status) && <span className="upload-spinner" aria-label="Processing" />}
          </article>
        ))}
      </div>
    </section>
  );
}
