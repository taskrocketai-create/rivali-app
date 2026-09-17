import Link from "next/link";
import { redirect } from "next/navigation";
import { logout } from "@/app/login/actions";
import { DashboardClient } from "@/components/dashboard-client";
import { createClient } from "@/lib/supabase/server";
import { RivaliLogo } from "@/components/rivali-logo";
export const dynamic = "force-dynamic";
export default async function DashboardPage() {
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  if (!claimsData?.claims?.sub) redirect("/login");
  const isAdmin =
    (claimsData.claims.app_metadata as { role?: string } | undefined)?.role ===
    "rivali_admin";
  const [racers, karts, tracks, sessions] = await Promise.all([
    supabase
      .from("racers")
      .select("id,name,experience_level,driver_weight_lb")
      .order("name"),
    supabase
      .from("karts")
      .select("id,racer_id,name,chassis_make,chassis_model,tire_compound")
      .order("name"),
    supabase
      .from("tracks")
      .select(
        "id,name,location,surface_type,latitude,longitude,start_finish,turns",
      )
      .order("name"),
    supabase
      .from("sessions")
      .select(
        "id,session_date,session_type,status,best_lap_sec,average_lap_sec,consistency_stdev_sec,lap_count,setup,conditions,raw_file_name,tracks(name),racers(name),karts(name),recommendations(recommendation,confidence)",
      )
      .order("session_date", { ascending: false })
      .limit(30),
  ]);
  return (
    <div className="app-body">
      <header className="app-header">
        <div className="shell app-header-inner">
          <RivaliLogo compact />
          <nav className="app-nav">
            <Link href="/dashboard">Race shop</Link>
            {isAdmin && <Link href="/admin/knowledge">Knowledge admin</Link>}
            <form action={logout}>
              <button className="button small">Sign out</button>
            </form>
          </nav>
        </div>
      </header>
      <main className="shell app-main">
        <DashboardClient
          racers={racers.data ?? []}
          karts={karts.data ?? []}
          tracks={tracks.data ?? []}
          sessions={(sessions.data ?? []) as never}
        />
      </main>
    </div>
  );
}
