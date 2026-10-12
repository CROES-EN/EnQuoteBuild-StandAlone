import {Gem, Heart, Leaf, Moon, Star, Sun, Waves, Zap} from "lucide-react";

const ICONS = {SUN: Sun, MOON: Moon, STAR: Star, LEAF: Leaf, WAVE: Waves, BOLT: Zap, GEM: Gem, HEART: Heart};
export default function MemoryIcon({symbol}) {
  const Icon = ICONS[symbol];
  return Icon ? <Icon aria-hidden="true" className={`enspace-memory-icon enspace-icon-${symbol.toLowerCase()}`} /> : null;
}
