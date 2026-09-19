"use client";

import Image from "next/image";
import { ChevronDown, MessageCircle } from "lucide-react";
import { useState } from "react";
import { DougCall, type DougAction } from "./doug-call";

type AppTab = "home" | "upload" | "debrief" | "drivers" | "karts" | "tracks" | "sessions" | "compare" | "profile";

export function FloatingDoug({ racedayContext, onNavigate, onRequestAction, attentionKey, guidance }: {
  racedayContext: string;
  onNavigate: (tab: AppTab) => void;
  onRequestAction: (action: DougAction) => void;
  attentionKey: string;
  guidance: string;
}) {
  const [manuallyOpen, setManuallyOpen] = useState(true);
  const [dismissedAttention, setDismissedAttention] = useState("");
  const open = manuallyOpen || (!!attentionKey && dismissedAttention !== attentionKey);

  return (
    <aside className={`floating-doug ${open ? "open" : "closed"}`} aria-label="Doug, Rivali crew chief">
      {open ? (
        <div className="floating-doug-panel">
          <button className="floating-doug-collapse" type="button" onClick={() => { setManuallyOpen(false); setDismissedAttention(attentionKey); }} aria-label="Minimize Doug"><ChevronDown /></button>
          <div className="floating-doug-figure"><Image src="/doug-crew-chief.png" alt="Doug" width={620} height={744} priority /></div>
          <div className="floating-doug-chat">
            <div className="conversation-status"><span /> DOUG IS READY</div>
            <strong>{guidance}</strong>
            <DougCall racedayContext={racedayContext} onNavigate={onNavigate} onRequestAction={onRequestAction} />
          </div>
        </div>
      ) : (
        <button className="floating-doug-trigger" type="button" onClick={() => setManuallyOpen(true)}>
          <Image src="/doug-crew-chief.png" alt="Open Doug" width={620} height={744} />
          <span><MessageCircle /> Talk to Doug</span>
        </button>
      )}
    </aside>
  );
}
