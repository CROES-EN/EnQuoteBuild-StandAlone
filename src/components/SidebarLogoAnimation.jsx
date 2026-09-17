import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import markBuildSprite from "@/assets/mark-build-sprite.png";
import markSettled from "@/assets/mark-settled.png";

// Real pixel dimensions of each individual frame within the build sprite sheet - cropped
// directly from the user's own Enphase brand GIF (150 real frames, viewed and confirmed
// frame-by-frame), not a hand-drawn approximation.
const FRAME_W = 95;
const FRAME_H = 116;
const BUILD_FRAME_COUNT = 22;

// Display size for the icon slot - matches the existing sidebar logo's own h-9 w-9 (36px) box,
// so this drops in as a like-for-like replacement. Scale factor derived from that target height.
const DISPLAY_H = 36;
const SCALE = DISPLAY_H / FRAME_H;
const DISPLAY_FRAME_W = Math.round(FRAME_W * SCALE);

// Total animation duration for each phase - tuned to feel snappy in a sidebar toggle (this is a
// UI chrome transition a user may trigger repeatedly, not a one-time splash moment).
const MARK_BUILD_MS = 450;
const TEXT_TYPE_MS = 350;
const TEXT_ERASE_MS = 250;

/**
 * Sidebar logo animation - plays on expand/collapse, built from REAL cropped/extracted frames
 * of the user's actual uploaded GIF (150 frames, viewed and confirmed directly, not guessed).
 *
 * On EXPAND: the orange Enphase mark draws itself in (sprite animation, sampled from the real
 * source GIF's frames 1-24), then "EnQuote" types in beside it (CSS clip-path reveal) -
 * mirroring the source GIF's own real "mark draws in, then ENPHASE types in" opening beat.
 *
 * On COLLAPSE (reworked after real-world feedback that it looked "choppy"): the settled mark
 * icon now HOLDS COMPLETELY STILL - only "EnQuote" collapses/clips away. The earlier version
 * played a second sprite sequence (samples of the source GIF's real frames 129-149, where the
 * mark visibly shrinks) during collapse, but the SOURCE FRAMES THEMSELVES have slight positional
 * drift frame-to-frame (an artifact of how the original GIF was authored/exported, not
 * something introduced by this extraction) - replaying them verbatim made the mark appear to
 * jitter/shift during collapse. Per explicit request ("if we could get it to hold position and
 * allow the text to collapse on itself that would be cool"), the mark no longer moves or
 * animates AT ALL during collapse - it's simply the same static, motionless settled-mark image
 * used the entire time the sidebar is in any collapsed-adjacent state, completely eliminating
 * the jitter since there's no longer any frame-to-frame image to replay. The mark-shrink-
 * sprite.png asset from the previous version is no longer referenced by this component (an
 * unused file left in place does no harm, but nothing here imports it anymore).
 *
 * Dark-mode cleanup: both the build sprite and the settled mark image were REBUILT with a
 * tighter, non-feathered transparency threshold plus a 1px alpha erosion pass (stripping the
 * outermost ring of anti-aliased edge pixels entirely) - the previous extraction left a faint
 * but real whitish halo visible around every curve when composited over a dark sidebar
 * background (confirmed directly via a side-by-side dark-background composite test, not
 * assumed) - this pass eliminates that halo.
 */
