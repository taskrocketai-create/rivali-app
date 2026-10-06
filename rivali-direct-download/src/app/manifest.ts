import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Rivali — Turn Data Into Speed",
    short_name: "Rivali",
    description: "Your racing data and crew chief, ready for Raceday.",
    start_url: "/",
    display: "standalone",
    background_color: "#000000",
    theme_color: "#a3271f",
    icons: [{ src: "/rivali-icon.png", sizes: "128x128", type: "image/png", purpose: "any" }],
  };
}
