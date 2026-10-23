import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { UploaderClient } from "./uploader-client";
export const dynamic = "force-dynamic";
export default async function OperatorUploaderPage() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims?.sub) redirect("/login");
  const { data: tracks } = await supabase.from("tracks").select("id,name").order("name");
  return <UploaderClient tracks={tracks ?? []} />;
}
