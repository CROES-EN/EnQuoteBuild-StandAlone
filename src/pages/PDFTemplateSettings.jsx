import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { FileText, Save } from "lucide-react";
import { toast } from "sonner";
import RoleGuard from "@/components/auth/RoleGuard";
import { createLocalRecord, exportLocalData, importLocalData, isLocalDataSource, listLocalCollection, resetLocalData, updateLocalRecord } from "@/api/dataClient";

function PDFTemplateSettingsContent() {
  const queryClient = useQueryClient();
  const [formData, setFormData] = useState({
    company_name: "QuotePro",
    company_address: "",
    company_phone: "",
    company_email: "",
    primary_color: "#4f46e5",
    include_version_history: true,
    footer_text: ""
  });

  const handleExportData = async () => {
    try {
      const data = await exportLocalData();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = `enquote-demo-backup-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      URL.revokeObjectURL(link.href);
    } catch (error) {
      toast.error(error.message);
    }
  };

  const handleImportData = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      await importLocalData(JSON.parse(await file.text()));
      queryClient.invalidateQueries();
      toast.success("Demonstration data imported");
    } catch (error) {
      toast.error(`Import failed: ${error.message}`);
    } finally {
      event.target.value = "";
    }
  };

  const handleResetData = async () => {
    if (!window.confirm("Reset all local demonstration data to its seed state?")) return;
    try {
      await resetLocalData();
      queryClient.invalidateQueries();
      toast.success("Demonstration data reset");
    } catch (error) {
      toast.error(error.message);
    }
  };

  const { data: templates = [], isLoading } = useQuery({
    queryKey: ["pdfTemplates"],
    queryFn: () => listLocalCollection("pdfTemplates")
  });

  useEffect(() => {
    if (templates.length > 0) {
      setFormData({
        company_name: templates[0].company_name || "QuotePro",
        company_address: templates[0].company_address || "",
        company_phone: templates[0].company_phone || "",
        company_email: templates[0].company_email || "",
        primary_color: templates[0].primary_color || "#4f46e5",
        include_version_history: templates[0].include_version_history ?? true,
        footer_text: templates[0].footer_text || ""
      });
    }
  }, [templates]);

  const createMutation = useMutation({
    mutationFn: (data) => createLocalRecord("pdfTemplates", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pdfTemplates"] });
      toast.success("PDF template settings saved");
    }
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => updateLocalRecord("pdfTemplates", id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pdfTemplates"] });
      toast.success("PDF template settings updated");
    }
  });

  const handleSave = () => {
    if (templates.length > 0) {
      updateMutation.mutate({ id: templates[0].id, data: formData });
    } else {
      createMutation.mutate(formData);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex justify-between items-center mb-8">
          <div>
            <h1 className="text-3xl font-bold text-slate-900">PDF Template Settings</h1>
            <p className="text-slate-600 mt-1">Customize the appearance of generated PDF quotes</p>
          </div>
        </div>

        {isLocalDataSource && <Card className="mb-6 border-amber-200 bg-amber-50 p-5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="font-semibold text-amber-900">Local Demonstration Data</h2>
              <p className="text-sm text-amber-800">Back up, restore, or reset the local proof-of-concept database.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={handleExportData}>Export Data</Button>
              <Button variant="outline" onClick={() => document.getElementById("local-data-import").click()}>Import Data</Button>
              <Button variant="destructive" onClick={handleResetData}>Reset Demo Data</Button>
              <input id="local-data-import" type="file" accept="application/json" className="hidden" onChange={handleImportData} />
            </div>
          </div>
        </Card>}

        <Card className="p-6">
          <div className="space-y-6">
            <div>
              <h3 className="text-lg font-semibold text-slate-900 mb-4 flex items-center gap-2">
                <FileText className="w-5 h-5 text-indigo-600" />
                Company Information
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="company_name">Company Name</Label>
                  <Input
                    id="company_name"
                    value={formData.company_name}
                    onChange={(e) => setFormData({ ...formData, company_name: e.target.value })}
                    placeholder="QuotePro"
                    className="mt-1.5"
                  />
                </div>
                <div>
                  <Label htmlFor="company_phone">Phone Number</Label>
                  <Input
                    id="company_phone"
                    value={formData.company_phone}
                    onChange={(e) => setFormData({ ...formData, company_phone: e.target.value })}
                    placeholder="(555) 123-4567"
                    className="mt-1.5"
                  />
                </div>
                <div className="md:col-span-2">
                  <Label htmlFor="company_address">Address</Label>
                  <Input
                    id="company_address"
                    value={formData.company_address}
                    onChange={(e) => setFormData({ ...formData, company_address: e.target.value })}
                    placeholder="123 Main St, City, State 12345"
                    className="mt-1.5"
                  />
                </div>
                <div>
                  <Label htmlFor="company_email">Email</Label>
                  <Input
                    id="company_email"
                    type="email"
                    value={formData.company_email}
                    onChange={(e) => setFormData({ ...formData, company_email: e.target.value })}
                    placeholder="contact@company.com"
                    className="mt-1.5"
                  />
                </div>
              </div>
            </div>

            <div className="pt-6 border-t border-slate-200">
              <h3 className="text-lg font-semibold text-slate-900 mb-4">Branding</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="primary_color">Primary Color (Hex)</Label>
                  <div className="flex gap-2 mt-1.5">
                    <Input
                      id="primary_color"
                      value={formData.primary_color}
                      onChange={(e) => setFormData({ ...formData, primary_color: e.target.value })}
                      placeholder="#4f46e5"
                      className="flex-1"
                    />
                    <div 
                      className="w-12 h-10 rounded border border-slate-300"
                      style={{ backgroundColor: formData.primary_color }}
                    />
                  </div>
                </div>
              </div>
            </div>

            <div className="pt-6 border-t border-slate-200">
              <h3 className="text-lg font-semibold text-slate-900 mb-4">Content Options</h3>
              <div className="space-y-4">
                <div className="flex items-center gap-2">
                  <Switch
                    id="include_version_history"
                    checked={formData.include_version_history}
                    onCheckedChange={(checked) => 
                      setFormData({ ...formData, include_version_history: checked })
                    }
                  />
                  <Label htmlFor="include_version_history" className="cursor-pointer">
                    Include version history in PDFs
                  </Label>
                </div>
                
                <div>
                  <Label htmlFor="footer_text">Footer Text</Label>
                  <Textarea
                    id="footer_text"
                    value={formData.footer_text}
                    onChange={(e) => setFormData({ ...formData, footer_text: e.target.value })}
                    placeholder="Optional footer text to appear on all pages"
                    rows={2}
                    className="mt-1.5"
                  />
                </div>
              </div>
            </div>

            <div className="pt-6 border-t border-slate-200">
              <Button 
                onClick={handleSave}
                disabled={createMutation.isPending || updateMutation.isPending}
                className="bg-indigo-600 hover:bg-indigo-700"
              >
                <Save className="w-4 h-4 mr-2" />
                Save Settings
              </Button>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}

export default function PDFTemplateSettings() {
  return (
    <RoleGuard allowedRoles={["admin"]}>
      <PDFTemplateSettingsContent />
    </RoleGuard>
  );
}