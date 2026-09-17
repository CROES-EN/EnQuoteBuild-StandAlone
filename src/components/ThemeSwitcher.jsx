import { useState } from "react";
import { Palette, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { useTheme } from "@/features/theme/ThemeContext";

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
  const { themeId, themes, setThemeId } = useTheme();
  const [open, setOpen] = useState(false);

  return (
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
          return (
            <DropdownMenuItem
              key={theme.id}
              onSelect={() => setThemeId(theme.id)}
              className="flex items-center gap-3 py-2"
            >
              <span className="flex shrink-0 overflow-hidden rounded border border-slate-200">
                {theme.previewColors.map((color, i) => (
                  <span
                    key={i}
                    className="block h-5 w-3"
                    style={{ backgroundColor: color }}
                  />
                ))}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-slate-800">
                  {theme.name}
                </span>
                <span className="block truncate text-xs text-slate-400">
                  {theme.description}
                </span>
              </span>
              {isActive && <Check className="h-4 w-4 shrink-0 text-indigo-600" />}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

