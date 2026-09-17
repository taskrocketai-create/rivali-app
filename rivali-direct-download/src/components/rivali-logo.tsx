import Image from "next/image";
import Link from "next/link";

export function RivaliLogo({ compact = false }: { compact?: boolean }) {
  return (
    <Link className={`brand-logo ${compact ? "compact" : ""}`} href="/">
      <Image
        src="/rivali-logo.webp"
        alt="Rivali — Turn Data Into Speed"
        width={1200}
        height={800}
        priority
      />
    </Link>
  );
}
