import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { UploaderClient } from "./uploader-client";
export const dynamic = "force-dynamic";
export default async function OperatorUploaderPage() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims?.sub) redirect("/login");
  const [tracks, racers, karts] = await Promise.all([
    supabase.from("tracks").select("id,name,start_finish,turns").order("name"),
    supabase.from("racers").select("id,name,primary_class").order("name"),
    supabase.from("karts").select("id,name,racer_id,chassis_make,chassis_model").order("name")
  ]);
  return <UploaderClient tracks={tracks.data ?? []} racers={racers.data ?? []} karts={karts.data ?? []} />;
}
