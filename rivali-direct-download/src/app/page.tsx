import Image from "next/image";
import { ArrowRight, CloudUpload, Gauge, Map, ShieldCheck } from "lucide-react";
import { login, signup } from "@/app/login/actions";
import { RivaliLogo } from "@/components/rivali-logo";

const features = [
  {
    icon: CloudUpload,
    title: "Stay on task",
    body: "Doug keeps the next important action visible so the driver knows exactly what matters now.",
  },
  {
    icon: Map,
    title: "Jump anywhere",
    body: "Follow Doug’s recommendation or move freely to any tool, session, setup, or comparison.",
  },
  {
    icon: Gauge,
    title: "Race-day guidance",
    body: "Get clear direction during the Raceday without digging through menus or losing your place.",
  },
  {
    icon: ShieldCheck,
    title: "Build knowledge",
    body: "Every setup, session, and result gives Doug better context for the next controlled change.",
  },
];

export default async function Home({ searchParams }: PageProps<"/">) {
  const query = await searchParams;
  return (
    <main className="doug-landing">
      <nav className="nav shell landing-nav">
        <RivaliLogo compact />
        <a className="button landing-login-link" href="#driver-access">Log in</a>
      </nav>
      <section className="doug-sales-hero shell">
        <div className="doug-sales-copy">
          <div className="eyebrow">YOUR AI CREW CHIEF</div>
          <h1>Race smarter.<br /><em>Every session.</em></h1>
          <p>Doug turns your notes, setup data, and race-day decisions into a clear plan—without taking control away from you.</p>
          <div className="hero-actions">
            <a className="button" href="#driver-access">Start your Raceday <ArrowRight size={18} /></a>
            <a className="button landing-secondary-button" href="#system">See how it works</a>
          </div>
        </div>
        <div className="landing-race-plan" aria-label="Rivali race-day workflow">
          <Image src="/rivali-icon.png" alt="Rivali Racing" width={128} height={128} />
          <div className="eyebrow">TURN DATA INTO SPEED</div>
          <h2>Your next session starts here.</h2>
          <ol>
            <li><strong>Plan your Raceday</strong><span>Choose your driver, kart, track, and goal.</span></li>
            <li><strong>Capture the run</strong><span>Upload your data and tell Doug what the kart did.</span></li>
            <li><strong>Review the evidence</strong><span>Compare sessions and decide on the next controlled change.</span></li>
          </ol>
          <a className="button" href="#driver-access">Start your Raceday <ArrowRight size={18} /></a>
        </div>
      </section>
      <section className="feature-grid shell" id="system">
        {features.map(({ icon: Icon, title, body }, index) => (
          <article className="feature-card" key={title}>
            <div className="feature-number">0{index + 1}</div>
            <Icon size={24} />
            <h2>{title}</h2>
            <p>{body}</p>
          </article>
        ))}
      </section>
      <section className="landing-access shell" id="driver-access">
        <div className="landing-access-copy">
          <div className="eyebrow">DRIVER ACCESS</div>
          <h2>Ready to race?</h2>
          <p>Sign in to continue your current Raceday, or create a private garage for your driver, kart, tracks, setup history, and data.</p>
        </div>
        <form className="landing-login card">
          {query.error && <p className="form-error">{String(query.error)}</p>}
          {query.message && <p className="form-success">{String(query.message)}</p>}
          <div className="field"><label htmlFor="landing-email">Email</label><input id="landing-email" name="email" type="email" autoComplete="email" required /></div>
          <div className="field"><label htmlFor="landing-password">Password</label><input id="landing-password" name="password" type="password" minLength={8} autoComplete="current-password" required /></div>
          <button className="button full" formAction={login}>Sign in and call Doug</button>
          <button className="button ghost full" formAction={signup}>Create driver account</button>
        </form>
      </section>
      <section className="proof shell">
        <div>
          <strong>RAW FILE</strong>
          <span>Preserved</span>
        </div>
        <div>
          <strong>RECOMMENDATIONS</strong>
          <span>Evidence-linked</span>
        </div>
        <div>
          <strong>TRACK MAP</strong>
          <span>Reusable</span>
        </div>
        <div>
          <strong>TEAM DATA</strong>
          <span>Private</span>
        </div>
      </section>
      <footer className="shell footer">
        RIVALI <span>Turn Data Into Speed</span>
      </footer>
    </main>
  );
}
