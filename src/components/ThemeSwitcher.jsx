import { useState } from "react";
import { Palette, Check, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { useTheme } from "@/features/theme/ThemeContext";
import { getSavedCustomColors, saveCustomColors } from "@/features/theme/themeStore";

/**
 * Theme picker dropdown, styled after VS Code's own "Preferences: Color Theme" quick-pick list -
 * each entry shows a small three-color swatch preview (background / secondary / accent) plus
 * the theme name and short description, with a checkmark on the currently active theme.
 *
 * Supports two trigger styles so this one component can be dropped into both the desktop
 * sidebar footer AND the mobile header without needing a second component:
 *   - Default (iconOnly=false): full-width bordered button matching Layout.jsx's existing
 *     "Refresh App" button style exactly (border-slate-200 bg-white rounded-xl, etc.)
 *   - iconOnly=true: compact icon-only ghost button matching the existing mobile header
 *     refresh icon button style
 */
export default function ThemeSwitcher({ iconOnly = false, className }) {
  const { themeId, themes, setThemeId, refreshCustomTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const [customColors, setCustomColors] = useState(() => getSavedCustomColors());
  const [customPanelOpen, setCustomPanelOpen] = useState(false);

  // Saves a single custom color field and applies it immediately. If "custom" isn't
  // already the active theme, switching to it (via setThemeId) triggers
  // ThemeContext's normal apply effect. If "custom" IS already active, changing themeId
  // to the same value wouldn't re-run that effect - so refreshCustomTheme() is called
  // instead, which re-applies right now using the freshly-saved color.
  function handleColorChange(colorKey, hexValue) {
    const next = { ...customColors, [colorKey]: hexValue };
    setCustomColors(next);
    saveCustomColors(next);
    if (themeId === "custom") {
      refreshCustomTheme();
    } else {
      setThemeId("custom");
    }
  }

    return (
    <>
      {/* Injected once per rendered dropdown instance - negligible cost, and keeps every
          flashy animation fully self-contained in this one file rather than requiring an
          edit to a global stylesheet (index.css) this component doesn't otherwise touch. */}
      <style>{`
        @keyframes enquoteShimmerSweep {
          from { transform: translateX(-120%); }
          to { transform: translateX(120%); }
        }
        @keyframes enquoteGlowPulse {
          0%, 100% { box-shadow: 0 0 0 0 rgba(99, 102, 241, 0.55); }
          50% { box-shadow: 0 0 10px 3px rgba(99, 102, 241, 0.55); }
        }
        @keyframes enquotePopIn {
          0% { transform: scale(0.3); opacity: 0; }
          60% { transform: scale(1.2); opacity: 1; }
          100% { transform: scale(1); }
        }
        @keyframes enquoteGradientShift {
          0%, 100% { background-position: 0% 50%; }
          50% { background-position: 100% 50%; }
        }
        .enquote-theme-swatch {
          position: relative;
          overflow: hidden;
        }
        .enquote-swatch-shimmer-el {
          position: absolute;
          inset: 0;
          pointer-events: none;
          background: linear-gradient(115deg, transparent 30%, rgba(255,255,255,0.65) 50%, transparent 70%);
          transform: translateX(-120%);
        }
        .enquote-theme-swatch:hover .enquote-swatch-shimmer-el {
          animation: enquoteShimmerSweep 0.8s ease-in-out;
        }
        .enquote-swatch-active-glow {
          animation: enquoteGlowPulse 2s ease-in-out infinite;
        }
        .enquote-check-pop {
          animation: enquotePopIn 0.35s cubic-bezier(0.34, 1.56, 0.64, 1);
        }
        .enquote-gradient-bar {
          background-size: 200% 100%;
          animation: enquoteGradientShift 3s ease-in-out infinite;
        }
      `}</style>
      <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        {iconOnly ? (
          <Button
            variant="ghost"
            size="icon"
            aria-label="Change color theme"
            title="Change color theme"
            className={className}
          >
            <Palette className="w-5 h-5" />
          </Button>
        ) : (
          <button
            type="button"
            className={cn(
              "w-full inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-50",
              className
            )}
          >
            <Palette className="w-4 h-4" />
            Theme
          </button>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="text-xs text-slate-400">
          Color Theme
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
                        {themes.map((theme) => {
          const isActive = theme.id === themeId;
          const isCustom = theme.id === "custom";
          // "custom"'s swatch always reflects whatever colors are CURRENTLY saved, not
          // the placeholder previewColors baked into themes.js (those are only a
          // fallback default, never meant to be shown once real colors exist).
          const previewColors = isCustom
            ? [customColors.background, customColors.sidebar, customColors.primary]
            : theme.previewColors;
          return (
            <div key={theme.id}>
              <DropdownMenuItem
                onSelect={(event) => {
                  // Keeps the dropdown open for "custom" so the user can immediately
                  // click the pencil icon and adjust colors right after selecting it,
                  // instead of the menu closing and requiring a second click to reopen.
                  if (isCustom) event.preventDefault();
                  setThemeId(theme.id);
                }}
                className="flex items-center gap-3 py-2"
              >
                <span
                  className={cn(
                    "enquote-theme-swatch flex shrink-0 rounded border border-slate-200",
                    isActive && "enquote-swatch-active-glow"
                  )}
                >
                  {previewColors.map((color, i) => (
                    <span
                      key={i}
                      className="block h-5 w-3"
                      style={{ backgroundColor: color }}
                    />
                  ))}
                  <span aria-hidden="true" className="enquote-swatch-shimmer-el" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-slate-800">
                    {theme.name}
                  </span>
                  <span className="block truncate text-xs text-slate-400">
                    {theme.description}
                  </span>
                </span>
                {isCustom && (
                  <button
                    type="button"
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      setCustomPanelOpen((prev) => !prev);
                    }}
                    className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                    aria-label="Edit custom colors"
                    title="Edit custom colors"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                )}
                {isActive && <Check className="enquote-check-pop h-4 w-4 shrink-0 text-indigo-600" />}
              </DropdownMenuItem>
              {isCustom && customPanelOpen && (
                <div
                  className="space-y-2 px-3 pb-2 pt-1"
                  onClick={(event) => event.stopPropagation()}
                >
                  {/* Live animated blended preview of all 3 currently-picked colors -
                      updates instantly as any color picker below changes, so the user
                      gets an at-a-glance sense of the combination before committing. */}
                  <div
                    className="enquote-gradient-bar h-2.5 w-full rounded-full shadow-sm"
                    style={{
                      backgroundImage: `linear-gradient(90deg, ${customColors.background}, ${customColors.sidebar}, ${customColors.primary})`
                    }}
                  />
                  {[
                    { key: "background", label: "Background" },
                    { key: "sidebar", label: "Sidebar" },
                    { key: "primary", label: "Primary" }
                  ].map((field) => (
                    <label
                      key={field.key}
                      className="flex items-center justify-between gap-2 text-xs text-slate-500"
                    >
                      {field.label}
                      <input
                        type="color"
                        value={customColors[field.key]}
                        onChange={(event) => handleColorChange(field.key, event.target.value)}
                        className="h-6 w-10 cursor-pointer rounded border border-slate-200"
                      />
                    </label>
                  ))}
                </div>
              )}
            </div>
          );
        })}
            </DropdownMenuContent>
    </DropdownMenu>
    </>
  );
}

