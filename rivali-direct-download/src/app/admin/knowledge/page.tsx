import Link from "next/link";
import { redirect } from "next/navigation";
import { logout } from "@/app/login/actions";
import { KnowledgeVideoUpload } from "@/components/knowledge-video-upload";
import { RivaliLogo } from "@/components/rivali-logo";
import { createClient } from "@/lib/supabase/server";
import type { KnowledgeUploadJob } from "@/types/domain";

export const dynamic = "force-dynamic";

export default async function KnowledgeAdminPage() {
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  if (!claimsData?.claims?.sub) redirect("/login");
  const role = (claimsData.claims.app_metadata as { role?: string } | undefined)?.role;
  if (role !== "rivali_admin") redirect("/dashboard");

  const [{ data: jobs }, { data: knowledge }] = await Promise.all([
    supabase
      .from("knowledge_upload_jobs")
      .select("id,original_filename,status,knowledge_points_added,error,source_platform,created_at")
      .order("created_at", { ascending: false })
      .limit(100),
    supabase
      .from("knowledge_items")
      .select("id,title,body,knowledge_category,confidence_note,status,source_name,source_platform,created_at")
      .in("source_type", ["uploaded_video", "youtube"])
      .order("created_at", { ascending: false })
      .limit(100),
  ]);

  return (
    <div className="app-body">
      <header className="app-header">
        <div className="shell app-header-inner">
          <RivaliLogo compact />
          <nav className="app-nav">
            <Link href="/dashboard">Race shop</Link>
            <Link href="/admin/knowledge">Knowledge admin</Link>
            <form action={logout}><button className="button small">Sign out</button></form>
          </nav>
        </div>
      </header>
      <main className="shell app-main knowledge-admin-page">
        <div className="dashboard-title">
          <div>
            <div className="eyebrow">RIVALI OWNER ACCESS</div>
            <h1>Knowledge intake.</h1>
          </div>
        </div>
        <KnowledgeVideoUpload initialJobs={(jobs ?? []) as KnowledgeUploadJob[]} />
        <section className="card distilled-library">
          <div className="eyebrow">DISTILLED VIDEO KNOWLEDGE</div>
          <h2>Recently extracted</h2>
          {!knowledge?.length ? <p className="muted">Completed video claims will appear here.</p> : knowledge.map((item) => (
            <article className="knowledge-claim" key={item.id}>
              <div>
                <strong>{item.title}</strong>
                <span>{item.knowledge_category?.replaceAll("_", " ")} · {item.status}</span>
              </div>
              <p>{item.body}</p>
              <small>{item.source_name}{item.source_platform ? ` · ${item.source_platform}` : ""}</small>
              {item.confidence_note && <small>{item.confidence_note}</small>}
            </article>
          ))}
        </section>
      </main>
    </div>
  );
}
