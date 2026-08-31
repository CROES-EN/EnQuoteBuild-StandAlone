import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { X, Mail, Plus } from "lucide-react";

const roles = [
  { value: "submitter", label: "Submitter", description: "Can create and submit quotes" },
  { value: "approver", label: "Approver", description: "Can approve and create quotes" },
  { value: "invoicer", label: "Invoicer", description: "Can review inactive revenue and invoice operations" },
  { value: "admin", label: "Admin", description: "Full access to all features" }
];

export default function UserForm({ user, onSave, onCancel, isLoading }) {
  const [formData, setFormData] = useState({
    app_role: "submitter",
    department: "",
    first_name: "",
    last_name: "",
    additional_roles: []
  });
  const [showRolePicker, setShowRolePicker] = useState(false);

  useEffect(() => {
    if (user) {
      const displayName = user.display_name || user.full_name || "";
      const nameParts = displayName.split(" ");
      const first = nameParts[0] || "";
      const last = nameParts.slice(1).join(" ") || "";
      setFormData({
        app_role: user.app_role || "submitter",
        department: user.department || "",
        first_name: first,
        last_name: last,
        additional_roles: (user.additional_roles || []).filter(role => role !== (user.app_role || "submitter"))
      });
    }
  }, [user]);

  const handleSubmit = (e) => {
    e.preventDefault();
    const { first_name, last_name, ...rest } = formData;
    const display_name = [first_name, last_name].filter(Boolean).join(" ");
    onSave({ ...rest, display_name });
  };

  const selectedRole = roles.find(r => r.value === formData.app_role);
  const assignedRoles = [formData.app_role, ...formData.additional_roles];
  const addRole = role => { if (!assignedRoles.includes(role)) setFormData({ ...formData, additional_roles: [...formData.additional_roles, role] }); setShowRolePicker(false); };
  const removeRole = role => setFormData({ ...formData, additional_roles: formData.additional_roles.filter(item => item !== role) });

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="flex items-center justify-between pb-4 border-b border-slate-200">
        <h2 className="text-xl font-semibold text-slate-900">
          {user ? "Edit User Role" : "Invite User"}
        </h2>
        <Button type="button" variant="ghost" size="icon" onClick={onCancel}>
          <X className="w-5 h-5" />
        </Button>
      </div>

      {user && (
        <div className="p-4 bg-slate-50 rounded-lg">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-indigo-100 flex items-center justify-center">
              <Mail className="w-5 h-5 text-indigo-600" />
            </div>
            <div>
              <p className="font-medium text-slate-900">{user.full_name || "No name"}</p>
              <p className="text-sm text-slate-500">{user.email}</p>
            </div>
          </div>
        </div>
      )}

      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="first_name">First Name</Label>
            <Input
              id="first_name"
              value={formData.first_name}
              onChange={(e) => setFormData({ ...formData, first_name: e.target.value })}
              placeholder="First"
              className="mt-1.5"
            />
          </div>
          <div>
            <Label htmlFor="last_name">Last Name</Label>
            <Input
              id="last_name"
              value={formData.last_name}
              onChange={(e) => setFormData({ ...formData, last_name: e.target.value })}
              placeholder="Last"
              className="mt-1.5"
            />
          </div>
        </div>

        <div>
          <Label htmlFor="app_role">Role *</Label>
          <Select
            value={formData.app_role}
            onValueChange={(value) => setFormData({ ...formData, app_role: value, additional_roles: formData.additional_roles.filter(role => role !== value) })}
          >
            <SelectTrigger className="mt-1.5">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {roles.map((role) => (
                <SelectItem key={role.value} value={role.value}>
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{role.label}</span>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {selectedRole && (
            <p className="text-sm text-slate-500 mt-1.5">{selectedRole.description}</p>
          )}
        </div>

        <div>
          <Label>Additional roles & permissions</Label>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            {formData.additional_roles.map(role => <Badge key={role} variant="outline" className="gap-1 border-indigo-200 bg-indigo-50 text-indigo-700">{roles.find(item => item.value === role)?.label}<button type="button" onClick={() => removeRole(role)} aria-label={`Remove ${role}`}><X className="h-3 w-3" /></button></Badge>)}
            <Button type="button" size="sm" variant="outline" onClick={() => setShowRolePicker(!showRolePicker)} className="h-7 gap-1"><Plus className="h-3 w-3" /> Add role</Button>
          </div>
          {showRolePicker && <Select onValueChange={addRole}><SelectTrigger className="mt-2"><SelectValue placeholder="Choose a role to add" /></SelectTrigger><SelectContent>{roles.filter(role => !assignedRoles.includes(role.value)).map(role => <SelectItem key={role.value} value={role.value}>{role.label} — {role.description}</SelectItem>)}</SelectContent></Select>}
        </div>

        <div>
          <Label htmlFor="department">Department</Label>
          <Input
            id="department"
            value={formData.department}
            onChange={(e) => setFormData({ ...formData, department: e.target.value })}
            placeholder="e.g., Sales, Operations, Finance"
            className="mt-1.5"
          />
        </div>
      </div>

      <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
        <h4 className="font-medium text-blue-900 mb-2">Role Permissions</h4>
        <ul className="text-sm text-blue-800 space-y-1">
          {formData.app_role === "submitter" && (
            <>
              <li>• Create and edit draft quotes</li>
              <li>• Submit quotes for approval</li>
              <li>• View own quotes</li>
            </>
          )}
          {formData.app_role === "approver" && (
            <>
              <li>• All Submitter permissions</li>
              <li>• Approve or reject submitted quotes</li>
              <li>• Modify quotes before approval</li>
              <li>• View all quotes</li>
            </>
          )}
          {formData.app_role === "invoicer" && (
            <>
              <li>• View the Inactive Revenue Dashboard</li>
              <li>• Review invoice-related operational queues</li>
            </>
          )}
          {formData.app_role === "admin" && (
            <>
              <li>• All Approver permissions</li>
              <li>• Manage products and services pricing</li>
              <li>• Manage users and assign roles</li>
              <li>• Full system access</li>
            </>
          )}
        </ul>
      </div>

      <div className="flex gap-3 pt-4">
        <Button type="button" variant="outline" onClick={onCancel} className="flex-1">
          Cancel
        </Button>
        <Button type="submit" disabled={isLoading} className="flex-1 bg-indigo-600 hover:bg-indigo-700">
          {isLoading ? "Saving..." : user ? "Update Role" : "Save"}
        </Button>
      </div>
    </form>
  );
}