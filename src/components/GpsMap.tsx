import { useEffect, useRef } from "react";
import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet";
import MarkerClusterGroup from "react-leaflet-cluster";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { GpsPoint } from "@/lib/api-client";
import { useTheme } from "@/hooks/use-theme";

const photoIcon = L.divIcon({
  className: "clipquery-marker clipquery-marker-photo",
  html: '<span class="dot"></span>',
  iconSize: [10, 10],
  iconAnchor: [5, 5],
  popupAnchor: [0, -6],
});

const videoIcon = L.divIcon({
  className: "clipquery-marker clipquery-marker-video",
  html: '<span class="dot"></span>',
  iconSize: [10, 10],
  iconAnchor: [5, 5],
  popupAnchor: [0, -6],
});

// Cluster icon — sharp archival square, ochre accent, mono count.
// Sized by tier so dense clusters read as heavier.
function clusterIconFactory(cluster: { getChildCount: () => number }) {
  const count = cluster.getChildCount();
  let tier: "sm" | "md" | "lg" | "xl";
  let size: number;
  if (count < 10) { tier = "sm"; size = 28; }
  else if (count < 100) { tier = "md"; size = 32; }
  else if (count < 1000) { tier = "lg"; size = 38; }
  else { tier = "xl"; size = 44; }

  return L.divIcon({
    className: `clipquery-cluster clipquery-cluster-${tier}`,
    html: `<span>${count.toLocaleString()}</span>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

function FitBounds({ points }: { points: GpsPoint[] }) {
  const map = useMap();
  const fitted = useRef(false);

  useEffect(() => {
    if (points.length === 0 || fitted.current) return;
    const bounds = L.latLngBounds(points.map((p) => [p.lat, p.lng]));
    map.fitBounds(bounds, { padding: [40, 40] });
    fitted.current = true;
  }, [map, points]);

  return null;
}

interface GpsMapProps {
  points: GpsPoint[];
}

export function GpsMap({ points }: GpsMapProps) {
  const { theme } = useTheme();
  const tileUrl =
    theme === "dark"
      ? "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
      : "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png";

  return (
    <>
      <style>{`
        /* Individual markers: small sharp square dots */
        .clipquery-marker {
          background: transparent;
          border: none;
        }
        .clipquery-marker .dot {
          display: block;
          width: 10px;
          height: 10px;
          border-radius: 2px;
          border: 1px solid hsl(var(--background));
          box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.4);
        }
        .clipquery-marker-photo .dot {
          background: hsl(var(--accent-utility));
        }
        .clipquery-marker-video .dot {
          background: hsl(var(--foreground));
        }

        /* Clusters: archival square chips, mono count, ochre intensity by tier */
        .clipquery-cluster {
          background: transparent;
          border: none;
        }
        .clipquery-cluster > span {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 100%;
          height: 100%;
          border-radius: 2px;
          font-family: "JetBrains Mono", ui-monospace, monospace;
          font-size: 11px;
          font-weight: 600;
          letter-spacing: 0.02em;
          color: hsl(var(--accent-utility));
          background: hsl(var(--background) / 0.92);
          border: 1px solid hsl(var(--accent-utility) / 0.35);
          backdrop-filter: none;
        }
        .clipquery-cluster-md > span {
          border-color: hsl(var(--accent-utility) / 0.55);
        }
        .clipquery-cluster-lg > span {
          border-color: hsl(var(--accent-utility) / 0.75);
          color: hsl(var(--background));
          background: hsl(var(--accent-utility) / 0.85);
        }
        .clipquery-cluster-xl > span {
          color: hsl(var(--background));
          background: hsl(var(--accent-utility));
          border-color: hsl(var(--accent-utility));
        }

        /* Nuke the library's default cluster blobs in case any rule leaks through */
        .marker-cluster,
        .marker-cluster div {
          background: transparent !important;
          border: none !important;
          box-shadow: none !important;
        }
        .marker-cluster-small,
        .marker-cluster-medium,
        .marker-cluster-large { background-color: transparent !important; }
        .marker-cluster-small div,
        .marker-cluster-medium div,
        .marker-cluster-large div { background-color: transparent !important; }

        /* Popups: sharp corners, archival surface */
        .leaflet-popup-content-wrapper,
        .leaflet-popup-tip {
          background: hsl(var(--card));
          color: hsl(var(--foreground));
          border-radius: 2px;
          box-shadow: 0 1px 0 hsl(var(--border));
        }
        .leaflet-popup-content-wrapper {
          border: 1px solid hsl(var(--border));
        }
      `}</style>
      <MapContainer
        center={[20, 0]}
        zoom={2}
        className="h-full w-full z-0"
        scrollWheelZoom
      >
        <TileLayer
          key={theme}
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>'
          url={tileUrl}
        />
        <FitBounds points={points} />
        <MarkerClusterGroup
          chunkedLoading
          iconCreateFunction={clusterIconFactory}
          showCoverageOnHover={false}
          maxClusterRadius={50}
        >
          {points.map((pt) => (
            <Marker
              key={pt.id}
              position={[pt.lat, pt.lng]}
              icon={pt.type === "video" ? videoIcon : photoIcon}
            >
              <Popup>
                <div className="text-xs">
                  <div className="font-medium">{pt.filename}</div>
                  <div className="text-muted-foreground capitalize">{pt.type}</div>
                </div>
              </Popup>
            </Marker>
          ))}
        </MarkerClusterGroup>
      </MapContainer>
    </>
  );
}
