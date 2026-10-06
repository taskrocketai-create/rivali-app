"use client";

import dynamic from "next/dynamic";
import { ChevronDown, Mic } from "lucide-react";
import { useState } from "react";
import type { DougAction } from "./doug-call";

const DougCall = dynamic(
  () => import("./doug-call").then((mod) => mod.DougCall),
  { ssr: false, loading: () => <div className="doug-caption"><small>DOUG</small><span>Loading crew chief…</span></div> },
);

type AppTab = "home" | "upload" | "debrief" | "drivers" | "karts" | "tracks" | "sessions" | "compare" | "profile";

export function FloatingDoug({ racedayContext, onNavigate, onRequestAction, attentionKey, guidance }: {
  racedayContext: string;
  onNavigate: (tab: AppTab) => void;
  onRequestAction: (action: DougAction) => void;
  attentionKey: string;
  guidance: string;
}) {
  const [manuallyOpen, setManuallyOpen] = useState(false);
  const open = manuallyOpen;

  return (
    <aside className={`floating-doug ${open ? "open" : "closed"}`} aria-label="Doug, Rivali crew chief" data-attention-key={attentionKey}>
      {open ? (
        <div className="floating-doug-panel" id="doug-conversation">
          <button className="floating-doug-collapse" type="button" onClick={() => setManuallyOpen(false)} aria-label="Minimize Doug"><ChevronDown /></button>
          <div className="floating-doug-chat">
            <div className="conversation-status"><Mic size={16} /> ASK DOUG</div>
            <strong>{guidance}</strong>
            <DougCall racedayContext={racedayContext} onNavigate={onNavigate} onRequestAction={onRequestAction} />
          </div>
        </div>
      ) : (
        <button className="floating-doug-trigger" type="button" onClick={() => setManuallyOpen(true)} aria-expanded={open} aria-controls="doug-conversation">
          <Mic size={20} aria-hidden="true" />
          <span>Ask Doug</span>
        </button>
      )}
    </aside>
  );
}
