"use client";
import { useState } from "react";
import { TrackMapEditor } from "@/components/track-map-editor";
import type { Track } from "@/types/domain";
export function TrackEditorClient({tracks:initial}:{tracks:Track[]}) {
 const [tracks,setTracks]=useState(initial);
 return <TrackMapEditor tracks={tracks} sessions={[]} onTrackUpdated={updated=>setTracks(current=>current.map(t=>t.id===updated.id?updated:t))}/>;
}