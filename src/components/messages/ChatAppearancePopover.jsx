import {Palette} from "lucide-react";
import {Button} from "@/components/ui/button";
import {Popover, PopoverContent, PopoverTrigger} from "@/components/ui/popover";
import {resetChatAppearance, saveChatAppearance} from "@/features/profiles/chatAppearanceStore";
import {Switch} from "@/components/ui/switch";
import {hslToHex, parseHslVar} from "@/features/theme/customThemeBuilder";

export default function ChatAppearancePopover({appearance, onChange}) {
  const presets = ["#ffffff", "#fff7ed", "#f8fafc", "#eef2ff", "#ecfdf5"];
  const update = (patch) => onChange(saveChatAppearance({...appearance, mode: "custom", ...patch}));
  const toggleTheme = (checked) => {
    if (checked) {
      update({mode: "theme"});
      return;
    }
    const variables = getComputedStyle(document.documentElement);
    const color = (name) => hslToHex(parseHslVar(variables.getPropertyValue(name)));
    update({mine: color("--primary"), theirs: color("--muted"), background: color("--background")});
  };
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" size="sm" variant="outline"><Palette className="mr-1 h-4 w-4" />Chat appearance</Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 space-y-3">
        <p className="text-sm font-semibold">Chat appearance</p>
        <label className="flex items-center justify-between gap-3 text-sm">
          <span>Match app theme</span>
          <Switch checked={appearance.mode === "theme"} onCheckedChange={toggleTheme} aria-label="Match app theme for chat" />
        </label>
        {appearance.mode === "theme" ? (
          <p className="text-xs text-muted-foreground">Chat colors follow your theme, including custom themes and Windows light/dark mode.</p>
        ) : <>
        {[
          ["mine", "My bubble"],
          ["theirs", "Others' bubble"],
          ["background", "Chat background"]
        ].map(([key, label]) => (
          <label key={key} className="flex items-center justify-between gap-3 text-sm">
            <span>{label}</span>
            <input type="color" value={appearance[key]} onChange={(event) => update({[key]: event.target.value})} className="h-8 w-12 rounded border" />
          </label>
        ))}
        <div>
          <p className="mb-1 text-xs text-muted-foreground">Background presets</p>
          <div className="flex gap-1.5">
            {presets.map((color) => (
              <button key={color} type="button" aria-label={color} className="h-7 w-7 rounded-full border" style={{backgroundColor: color}} onClick={() => update({background: color})} />
            ))}
          </div>
        </div>
        </>}
        <Button type="button" variant="ghost" size="sm" onClick={() => onChange(resetChatAppearance())}>Reset to app theme</Button>
      </PopoverContent>
    </Popover>
  );
}
