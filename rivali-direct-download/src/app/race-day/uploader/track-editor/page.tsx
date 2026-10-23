import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { TrackEditorClient } from "./track-editor-client";
export const dynamic = "force-dynamic";
export default async function TrackEditorPage() {
 const db=await createClient();
 const {data:auth}=await db.auth.getClaims();
 if(!auth?.claims?.sub)redirect("/login");
 const {data:tracks}=await db.from("tracks").select("id,name,location,surface_type,latitude,longitude,start_finish,turns").order("name");
 return <main style={{minHeight:"100vh",background:"#090b0c",color:"#fff",padding:"24px 3%"}}>
  <header style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:15,marginBottom:22}}>
   <strong style={{color:"#eaff00",fontSize:22}}>RIVALI · TRACK EDITOR</strong>
   <Link href="/race-day/uploader" style={{color:"#edff00"}}>← Back to five-kart uploader</Link>
  </header>
  <TrackEditorClient tracks={tracks??[]}/>
 </main>;
}