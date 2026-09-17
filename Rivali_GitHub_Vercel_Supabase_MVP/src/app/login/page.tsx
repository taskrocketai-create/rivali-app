import Link from "next/link";
import { login, signup } from "./actions";
export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const query = await searchParams;
  return (
    <main className="auth-page">
      <section className="auth-art">
        <Link className="wordmark" href="/">
          RIVALI<span>TURN DATA INTO SPEED</span>
        </Link>
        <h1>Make the next lap smarter.</h1>
        <p>
          One history for the driver, kart, setup, track, conditions, and data.
        </p>
      </section>
      <section className="auth-panel">
        <form className="card auth-card">
          <h2>Driver access</h2>
          <p className="muted">
            Sign in or create the account that owns your race data.
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
    </main>
  );
}
