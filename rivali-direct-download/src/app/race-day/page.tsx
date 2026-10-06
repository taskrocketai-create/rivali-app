import { RivaliLogo } from "@/components/rivali-logo";
import { RaceDayClient } from "./race-day-client";
import styles from "./race-day.module.css";

export const dynamic = "force-dynamic";

export default function RaceDayPage() {
  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <header className={styles.header}>
          <RivaliLogo compact />
          <span>Race Day Pass</span>
        </header>
        <RaceDayClient />
      </div>
    </main>
  );
}