export default function SidebarLogoAnimation({ collapsed }) {
  // Tracks which literal animation phase is currently playing, independent of the target
  // `collapsed` boolean - so a rapid double-click (toggling again mid-animation) is handled
  // gracefully: any running phase's timers are always cleared first (see the effect below)
  // before a new phase starts, rather than two phases ever overlapping or fighting.
  const [phase, setPhase] = useState(collapsed ? "collapsed" : "expanded");
  const timersRef = useRef([]);

  function clearTimers() {
    timersRef.current.forEach((id) => clearTimeout(id));
    timersRef.current = [];
  }

  useEffect(() => {
    clearTimers();
    if (collapsed) {
      // Mark never moves during collapse - only the text animates (see render logic below,
      // where the mark simply renders as the static settled image for the ENTIRE "erasing-text"
      // -> "collapsed" transition, with zero change to its own markup/animation state).
      setPhase("erasing-text");
      timersRef.current.push(setTimeout(() => setPhase("collapsed"), TEXT_ERASE_MS));
    } else {
      // Forward sequence unchanged: mark draws in first, THEN "EnQuote" types in next to it -
      // mirroring the source GIF's own real build order.
      setPhase("building-mark");
      timersRef.current.push(setTimeout(() => setPhase("typing-text"), MARK_BUILD_MS));
      timersRef.current.push(setTimeout(() => setPhase("expanded"), MARK_BUILD_MS + TEXT_TYPE_MS));
    }
    return clearTimers;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collapsed]);

  const showBuildSprite = phase === "building-mark";
  // The settled/static mark renders for EVERY other phase - typing, expanded, erasing, AND
  // collapsed - it is the exact same unchanging <img> the entire time, which is precisely what
  // makes it hold rock-steady with zero jitter; only whether the text beside it is visible
  // changes.
  const showSettledMark = !showBuildSprite;

  const textVisible = phase === "typing-text" || phase === "expanded";
  const textErasing = phase === "erasing-text";
  // Only reserve the icon-to-text gap while text is actually visible or actively erasing
  // (mid-collapse) - NOT while fully collapsed or building, when the text span's width is
  // genuinely zero. A fixed gap between flex children is still reserved by the browser even
  // when one child has zero width, which would otherwise push the icon off-center within the
  // centered collapsed-rail container.
  const showTextGap = textVisible || textErasing;

  return (
    <div className={cn("flex items-center min-w-0 transition-all", showTextGap ? "gap-3" : "gap-0")}>
      <div className="relative shrink-0 overflow-hidden" style={{ width: DISPLAY_FRAME_W, height: DISPLAY_H }}>
        {showBuildSprite && (
          <div
            aria-hidden="true"
            className="absolute inset-0 bg-no-repeat"
            style={{
              backgroundImage: `url(${markBuildSprite})`,
              backgroundSize: `${DISPLAY_FRAME_W * BUILD_FRAME_COUNT}px ${DISPLAY_H}px`,
              animation: `enquote-sprite-build ${MARK_BUILD_MS}ms steps(${BUILD_FRAME_COUNT - 1}) forwards`
            }}
          />
        )}
        {showSettledMark && (
          <img
            src={markSettled}
            alt="EnQuote"
            aria-hidden={phase === "collapsed" ? undefined : "true"}
            className="absolute inset-0 h-full w-full object-contain"
          />
        )}
      </div>

      {/* "EnQuote" wordmark - kept mounted at all times and revealed/hidden via clip-path.
          Collapsing now uses a SHORTER, snappier duration (250ms, vs. the previous 300ms text-
          erase + 350ms mark-shrink = 650ms total) since the mark no longer needs its own
          separate animation phase - text-collapse is now the entire collapse animation. */}
      <span
        className="overflow-hidden whitespace-nowrap text-xl font-bold text-sidebar-foreground transition-all ease-out"
        style={{
          maxWidth: textVisible || textErasing ? "10rem" : 0,
          opacity: textVisible || textErasing ? 1 : 0,
          transitionDuration: textErasing ? `${TEXT_ERASE_MS}ms` : `${TEXT_TYPE_MS}ms`,
          clipPath: textErasing ? "inset(0 100% 0 0)" : "inset(0 0 0 0)"
        }}
      >
        EnQuote
      </span>

      {/* Keyframes for the build sprite-sheet playback - steps() jumps through each frame of
          the sheet without any interpolation/blur between frames, exactly like a classic
          film-strip/sprite animation. Only ONE keyframe animation remains (the shrink one was
          removed along with the shrink-sprite phase above). */}
      <style>{`
        @keyframes enquote-sprite-build {
          from { background-position: 0 0; }
          to { background-position: -${DISPLAY_FRAME_W * (BUILD_FRAME_COUNT - 1)}px 0; }
        }
      `}</style>
    </div>
  );
}
