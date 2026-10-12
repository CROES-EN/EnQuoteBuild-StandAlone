export const TRACK_WIDTH = 900, TRACK_HEIGHT = 500, RIDER_RADIUS = 8;
export const STARTER_TRACK = [
  {a: {x: 40, y: 170}, b: {x: 220, y: 210}, stroke: 0},
  {a: {x: 220, y: 210}, b: {x: 400, y: 290}, stroke: 0},
  {a: {x: 400, y: 290}, b: {x: 580, y: 340}, stroke: 0},
  {a: {x: 580, y: 340}, b: {x: 760, y: 300}, stroke: 0}
];
export const newRider = (start = {x: 60, y: 140}) => ({...start, vx: 0, vy: 0, elapsed: 0, status: "ready"});

export function stepRider(rider, segments, dt = 1 / 120, bounds = {width: TRACK_WIDTH, height: TRACK_HEIGHT}) {
  if (rider.status !== "riding") return rider;
  const next = {...rider, vy: Math.min(rider.vy + 420 * dt, 400), elapsed: rider.elapsed + dt};
  next.x += next.vx * dt;
  next.y += next.vy * dt;
  for (const {a, b} of segments) {
    const dx = b.x - a.x, dy = b.y - a.y, lengthSquared = dx * dx + dy * dy;
    if (!lengthSquared) continue;
    const projection = Math.max(0, Math.min(1, ((next.x - a.x) * dx + (next.y - a.y) * dy) / lengthSquared));
    const px = a.x + projection * dx, py = a.y + projection * dy;
    const distance = Math.hypot(next.x - px, next.y - py);
    if (distance >= RIDER_RADIUS) continue;
    const length = Math.sqrt(lengthSquared);
    const nx = distance ? (next.x - px) / distance : dy / length;
    const ny = distance ? (next.y - py) / distance : -dx / length;
    next.x = px + nx * RIDER_RADIUS;
    next.y = py + ny * RIDER_RADIUS;
    const normalSpeed = next.vx * nx + next.vy * ny;
    if (normalSpeed < 0) {
      next.vx -= normalSpeed * nx;
      next.vy -= normalSpeed * ny;
    }
    next.vx *= 0.999;
    next.vy *= 0.999;
  }
  const speed = Math.hypot(next.vx, next.vy);
  if (speed > 400) {next.vx *= 400 / speed; next.vy *= 400 / speed;}
  if (next.x < -20 || next.x > bounds.width + 20 || next.y > bounds.height + 20 || next.y < -100) next.status = "fallen";
  return next;
}
