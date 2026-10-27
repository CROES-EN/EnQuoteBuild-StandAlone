import {useEffect, useMemo, useState} from "react";
import L from "leaflet";
import {MapContainer, Marker, TileLayer, useMap, useMapEvents} from "react-leaflet";
import "leaflet/dist/leaflet.css";

// Esri tiles: OpenStreetMap's tile servers reject requests from the desktop app's file://
// pages, and satellite imagery is what makes it possible to pin the exact house.
const LAYERS = {
  satellite: {
    label: "Satellite",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    labels: "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}"
  },
  streets: {
    label: "Streets",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}"
  }
};
const ATTRIBUTION = "Tiles &copy; Esri";
const US_CENTER = [39.5, -98.35];

const pinIcon = L.divIcon({
  className: "",
  html: '<div style="width:22px;height:22px;border-radius:50% 50% 50% 0;background:#e11d48;border:2px solid #fff;transform:rotate(-45deg);box-shadow:0 1px 4px rgba(0,0,0,.5)"></div>',
  iconSize: [22, 22],
  iconAnchor: [11, 22]
});

function FollowPoint({ point, zoom }) {
  const map = useMap();
  useEffect(() => {
    // The map mounts inside an animating dialog, so measure again once it settles.
    const timer = setTimeout(() => map.invalidateSize(), 150);
    return () => clearTimeout(timer);
  }, [map]);
  useEffect(() => {
    if (point) map.setView([point.lat, point.lng], Math.max(map.getZoom(), zoom));
  }, [map, point?.lat, point?.lng]);
  return null;
}

function ClickToPin({ onPick }) {
  useMapEvents({ click: (event) => onPick({ lat: event.latlng.lat, lng: event.latlng.lng }) });
  return null;
}

export default function LocationPinMap({ point, onPick, approximate = false }) {
  const [layer, setLayer] = useState("satellite");
  const zoom = point ? (approximate ? 14 : 18) : 4;
  const initialCenter = useMemo(() => (point ? [point.lat, point.lng] : US_CENTER), []);
  const handlers = useMemo(() => ({
    dragend: (event) => {
      const { lat, lng } = event.target.getLatLng();
      onPick({ lat, lng });
    }
  }), [onPick]);
  const active = LAYERS[layer];

  return (
    <div className="space-y-1.5">
      <div className="relative h-64 w-full overflow-hidden rounded-md border border-border">
        <MapContainer center={initialCenter} zoom={zoom} maxZoom={19} className="h-full w-full" scrollWheelZoom>
          <TileLayer key={layer} url={active.url} attribution={ATTRIBUTION} maxZoom={19} maxNativeZoom={layer === "satellite" ? 19 : 18} />
          {active.labels && <TileLayer key={`${layer}-labels`} url={active.labels} maxZoom={19} maxNativeZoom={19} />}
          {point && <Marker position={[point.lat, point.lng]} icon={pinIcon} draggable eventHandlers={handlers} />}
          <FollowPoint point={point} zoom={zoom} />
          <ClickToPin onPick={onPick} />
        </MapContainer>
        <div className="absolute right-2 top-2 z-[1000] flex overflow-hidden rounded-md border border-border bg-background text-xs shadow">
          {Object.entries(LAYERS).map(([key, value]) => (
            <button
              key={key}
              type="button"
              onClick={() => setLayer(key)}
              className={`px-2 py-1 ${layer === key ? "bg-sky-600 text-white" : "text-foreground hover:bg-muted"}`}
            >
              {value.label}
            </button>
          ))}
        </div>
      </div>
      <p className="text-xs text-muted-foreground">Click the map or drag the pin onto the FST&apos;s exact home or storage unit.</p>
    </div>
  );
}
