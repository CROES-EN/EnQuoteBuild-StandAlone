import {useEffect, useRef, useState} from "react";
import {TRACK_WIDTH, TRACK_HEIGHT, STARTER_TRACK, newRider, stepRider} from "./trackLogic";

export default function NeonRider() {
  const [segments, setSegments] = useState(STARTER_TRACK);
  const [start, setStart] = useState({x: 60, y: 140});
  const [rider, setRider] = useState(() => newRider());
  const [mode, setMode] = useState("draw");
  const [message, setMessage] = useState("");
  const [world, setWorld] = useState({width: TRACK_WIDTH * 4, height: TRACK_HEIGHT * 4});
  const [zoom, setZoom] = useState(1);
  const [camera, setCamera] = useState({x: 0, y: 0});
  const [follow, setFollow] = useState(true);
  const drawing = useRef(null);
  const stroke = useRef(1);
  const riderRef = useRef(rider);
  const running = rider.status === "riding";
  const viewWidth = TRACK_WIDTH / zoom, viewHeight = TRACK_HEIGHT / zoom;
  const clampCamera = point => ({x: Math.max(0, Math.min(world.width - viewWidth, point.x)),
    y: Math.max(0, Math.min(world.height - viewHeight, point.y))});
  const view = running && follow ? clampCamera({x: rider.x - viewWidth / 3, y: rider.y - viewHeight / 2}) : clampCamera(camera);
  const viewRef = useRef(view);
  viewRef.current = view;
  const updateRider = value => {riderRef.current = value; setRider(value);};
  useEffect(() => {
    if (!running) return undefined;
    let frame, previous = null, accumulator = 0;
    const tick = time => {
      const delta = previous === null ? 0 : Math.min((time - previous) / 1000, 0.05);
      previous = time;
      accumulator += delta;
      let current = riderRef.current;
      while (accumulator >= 1 / 120) {current = stepRider(current, segments, 1 / 120, world); accumulator -= 1 / 120;}
      riderRef.current = current;
      setRider(current);
      if (current.status === "riding") frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    const pause = () => {
      if (document.hidden) {
        setCamera(viewRef.current);
        const next = {...riderRef.current, status: "paused"};
        riderRef.current = next;
        setRider(next);
      }
    };
    document.addEventListener("visibilitychange", pause);
    return () => {cancelAnimationFrame(frame); document.removeEventListener("visibilitychange", pause);};
  }, [running, segments, world]);
  const position = event => {
    const rect = event.currentTarget.getBoundingClientRect();
    return {x: Math.max(0, Math.min(world.width, view.x + (event.clientX - rect.left) * viewWidth / rect.width)),
      y: Math.max(0, Math.min(world.height, view.y + (event.clientY - rect.top) * viewHeight / rect.height))};
  };
  const editable = !running;
  const addPoint = event => {
    if (!drawing.current || !editable) return;
    if (drawing.current.pan) {
      const rect = event.currentTarget.getBoundingClientRect();
      setCamera(clampCamera({x: drawing.current.camera.x - (event.clientX - drawing.current.clientX) * viewWidth / rect.width,
        y: drawing.current.camera.y - (event.clientY - drawing.current.clientY) * viewHeight / rect.height}));
      return;
    }
    const point = position(event), previous = drawing.current;
    if (Math.hypot(point.x - previous.point.x, point.y - previous.point.y) < 4) return;
    if (segments.length >= 2000) {drawing.current = null; setMessage("Track limit reached. Undo a stroke or clear the track."); return;}
    setSegments(current => current.length < 2000 ? [...current, {a: previous.point, b: point, stroke: previous.stroke}] : current);
    drawing.current = {...previous, point};
  };
  return <div className="space-y-3">
    <p>Neon Rider is an original draw-and-ride toy. Drag on the canvas to draw rails, set a start point above them, then Ride. Slopes build speed; ramps send your rider flying.</p>
    <p className="enspace-score" role="status">{rider.status === "fallen" ? "Off the track! Reset rider to try again." : `${rider.status} / ${rider.elapsed.toFixed(1)} seconds`}</p>
    {message && <p role="alert">{message}</p>}
    <div className="flex flex-wrap gap-2">
      <button className="enspace-arcade-action" disabled={running || rider.status === "fallen"} onClick={() => {drawing.current = null; updateRider({...riderRef.current, status: "riding"});}}>Ride</button>
      <button className="enspace-arcade-action" disabled={!running} onClick={() => {setCamera(view); updateRider({...riderRef.current, status: "paused"});}}>Pause ride</button>
      <button className="enspace-arcade-action" onClick={() => {drawing.current = null; updateRider(newRider(start));}}>Reset rider</button>
      <button className="enspace-arcade-action" disabled={!editable} aria-pressed={mode === "start"} onClick={() => setMode(mode === "start" ? "draw" : "start")}>Set start point</button>
      <button className="enspace-arcade-action" disabled={!editable || !segments.length} onClick={() => {
        const lastStroke = segments.at(-1).stroke;
        setSegments(segments.filter(line => line.stroke !== lastStroke)); setMessage("");
      }}>Undo stroke</button>
      <button className="enspace-arcade-action" disabled={!editable} onClick={() => {
        setSegments([]); updateRider(newRider(start)); setMessage("");
      }}>Clear track</button>
      <button className="enspace-arcade-action" disabled={!editable} onClick={() => {
        setSegments(STARTER_TRACK); setStart({x: 60, y: 140}); updateRider(newRider()); setMessage("");
      }}>Example track</button>
    </div>
    <p className="text-sm">{mode === "start" ? "Click the canvas to place the rider's starting point." : "Draw with mouse, pen, or touch. The canvas does not scroll while drawing."}</p>
    <div className="flex flex-wrap items-center gap-2">
      <span>Map: {world.width} x {world.height} / Zoom: {Math.round(zoom * 100)}%</span>
      <button className="enspace-arcade-action" disabled={running || world.width >= TRACK_WIDTH * 16} onClick={() => setWorld(current => ({width: current.width * 2, height: current.height * 2}))}>Expand map</button>
      <button className="enspace-arcade-action" disabled={zoom >= 2} onClick={() => setZoom(current => Math.min(2, current * 2))}>Zoom in</button>
      <button className="enspace-arcade-action" disabled={zoom <= TRACK_WIDTH / world.width} onClick={() => setZoom(current => Math.max(TRACK_WIDTH / world.width, current / 2))}>Zoom out</button>
      <button className="enspace-arcade-action" onClick={() => {setZoom(TRACK_WIDTH / world.width); setCamera({x: 0, y: 0});}}>Fit map</button>
      <button className="enspace-arcade-action" disabled={running} aria-pressed={mode === "pan"} onClick={() => setMode(mode === "pan" ? "draw" : "pan")}>Pan map</button>
      <button className="enspace-arcade-action" disabled={running} onClick={() => {setZoom(1); setCamera({x: Math.max(0, start.x - TRACK_WIDTH / 3), y: Math.max(0, start.y - TRACK_HEIGHT / 2)});}}>View start</button>
      <label><input type="checkbox" checked={follow} onChange={event => {setCamera(view); setFollow(event.target.checked);}} /> Follow rider</label>
    </div>
    {mode === "pan" && <p role="status">Drag the canvas to pan. Click Pan map again to return to drawing.</p>}
    <svg role="img" aria-label="Neon Rider track drawing canvas" viewBox={`${view.x} ${view.y} ${viewWidth} ${viewHeight}`}
      className="enspace-track-canvas w-full" style={{touchAction: "none"}}
      onPointerDown={event => {
        if (!editable || event.button !== 0) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        if (mode === "pan") {drawing.current = {pan: true, camera: view, clientX: event.clientX, clientY: event.clientY}; return;}
        const point = position(event);
        if (mode === "start") {setStart(point); updateRider(newRider(point)); setMode("draw"); return;}
        drawing.current = {point, stroke: stroke.current++};
      }}
      onPointerMove={addPoint} onPointerUp={event => {addPoint(event); drawing.current = null;}}
      onPointerCancel={() => {drawing.current = null;}} onLostPointerCapture={() => {drawing.current = null;}}>
      <defs><pattern id="enspace-track-grid" width="25" height="25" patternUnits="userSpaceOnUse">
        <path d="M25 0H0V25" fill="none" stroke="#58edf3" strokeOpacity="0.12" />
      </pattern></defs>
      <rect width={world.width} height={world.height} fill="url(#enspace-track-grid)" />
      {segments.map((line, index) => <line key={index} x1={line.a.x} y1={line.a.y} x2={line.b.x} y2={line.b.y}
        stroke="#58edf3" strokeWidth="3" strokeLinecap="round" />)}
      <path d={`M${start.x} ${start.y + 8}v-28l14 5-14 5`} stroke="#f68bda" fill="none" strokeWidth="2" />
      <g transform={`translate(${rider.x} ${rider.y})`}>
        <path d="M-12 8H12M-7 8L0-2 7 8" fill="none" stroke="#ffe680" strokeWidth="3" />
        <circle cy="-7" r="5" fill="#f68bda" />
        <path d="M0-2L-6 3" stroke="#97fa8d" strokeWidth="3" />
      </g>
    </svg>
    <p className="text-sm">Local sandbox, not the official Line Rider game. Tracks reset when you leave.</p>
  </div>;
}
