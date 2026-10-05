import {useMemo, useState} from "react";
import {Check, Copy, Palette, RotateCcw, Save, Trash2, Upload} from "lucide-react";
import {Button} from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import {Switch} from "@/components/ui/switch";
import {cn} from "@/lib/utils";
import {useTheme} from "@/features/theme/ThemeContext";
import {SYSTEM_THEME_ID} from "@/features/theme/themes";
import {
  deleteCustomTheme,
  exportCustomTheme,
  getFollowSystemThemeSettings,
  getSavedCustomThemes,
  importCustomTheme,
  saveFollowSystemThemeSettings,
  upsertCustomTheme
} from "@/features/theme/themeStore";
import {DEFAULT_CUSTOM_COLORS, DENSITY_OPTIONS, buildCustomTheme, normalizeCustomThemeSettings} from "@/features/theme/customThemeBuilder";

function ThemeCard({ theme, active, onSelect }) {
  const preview = theme.previewColors || ["#f8fafc", "#1e293b", "#4f46e5"];
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "group relative rounded-xl border bg-card p-2 text-left text-card-foreground shadow-sm transition hover:-translate-y-0.5 hover:border-primary/70 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-ring",
        active ? "border-primary ring-2 ring-primary/30" : "border-border"
      )}
      aria-pressed={active}
    >
      <span className="mb-2 grid h-12 grid-cols-3 overflow-hidden rounded-lg border border-border">
        {preview.map((color, index) => <span key={`${theme.id}-${index}`} style={{ backgroundColor: color }} />)}
      </span>
      <span className="block truncate text-sm font-semibold">{theme.name}</span>
      <span className="block truncate text-xs text-muted-foreground">{theme.description}</span>
      {active && <Check className="absolute right-2 top-2 h-4 w-4 rounded-full bg-primary p-0.5 text-primary-foreground" />}
    </button>
  );
}

function Field({ label, children }) {
  return (
    <label className="grid gap-1 text-xs font-medium text-muted-foreground">
      <span>{label}</span>
      {children}
    </label>
  );
}

