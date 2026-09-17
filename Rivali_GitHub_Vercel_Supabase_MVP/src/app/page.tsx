import Link from "next/link";
import { ArrowRight, CloudUpload, Gauge, Map, ShieldCheck } from "lucide-react";

const features = [
  {
    icon: CloudUpload,
    title: "Upload the run",
    body: "Send the MyChron .xrk file from any phone or laptop. Rivali preserves the raw data and queues analysis.",
  },
  {
    icon: Map,
    title: "Map every corner",
    body: "Overlay the recorded GPS line on satellite imagery and define start/finish plus Turns 1–4.",
  },
  {
    icon: Gauge,
    title: "Compare what changed",
    body: "Connect lap time, corner speed, setup, stagger, weather, humidity, and track condition across sessions.",
  },
  {
    icon: ShieldCheck,
    title: "Keep data separated",
    body: "Private accounts and row-level security keep every race team’s files and history isolated.",
  },
];

export default function Home() {
  return (
    <main>
      <nav className="nav shell">
        <Link className="wordmark" href="/">
          RIVALI<span>TURN DATA INTO SPEED</span>
        </Link>
        <Link className="button ghost small" href="/login">
          Sign in
        </Link>
      </nav>
      <section className="hero shell">
        <div className="eyebrow">
          THE DIGITAL CREW CHIEF FOR DIRT OVAL KARTS
        </div>
        <h1>
          Your stopwatch tells you <em>what</em> happened. Rivali helps explain{" "}
          <em>why.</em>
        </h1>
        <p className="lede">
          Upload race data, match it to the kart setup and track conditions,
          then turn each session into a grounded next move.
        </p>
        <div className="hero-actions">
          <Link className="button" href="/login">
            Open Rivali <ArrowRight size={18} />
          </Link>
          <a className="text-link" href="#system">
            See the system
          </a>
        </div>
        <div className="speed-line" aria-hidden="true">
          <span />
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
