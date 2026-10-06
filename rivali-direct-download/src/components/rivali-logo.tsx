import Link from "next/link";

export function RivaliLogo({ compact = false }: { compact?: boolean }) {
  return (
    <Link className={`brand-logo ${compact ? "compact" : ""}`} href="/" aria-label="Rivali — Turn Data Into Speed. Home">
      {/* Display the approved horizontal artwork directly, preserving its lettering and hidden numbers. */}
      <span className="brand-logo-artwork" aria-hidden="true" />
    </Link>
  );
}
