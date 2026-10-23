import Link from "next/link";
import { login, signup } from "./actions";
export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const query = await searchParams;
  const uploader = process.env.RIVALI_UPLOADER_STANDALONE === "1";
  return (
    <main className={uploader ? "auth-page uploader-auth" : "auth-page"}>
      <section className="auth-art">
        <Link className="wordmark" href="/">
          {uploader ? <img src="/rivali-uploader-flat.svg" alt="Rivali Uploader" style={{width:"min(430px,90%)",height:"auto"}} /> : <>RIVALI<span>TURN DATA INTO SPEED</span></>}
        </Link>
        <h1>{uploader ? "RACE DAY. READY." : "Make the next lap smarter."}</h1>
        <p>
          {uploader ? "Five karts. Trackside setup. MyChron telemetry. Doug crew chief." : "One history for the driver, kart, setup, track, conditions, and data."}
        </p>
      </section>
      <section className="auth-panel">
        <form className="card auth-card">
          <h2>{uploader ? "UPLOADER ACCESS" : "Driver access"}</h2>
          <p className="muted">
            {uploader ? "Sign in to your standalone trackside workspace." : "Sign in or create the account that owns your race data."}
          </p>
          {query.error && <p className="form-error">{String(query.error)}</p>}
          {query.message && (
            <p className="form-success">{String(query.message)}</p>
          )}
          <div className="field">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
            />
          </div>
          <div className="field">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              name="password"
              type="password"
              minLength={8}
              autoComplete="current-password"
              required
            />
          </div>
          <button className="button full" formAction={login}>
            Sign in
          </button>
          <div className="divider" />
          <button className="button ghost full" formAction={signup}>
            Create account
          </button>
        </form>
      </section>
    {uploader && <style>{`.uploader-auth{background:#060809;color:white}.uploader-auth .auth-art{background:linear-gradient(140deg,#080c0b,#151c08)!important}.uploader-auth .auth-art h1{font-size:clamp(38px,5.5vw,85px);color:#f4ff00!important}.uploader-auth .auth-card{border:1px solid #606d12;background:#0c1010}.uploader-auth .auth-card:before{background:#f4ff00!important}.uploader-auth .button:not(.ghost){background:#f4ff00!important;color:#080808!important}.uploader-auth .wordmark{display:block;width:100%;max-width:460px}`}</style>}</main>
  );
}

