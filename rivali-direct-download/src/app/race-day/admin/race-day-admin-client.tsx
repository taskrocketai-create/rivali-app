"use client";

import { useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import { Check, Copy, Plus, TicketCheck } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

type Track = { id: string; name: string; start_finish: unknown[] | null; turns: Record<string, unknown> | null };
type RaceDay = {
  id: string; name: string; event_date: string; status: string; default_price_cents: number; expires_at: string; track_id: string;
  tracks?: { id?: string; name?: string } | { id?: string; name?: string }[] | null;
};
type Pass = {
  id: string; race_day_id: string; code: string; status: string; price_cents: number; class_name: string;
  driver_name: string | null; phone: string | null; email: string | null; claimed_at: string | null; created_at: string;
  race_days?: { name?: string; event_date?: string; tracks?: { name?: string } | { name?: string }[] | null } | { name?: string; event_date?: string; tracks?: { name?: string } | { name?: string }[] | null }[] | null;
};
type Approval = {
  id: string; session_date: string; session_type: string; report_status: string; best_lap_sec: number | null;
  racers?: { name?: string } | { name?: string }[] | null;
};

const one = <T,>(value: T | T[] | null | undefined): T | null => Array.isArray(value) ? (value[0] ?? null) : (value ?? null);

export function RaceDayAdminClient({ userId, tracks, initialRaceDays, initialPasses, approvals }: {
  userId: string; tracks: Track[]; initialRaceDays: RaceDay[]; initialPasses: Pass[]; approvals: Approval[];
}) {
  const supabase = createClient();
  const [raceDays, setRaceDays] = useState(initialRaceDays);
  const [passes, setPasses] = useState(initialPasses);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [newCode, setNewCode] = useState("");
  const openRaceDays = useMemo(() => raceDays.filter((day) => day.status === "open"), [raceDays]);

  async function createRaceDay(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setMessage("");
    const form = new FormData(event.currentTarget);
    const date = String(form.get("event_date"));
    const price = Math.round(Number(form.get("price_dollars")) * 100);
    const expiresAt = new Date(date + "T23:59:59").toISOString();
    try {
      const { data, error } = await supabase.from("race_days").insert({
        user_id: userId,
        track_id: form.get("track_id"),
        name: form.get("name"),
        event_date: date,
        default_price_cents: Number.isFinite(price) ? price : 10000,
        conditions: {
          air_temp_f: Number(form.get("air_temp_f")) || null,
          humidity_pct: Number(form.get("humidity_pct")) || null,
          track_condition: form.get("track_condition") || null,
        },
        expires_at: expiresAt,
      }).select("id,name,event_date,status,default_price_cents,expires_at,track_id,tracks(id,name)").single();
      if (error) throw error;
      setRaceDays((current) => [data as unknown as RaceDay, ...current]);
      event.currentTarget.reset();
      setMessage("Race Day created. You can issue paid class passes now.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not create Race Day.");
    } finally { setBusy(false); }
  }

  async function createPass(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setMessage(""); setNewCode("");
    const form = new FormData(event.currentTarget);
    const raceDayId = String(form.get("race_day_id"));
    const raceDay = raceDays.find((day) => day.id === raceDayId);
    if (!raceDay) { setBusy(false); return setMessage("Choose a Race Day."); }
    const price = Math.round(Number(form.get("price_dollars")) * 100);
    try {
      const response = await fetch("/api/race-day/admin/pass", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          raceDayId,
          className: String(form.get("class_name") || ""),
          priceCents: Number.isFinite(price) ? price : raceDay.default_price_cents,
          phone: String(form.get("phone") || ""),
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Could not create the pass.");
      setPasses((current) => [result.pass as Pass, ...current]);
      setNewCode(result.pass.code);
      event.currentTarget.reset();
      setMessage(result.delivery?.sent
        ? "Payment recorded. The Race Day code was texted to the driver."
        : `Payment recorded and code created. ${result.delivery?.reason ?? "Copy the invite to send it."}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not create the pass.");
    } finally { setBusy(false); }
  }

  async function copyInvite(code: string) {
    const text = `Rivali Race Day Pass\nOpen ${window.location.origin}/race-day and enter code ${code}`;
    await navigator.clipboard.writeText(text);
    setMessage(`Invite copied for code ${code}.`);
  }

  return (
    <div className="stack">
      <div className="card">
        <div className="eyebrow">RIVALI REPORT SERVICE</div>
        <h1>Race Day Passes</h1>
        <p className="muted">Create the event once. After a racer pays, issue one code per class. The racer handles their own intake and run uploads.</p>
        {message && <div className="notice">{message}</div>}
      </div>

      <div className="card">
        <div className="section-heading-row">
          <div><div className="eyebrow">OPTIONAL WINDOWS BRIDGE</div><h2>RaceStudio 3 automatic pickup</h2></div>
          <a className="button" href="/rivali-rs3-bridge.ps1" download>Download RS3 Bridge</a>
        </div>
        <p className="muted">Run this on the Windows computer using RaceStudio. Enter the driver&apos;s Race Day code and choose the folder where RS3 saves XRK files. New downloads are automatically handed to Rivali for analysis. RaceStudio still performs the MyChron download.</p>
      </div>

      <div className="grid-2">
        <form className="card stack" onSubmit={createRaceDay}>
          <div><div className="eyebrow">STEP 1</div><h2>Create Race Day</h2></div>
          <div className="field"><label>Event name</label><input name="name" placeholder="County Line Raceway · Saturday" required /></div>
          <div className="field"><label>Date</label><input name="event_date" type="date" required /></div>
          <div className="field"><label>Track</label><select name="track_id" required><option value="">Select track</option>{tracks.map((track) => <option key={track.id} value={track.id}>{track.name}</option>)}</select></div>
          <div className="field"><label>Default class price</label><input name="price_dollars" type="number" min="0" step="5" defaultValue="100" /></div>
          <div className="grid-2">
            <div className="field"><label>Air temp °F</label><input name="air_temp_f" type="number" step=".1" /></div>
            <div className="field"><label>Humidity %</label><input name="humidity_pct" type="number" min="0" max="100" step=".1" /></div>
          </div>
          <div className="field"><label>Track condition</label><select name="track_condition"><option value="">Unknown</option><option>wet/heavy</option><option>tacky</option><option>transitioning</option><option>dry/slick</option><option>rubbered</option></select></div>
          <button className="button primary" disabled={busy}><Plus size={17} /> Create Race Day</button>
        </form>

        <form className="card stack" onSubmit={createPass}>
          <div><div className="eyebrow">AFTER PAYMENT</div><h2>Issue class pass</h2></div>
          <div className="field"><label>Race Day</label><select name="race_day_id" required><option value="">Select event</option>{openRaceDays.map((day) => <option key={day.id} value={day.id}>{day.event_date} · {day.name}</option>)}</select></div>
          <div className="field"><label>Class</label><input name="class_name" placeholder="Hobby / Clone Heavy" required /></div>
          <div className="field"><label>Amount paid</label><input name="price_dollars" type="number" min="0" step="5" defaultValue="100" /></div>
          <div className="field"><label>Driver phone, optional</label><input name="phone" type="tel" placeholder="Text the code automatically when Twilio is connected" /></div>
          <button className="button primary" disabled={busy}><TicketCheck size={17} /> Payment received · create code</button>
          {newCode && <div className="notice"><strong>Race Day code: {newCode}</strong><br /><button className="button small" type="button" onClick={() => void copyInvite(newCode)}><Copy size={15} /> Copy invite</button></div>}
        </form>
      </div>

      <section className="card">
        <div className="section-heading-row"><div><div className="eyebrow">YOUR APPROVAL QUEUE</div><h2>Reports waiting on you</h2></div><Link className="button" href="/reports">Open reports</Link></div>
        {!approvals.length ? <p className="muted">Nothing waiting right now.</p> : approvals.map((row) => {
          const racer = one(row.racers);
          return <div className="session-row" key={row.id}><strong>{racer?.name ?? "Driver"}</strong><span>{row.session_type}</span><span>{row.best_lap_sec ? row.best_lap_sec.toFixed(3) + "s" : "Processing"}</span><span className="status completed"><Check size={15} /> ready for review</span></div>;
        })}
      </section>

      <section className="card">
        <div className="eyebrow">ISSUED PASSES</div><h2>Today and recent events</h2>
        {!passes.length ? <p className="muted">No Race Day passes yet.</p> : passes.map((pass) => {
          const day = one(pass.race_days);
          const track = one(day?.tracks);
          return (
            <div className="session-row" key={pass.id}>
              <div><strong>{pass.driver_name ?? "Unclaimed"}</strong><br /><small>{pass.class_name}</small></div>
              <span>{track?.name ?? day?.name ?? "Race Day"}</span>
              <button className="button small secondary" type="button" onClick={() => void copyInvite(pass.code)}><Copy size={14} /> {pass.code}</button>
              <span className={`status ${pass.status === "active" ? "completed" : "queued"}`}>{pass.status}</span>
              <strong>{(pass.price_cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 })}</strong>
            </div>
          );
        })}
      </section>
    </div>
  );
}
