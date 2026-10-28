import {toast} from "sonner";
import {Card} from "@/components/ui/card";
import {Switch} from "@/components/ui/switch";
import {Button} from "@/components/ui/button";
import {useUserRole} from "@/components/auth/RoleGuard";
import {useAccessPolicy} from "@/features/admin/adminApi";
import {canAccessPage} from "@/lib/rolePageAccess";
import {navigationItems} from "@/lib/navigationItems";
import {writeAppPreferences} from "@/lib/appPreferences";
import {useAppPreferences} from "@/hooks/useAppPreferences";

export default function Settings() {
  const preferences = useAppPreferences();
  const {user} = useUserRole();
  const {policy} = useAccessPolicy();
  const hasWorkspace = Boolean(globalThis.window?.enquoteLocal?.salesforce?.openWorkspace);
  const items = navigationItems.filter(item => item.page !== "Settings" && canAccessPage(user, item.page, policy));

  function save(changes) {
    try {
      writeAppPreferences({...preferences, ...changes});
    } catch (error) {
      toast.error(error?.message || "Could not save your settings.");
    }
  }

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-foreground">Settings</h1>
        <p className="text-muted-foreground">Personal preferences saved to your EnQuote account and synced between the desktop app and the browser.</p>
      </header>
      <Card className="p-6 space-y-4">
        <h2 className="text-lg font-semibold">Salesforce</h2>
        <label className="block space-y-2">
          <span className="font-medium">Open case links in</span>
          <select className="block w-full rounded-md border border-input bg-background p-2"
            value={hasWorkspace ? preferences.salesforceMode : "external"}
            onChange={event => save({salesforceMode: event.target.value})}>
            <option value="workspace" disabled={!hasWorkspace}>Resizable EnQuote Salesforce side panel</option>
            <option value="external">External browser / new tab</option>
          </select>
        </label>
        <p className="text-sm text-muted-foreground">
          The desktop workspace reuses one borderless Salesforce side panel and remembers its Salesforce sign-in.
          It does not use your Edge login or control Edge tabs. Case links navigate that panel;
          Salesforce console subtabs are managed within Salesforce, not automatically by EnQuote.
          Click the cloud to slide the panel in or tuck it away without reloading its page.
          Focus view opens wide with EnQuote dimmed behind it. Use Expand/Restore in the
          toolbar or drag the left edge for a narrower view; your layout is remembered on this device.
          Click the dimmed background or press Escape to return to EnQuote.
        </p>
        {!hasWorkspace && <p className="text-sm text-muted-foreground">Use the updated EnQuote desktop app for the reusable Salesforce workspace.</p>}
        <div className="flex items-center justify-between gap-4">
          <label htmlFor="salesforce-launcher">Show floating Salesforce launcher</label>
          <Switch id="salesforce-launcher" checked={preferences.showSalesforceLauncher} disabled={!hasWorkspace}
            onCheckedChange={checked => save({showSalesforceLauncher: checked})} />
        </div>
        <p className="text-sm text-muted-foreground">
          The workspace shares the desktop report-import Salesforce session, but report imports open
          separately and will not close your case window. Sign out within Salesforce when needed.
        </p>
      </Card>
      <Card className="p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">Sidebar tabs</h2>
          <Button variant="outline" size="sm" onClick={() => save({hiddenPages: []})}>Show all available tabs</Button>
        </div>
        <p className="text-sm text-muted-foreground">
          Choose which tabs appear in desktop and mobile navigation. Hiding a tab does not change
          permissions or block direct links. Settings stays visible so you can restore tabs.
          Drag visible sidebar tabs to reorder them.
        </p>
        <div className="divide-y divide-border">
          {items.map(item => (
            <div key={item.page} className="flex items-center justify-between gap-4 py-3">
              <label htmlFor={`show-${item.page}`} className="flex items-center gap-2">
                <item.icon className="h-4 w-4 text-muted-foreground" />{item.name}
              </label>
              <Switch id={`show-${item.page}`} checked={!preferences.hiddenPages.includes(item.page)}
                onCheckedChange={checked => save({hiddenPages: checked
                  ? preferences.hiddenPages.filter(page => page !== item.page)
                  : [...preferences.hiddenPages, item.page]})} />
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