export default function ThemeSwitcher({ iconOnly = false, className }) {
  const { themeId, effectiveThemeId, themes, setThemeId, refreshCustomTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const [builderOpen, setBuilderOpen] = useState(false);
  const [showImportExport, setShowImportExport] = useState(false);
  const [customThemes, setCustomThemes] = useState(() => getSavedCustomThemes());
  const [editing, setEditing] = useState(() => customThemes[0] || { id: "custom", settings: DEFAULT_CUSTOM_COLORS });
  const [settings, setSettings] = useState(() => normalizeCustomThemeSettings(editing.settings));
  const [importExportText, setImportExportText] = useState("");
  const [followSettings, setFollowSettings] = useState(() => getFollowSystemThemeSettings());

  const lightThemes = useMemo(() => themes.filter((theme) => !theme.isDark && theme.id !== "custom"), [themes]);
  const darkThemes = useMemo(() => themes.filter((theme) => theme.isDark), [themes]);
  const customCards = useMemo(() => customThemes.map((theme) => {
    const built = buildCustomTheme(theme.settings);
    return {
      id: theme.id,
      name: theme.settings.name || "Custom Theme",
      description: `${theme.settings.mode === "dark" ? "Dark" : "Light"} custom • ${DENSITY_OPTIONS[theme.settings.density]?.label || "Comfortable"}`,
      isDark: built.isDark,
      previewColors: built.previewColors
    };
  }), [customThemes]);
  const allCards = useMemo(() => [...lightThemes, ...darkThemes, ...customCards], [lightThemes, darkThemes, customCards]);
  const activeThemeName = allCards.find((theme) => theme.id === effectiveThemeId)?.name || "Light+ (Default)";
  const matchWindows = themeId === SYSTEM_THEME_ID;

  function persistCustom(nextSettings, id = editing.id) {
    const saved = upsertCustomTheme({ id, settings: nextSettings });
    const nextThemes = getSavedCustomThemes();
    setCustomThemes(nextThemes);
    setEditing(saved);
    setSettings(saved.settings);
    refreshCustomTheme();
    return saved;
  }

  function updateSetting(key, value) {
    const next = normalizeCustomThemeSettings({ ...settings, [key]: value });
    setSettings(next);
    persistCustom(next);
    setThemeId(editing.id);
  }

  function createCustomTheme() {
    const saved = upsertCustomTheme({ settings: { ...settings, name: settings.name || "New Theme" } });
    setCustomThemes(getSavedCustomThemes());
    setEditing(saved);
    setSettings(saved.settings);
    setThemeId(saved.id);
    refreshCustomTheme();
  }

  function openBuilder(theme = editing) {
    setEditing(theme);
    setSettings(normalizeCustomThemeSettings(theme.settings));
    setShowImportExport(false);
    setBuilderOpen(true);
  }

  function selectCustom(id) {
    const found = customThemes.find((theme) => theme.id === id) || customThemes[0];
    setEditing(found);
    setSettings(found.settings);
    applyTheme({ id: found.id, isDark: found.settings.mode === "dark" });
  }

  function removeCustom(id) {
    const nextThemes = deleteCustomTheme(id);
    setCustomThemes(nextThemes);
    const next = nextThemes[0];
    setEditing(next);
    setSettings(next.settings);
    if (themeId === id) setThemeId(next.id);
  }

  function saveFollowSettings(next) {
    setFollowSettings(next);
    saveFollowSystemThemeSettings(next);
    if (next.enabled) setThemeId(SYSTEM_THEME_ID);
  }

  function toggleMatchWindows(checked) {
    const next = { ...followSettings, enabled: checked };
    setFollowSettings(next);
    saveFollowSystemThemeSettings(next);
    setThemeId(checked ? SYSTEM_THEME_ID : effectiveThemeId);
  }

  function applyTheme(theme) {
    if (matchWindows) {
      saveFollowSettings({
        ...followSettings,
        enabled: true,
        [theme.isDark ? "darkThemeId" : "lightThemeId"]: theme.id
      });
      return;
    }
    setThemeId(theme.id);
  }

  function copyExport() {
    const text = exportCustomTheme(editing.id);
    setImportExportText(text);
    globalThis.navigator?.clipboard?.writeText?.(text).catch(() => {});
  }

  function importTheme() {
    if (!importExportText.trim()) return;
    try {
      const imported = importCustomTheme(importExportText);
      setCustomThemes(getSavedCustomThemes());
      setEditing(imported);
      setSettings(imported.settings);
      setThemeId(imported.id);
      refreshCustomTheme();
    } catch {
      setImportExportText("Could not import theme JSON. Paste an exported EnQuote theme or a valid settings object.");
    }
  }

  return (
    <>
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger asChild>
          {iconOnly ? (
            <Button variant="ghost" size="icon" aria-label="Change color theme" title="Change color theme" className={className}>
              <Palette className="h-5 w-5" />
            </Button>
          ) : (
            <button
              type="button"
              className={cn(
                "inline-flex w-full items-center justify-center gap-2 rounded-xl border border-sidebar-border bg-sidebar-accent px-3 py-2 text-sm font-medium text-sidebar-accent-foreground transition hover:bg-sidebar-accent/80 focus:outline-none focus:ring-2 focus:ring-sidebar-ring",
                className
              )}
            >
              <Palette className="h-4 w-4" />
              Theme
            </button>
          )}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="max-h-[88vh] w-[min(42rem,calc(100vw-1rem))] overflow-y-auto border-border bg-popover p-3 text-popover-foreground">
          <DropdownMenuLabel className="flex items-center justify-between gap-3 px-1 text-sm">
            <span>Theme</span>
            <span className="text-xs font-normal text-muted-foreground">Current: {activeThemeName}</span>
          </DropdownMenuLabel>
          <p className="px-1 pb-2 text-xs text-muted-foreground">Pick a look for EnQuote. Changes apply right away.</p>
          <DropdownMenuSeparator className="bg-border" />

        <section className="space-y-2 py-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Light</h3>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {lightThemes.map((theme) => <ThemeCard key={theme.id} theme={theme} active={effectiveThemeId === theme.id} onSelect={() => applyTheme(theme)} />)}
          </div>
        </section>

        <section className="space-y-2 py-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Dark</h3>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {darkThemes.map((theme) => <ThemeCard key={theme.id} theme={theme} active={effectiveThemeId === theme.id} onSelect={() => applyTheme(theme)} />)}
          </div>
        </section>

        <section className="space-y-3 py-2">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">My themes</h3>
            <Button type="button" size="sm" variant="outline" onClick={() => openBuilder(editing)}>Create your own theme</Button>
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {customCards.map((theme) => <ThemeCard key={theme.id} theme={theme} active={effectiveThemeId === theme.id} onSelect={() => selectCustom(theme.id)} />)}
          </div>
        </section>

        <section className="space-y-2 rounded-xl border border-border bg-muted/30 p-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium">Match Windows light/dark mode</p>
              <p className="text-xs text-muted-foreground">EnQuote will switch when Windows switches.</p>
            </div>
            <Switch checked={matchWindows} onCheckedChange={toggleMatchWindows} aria-label="Match Windows light/dark mode" />
          </div>
          {matchWindows && (
            <div className="grid gap-2 pt-2 sm:grid-cols-2">
              <Field label="When Windows is light, use…">
                <select className="rounded-md border border-input bg-background px-2 py-1.5 text-sm" value={followSettings.lightThemeId} onChange={(event) => saveFollowSettings({ ...followSettings, lightThemeId: event.target.value })}>
                  {lightThemes.map((theme) => <option key={theme.id} value={theme.id}>{theme.name}</option>)}
                </select>
              </Field>
              <Field label="When Windows is dark, use…">
                <select className="rounded-md border border-input bg-background px-2 py-1.5 text-sm" value={followSettings.darkThemeId} onChange={(event) => saveFollowSettings({ ...followSettings, darkThemeId: event.target.value })}>
                  {darkThemes.map((theme) => <option key={theme.id} value={theme.id}>{theme.name}</option>)}
                </select>
              </Field>
              <p className="text-xs text-muted-foreground sm:col-span-2">Tip: while matching Windows, clicking a card updates the light or dark choice.</p>
            </div>
          )}
        </section>

        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={builderOpen} onOpenChange={setBuilderOpen}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Create your own theme</DialogTitle>
            <DialogDescription>Choose a few colors and EnQuote fills in the rest. Changes preview right away.</DialogDescription>
          </DialogHeader>
          <div className="rounded-xl border border-border bg-card p-3 text-card-foreground">
            <div className="mb-3 grid h-16 grid-cols-3 overflow-hidden rounded-lg border border-border">
              {buildCustomTheme(settings).previewColors.map((color, index) => <span key={index} style={{ backgroundColor: color }} />)}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Name"><input className="rounded-md border border-input bg-background px-2 py-1.5 text-sm" value={settings.name} onChange={(event) => updateSetting("name", event.target.value)} /></Field>
              <Field label="Base"><select className="rounded-md border border-input bg-background px-2 py-1.5 text-sm" value={settings.mode} onChange={(event) => updateSetting("mode", event.target.value)}><option value="light">Light</option><option value="dark">Dark</option></select></Field>
              <Field label="Primary"><input type="color" className="h-9 w-full rounded-md border border-input bg-background" value={settings.primary} onChange={(event) => updateSetting("primary", event.target.value)} /></Field>
              <Field label="Accent"><input type="color" className="h-9 w-full rounded-md border border-input bg-background" value={settings.accent} onChange={(event) => updateSetting("accent", event.target.value)} /></Field>
              <Field label="Background tint"><input type="color" className="h-9 w-full rounded-md border border-input bg-background" value={settings.backgroundTint} onChange={(event) => updateSetting("backgroundTint", event.target.value)} /></Field>
              <Field label="Sidebar"><input type="color" className="h-9 w-full rounded-md border border-input bg-background" value={settings.sidebar} onChange={(event) => updateSetting("sidebar", event.target.value)} /></Field>
              <Field label="Corner radius"><input type="range" min="0" max="1.5" step="0.05" value={settings.radius} onChange={(event) => updateSetting("radius", Number(event.target.value))} /></Field>
              <Field label="Density"><select className="rounded-md border border-input bg-background px-2 py-1.5 text-sm" value={settings.density} onChange={(event) => updateSetting("density", event.target.value)}>{Object.entries(DENSITY_OPTIONS).map(([key, option]) => <option key={key} value={key}>{option.label}</option>)}</select></Field>
              <Field label={`Font scale (${Math.round(settings.fontScale * 100)}%)`}><input type="range" min="0.9" max="1.12" step="0.01" value={settings.fontScale} onChange={(event) => updateSetting("fontScale", Number(event.target.value))} /></Field>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button type="button" size="sm" onClick={() => { persistCustom(settings); setThemeId(editing.id); }}><Save className="mr-1.5 h-3.5 w-3.5" /> Save</Button>
              <Button type="button" size="sm" variant="outline" onClick={createCustomTheme}><Save className="mr-1.5 h-3.5 w-3.5" /> Save as new</Button>
              <Button type="button" size="sm" variant="outline" onClick={() => updateSetting("mode", settings.mode === "dark" ? "light" : "dark")}><RotateCcw className="mr-1.5 h-3.5 w-3.5" /> Toggle base</Button>
              <Button type="button" size="sm" variant="outline" onClick={() => { const reset = normalizeCustomThemeSettings(DEFAULT_CUSTOM_COLORS); setSettings(reset); persistCustom(reset); }}><RotateCcw className="mr-1.5 h-3.5 w-3.5" /> Reset</Button>
              <Button type="button" size="sm" variant="outline" onClick={() => setShowImportExport((value) => !value)}>{showImportExport ? "Hide" : "Import / export"}</Button>
              {editing.id !== "custom" && <Button type="button" size="sm" variant="destructive" onClick={() => removeCustom(editing.id)}><Trash2 className="mr-1.5 h-3.5 w-3.5" /> Delete</Button>}
            </div>
            {showImportExport && (
              <div className="mt-3 grid gap-2">
                <div className="flex flex-wrap gap-2">
                  <Button type="button" size="sm" variant="outline" onClick={copyExport}><Copy className="mr-1.5 h-3.5 w-3.5" /> Copy export</Button>
                  <Button type="button" size="sm" variant="outline" onClick={importTheme}><Upload className="mr-1.5 h-3.5 w-3.5" /> Import JSON</Button>
                </div>
                <textarea className="min-h-20 rounded-md border border-input bg-background p-2 text-xs" placeholder="Paste a theme here to import, or copy the export text." value={importExportText} onChange={(event) => setImportExportText(event.target.value)} />
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
