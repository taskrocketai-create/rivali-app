import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { UploaderClient } from "./uploader-client";
export const dynamic = "force-dynamic";
export default async function OperatorUploaderPage() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims?.sub) redirect("/login");
  const [tracks, racers, karts, sessions] = await Promise.all([
    supabase.from("tracks").select("id,name,location,surface_type,latitude,longitude,start_finish,turns").order("name"),
    supabase.from("racers").select("id,name,primary_class").order("name"),
    supabase.from("karts").select("id,name,racer_id,chassis_make,chassis_model").order("name"),
    supabase.from("sessions").select("id,session_date,session_type,status,report_status,best_lap_sec,average_lap_sec,consistency_stdev_sec,lap_count,setup,conditions,raw_file_name,tracks(id,name),racers(id,name),karts(id,name)").order("session_date",{ascending:false}).limit(100)
  ]);
  return <UploaderClient tracks={tracks.data ?? []} racers={racers.data ?? []} karts={karts.data ?? []} sessions={(sessions.data ?? []) as never} />;
}
