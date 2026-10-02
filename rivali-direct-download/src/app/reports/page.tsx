import Link from "next/link";
import { redirect } from "next/navigation";
import { logout } from "@/app/login/actions";
import { createClient } from "@/lib/supabase/server";
import { RivaliLogo } from "@/components/rivali-logo";
import { ReportServiceClient } from "@/components/report-service-client";

export const dynamic = "force-dynamic";

export default async function ReportsPage() {
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  if (!claimsData?.claims?.sub) redirect("/login");

  const [sessions, telemetry, debriefs] = await Promise.all([
    supabase
      .from("sessions")
      .select(
        "id,session_date,session_type,status,best_lap_sec,average_lap_sec,consistency_stdev_sec,lap_count,setup,conditions,raw_file_name,tracks(id,name),racers(id,name),karts(id,name),recommendations(recommendation,confidence,evidence)",
      )
      .order("session_date", { ascending: false })
      .limit(40),
    supabase
      .from("session_telemetry")
      .select("session_id,laps,channel_manifest,corner_analysis")
      .limit(40),
    supabase
      .from("voice_debriefs")
      .select("session_id,status,transcript,created_at")
      .eq("status", "completed")
      .order("created_at", { ascending: false })
      .limit(80),
  ]);

  return (
    <div className="app-body">
      <header className="app-header">
        <div className="shell app-header-inner">
          <RivaliLogo compact />
          <nav className="app-nav">
            <Link href="/reports">Report service</Link>
            <Link href="/dashboard">Race shop</Link>
            <form action={logout}>
              <button className="button small">Sign out</button>
            </form>
          </nav>
        </div>
      </header>
      <main className="shell app-main">
        <ReportServiceClient
          sessions={(sessions.data ?? []) as never}
          telemetry={(telemetry.data ?? []) as never}
          debriefs={(debriefs.data ?? []) as never}
        />
      </main>
    </div>
  );
}
