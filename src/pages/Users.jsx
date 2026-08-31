import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search, UserPlus, Users as UsersIcon, Mail, Clock, X, Send } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import UserCard from "@/components/users/UserCard";
import UserForm from "@/components/users/UserForm";
import RoleGuard, { useUserRole } from "@/components/auth/RoleGuard";
import { getUsers, updateLocalRecord } from "@/api/dataClient";

const roleFilters = [
  { value: "all", label: "All Users" },
  { value: "admin", label: "Admins" },
  { value: "approver", label: "Approvers" },
  { value: "invoicer", label: "Invoicers" },
  { value: "submitter", label: "Submitters" },
  { value: "pending", label: "Pending Users" }
];

function UsersContent() {
  const queryClient = useQueryClient();
  const { user: currentUser } = useUserRole();
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [showForm, setShowForm] = useState(false);
  const [editingUser, setEditingUser] = useState(null);
  const [showInviteForm, setShowInviteForm] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("submitter");
  const [showResetPassword, setShowResetPassword] = useState(false);
  const [resetPasswordUser, setResetPasswordUser] = useState(null);
  const [showCreateUserForm, setShowCreateUserForm] = useState(false);
  const [createUserData, setCreateUserData] = useState({
    email: "",
    full_name: "",
    role: "submitter",
    department: ""
  });

  const { data: users = [], isLoading } = useQuery({
    queryKey: ["users"],
    queryFn: getUsers,
  });

  const { data: invitations = [] } = useQuery({
    queryKey: ["invitations"],
    queryFn: () => base44.entities.Invitation.filter({ status: "pending" }, "-created_date"),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ userId, data }) => {
      if (userId === currentUser?.id) {
        return base44.auth.updateMe(data);
      }
      return updateLocalRecord("users", userId, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["users"] });
      queryClient.invalidateQueries({ queryKey: ["currentUser"] });
      setShowForm(false);
      setEditingUser(null);
    }
  });

  const inviteMutation = useMutation({
    mutationFn: async ({ email, role }) => {
      // Track the invitation
      await base44.entities.Invitation.create({
        email: email,
        invited_role: role,
        status: "pending",
        invited_by: currentUser.email
      });
      
      // Send the invite email
      await base44.users.inviteUser(email, "user");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["users"] });
      queryClient.invalidateQueries({ queryKey: ["invitations"] });
      setShowInviteForm(false);
      setInviteEmail("");
      setInviteRole("submitter");
      toast.success("Invite sent successfully!");
    },
    onError: (error) => {
      toast.error(error.message || "Failed to send invite");
    }
  });

  const cancelInviteMutation = useMutation({
    mutationFn: async (invitationId) => {
      await base44.entities.Invitation.update(invitationId, { status: "cancelled" });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["invitations"] });
      toast.success("Invitation cancelled");
    },
    onError: (error) => {
      toast.error(error.message || "Failed to cancel invitation");
    }
  });

  const resendInviteMutation = useMutation({
    mutationFn: async (invitation) => {
      // First cancel the old invitation
      await base44.entities.Invitation.update(invitation.id, { status: "cancelled" });
      
      // Create a new invitation record
      await base44.entities.Invitation.create({
        email: invitation.email,
        invited_role: invitation.invited_role,
        status: "pending",
        invited_by: currentUser.email
      });
      
      // Send a new invite email
      await base44.users.inviteUser(invitation.email, "user");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["invitations"] });
      toast.success("Invitation resent");
    },
    onError: (error) => {
      toast.error(error.message || "Failed to resend invitation");
    }
  });

  const resetPasswordMutation = useMutation({
    mutationFn: async (email) => {
      await base44.auth.resetPasswordRequest(email);
    },
    onSuccess: () => {
      setShowResetPassword(false);
      setResetPasswordUser(null);
      toast.success("Password reset email sent to user");
    },
    onError: (error) => {
      toast.error(error.message || "Failed to send reset email");
    }
  });

  const filteredUsers = users.filter(user => {
    // Only show users who have an app_role assigned
    if (!user.app_role) return false;
    
    const matchesSearch = 
      user.full_name?.toLowerCase().includes(search.toLowerCase()) ||
      user.email?.toLowerCase().includes(search.toLowerCase()) ||
      user.department?.toLowerCase().includes(search.toLowerCase());
    
    let matchesRole = true;
    if (roleFilter !== "all") {
      matchesRole = user.app_role === roleFilter;
    }
    
    return matchesSearch && matchesRole;
  });

  const handleEdit = (user) => {
    setEditingUser(user);
    setShowForm(true);
  };

  const handleSave = (data) => {
    if (editingUser) {
      updateMutation.mutate({ userId: editingUser.id, data });
    }
  };

  const handleInvite = (e) => {
    e.preventDefault();
    if (inviteEmail.trim()) {
      inviteMutation.mutate({ email: inviteEmail.trim(), role: inviteRole });
    }
  };

  const handleResetPassword = (user) => {
    setResetPasswordUser(user);
    setShowResetPassword(true);
  };

  const confirmResetPassword = () => {
    if (resetPasswordUser) {
      resetPasswordMutation.mutate(resetPasswordUser.email);
    }
  };

  const handleCreateUser = (e) => {
    e.preventDefault();
    if (createUserData.email.trim()) {
      inviteMutation.mutate({ 
        email: createUserData.email.trim(), 
        role: createUserData.role 
      });
      setShowCreateUserForm(false);
      setCreateUserData({
        email: "",
        full_name: "",
        role: "submitter",
        department: ""
      });
    }
  };

  const activeUsers = users.filter(u => u.app_role);
  const stats = {
    total: activeUsers.length,
    admins: activeUsers.filter(u => u.app_role === "admin").length,
    approvers: activeUsers.filter(u => u.app_role === "approver").length,
    invoicers: activeUsers.filter(u => u.app_role === "invoicer").length,
    submitters: activeUsers.filter(u => u.app_role === "submitter").length,
    pending: invitations.length
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
          <div>
            <h1 className="text-3xl font-bold text-slate-900">User Management</h1>
            <p className="text-slate-600 mt-1">Manage user roles and permissions</p>
          </div>
          <div className="flex gap-2">
            <Button 
              onClick={() => setShowCreateUserForm(true)}
              className="bg-indigo-600 hover:bg-indigo-700 shadow-lg shadow-indigo-200"
            >
              <UserPlus className="w-4 h-4 mr-2" />
              Create User
            </Button>
            <Button 
              onClick={() => setShowInviteForm(true)}
              variant="outline"
              className="shadow-sm"
            >
              <Mail className="w-4 h-4 mr-2" />
              Send Invite
            </Button>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 lg:grid-cols-6 gap-4 mb-6">
          <Card className="p-4 border-slate-200">
            <p className="text-sm text-slate-600">Total Users</p>
            <p className="text-2xl font-bold text-slate-900 mt-1">{stats.total}</p>
          </Card>
          <Card className="p-4 border-slate-200">
            <p className="text-sm text-slate-600">Admins</p>
            <p className="text-2xl font-bold text-violet-600 mt-1">{stats.admins}</p>
          </Card>
          <Card className="p-4 border-slate-200">
            <p className="text-sm text-slate-600">Approvers</p>
            <p className="text-2xl font-bold text-emerald-600 mt-1">{stats.approvers}</p>
          </Card>
          <Card className="p-4 border-slate-200">
            <p className="text-sm text-slate-600">Invoicers</p>
            <p className="text-2xl font-bold text-amber-600 mt-1">{stats.invoicers}</p>
          </Card>
          <Card className="p-4 border-slate-200">
            <p className="text-sm text-slate-600">Submitters</p>
            <p className="text-2xl font-bold text-blue-600 mt-1">{stats.submitters}</p>
          </Card>
          <Card className="p-4 border-slate-200">
            <p className="text-sm text-slate-600">Pending Users</p>
            <p className="text-2xl font-bold text-amber-600 mt-1">{stats.pending}</p>
          </Card>
        </div>

        {/* Pending Invitations Section */}
        {invitations.length > 0 && (
          <Card className="p-6 mb-6 border-amber-200 bg-amber-50">
            <div className="flex items-center gap-2 mb-4">
              <Clock className="w-5 h-5 text-amber-600" />
              <h2 className="text-lg font-semibold text-slate-900">Pending Invitations</h2>
              <span className="text-sm text-amber-600">({invitations.length})</span>
            </div>
            <div className="space-y-2">
              {invitations.map((invitation) => (
                <div 
                  key={invitation.id}
                  className="flex items-center justify-between p-3 bg-white rounded-lg border border-amber-200"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center">
                      <Mail className="w-5 h-5 text-amber-600" />
                    </div>
                    <div>
                      <p className="font-medium text-slate-900">{invitation.email}</p>
                      <p className="text-sm text-slate-500">
                        Invited as {invitation.invited_role} • Sent {format(new Date(invitation.created_date), "MMM d, yyyy")}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => resendInviteMutation.mutate(invitation)}
                      disabled={resendInviteMutation.isPending}
                      className="h-8 text-xs text-indigo-600 hover:text-indigo-700"
                    >
                      <Send className="w-3 h-3 mr-1" />
                      Resend
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => cancelInviteMutation.mutate(invitation.id)}
                      disabled={cancelInviteMutation.isPending}
                      className="h-8 w-8 text-slate-400 hover:text-red-600"
                    >
                      <X className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        )}

        {/* Filters */}
        <Card className="p-4 mb-6 border-slate-200">
          <div className="flex flex-col md:flex-row gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <Input
                placeholder="Search users..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
            <div className="flex gap-2 overflow-x-auto pb-2 md:pb-0">
              {roleFilters.filter(f => f.value !== "pending").map((filter) => (
                <button
                  key={filter.value}
                  onClick={() => setRoleFilter(filter.value)}
                  className={cn(
                    "px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors",
                    roleFilter === filter.value
                      ? "bg-indigo-100 text-indigo-700"
                      : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                  )}
                >
                  {filter.label}
                </button>
              ))}
            </div>
          </div>
        </Card>

        {/* Users Grid */}
        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[1, 2, 3, 4, 5, 6].map(i => (
              <Card key={i} className="h-32 animate-pulse bg-slate-100" />
            ))}
          </div>
        ) : filteredUsers.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredUsers.map((user, index) => (
              <UserCard 
                key={user.id} 
                user={user} 
                index={index}
                onEdit={handleEdit}
                onResetPassword={handleResetPassword}
                currentUserEmail={currentUser?.email}
              />
            ))}
          </div>
        ) : (
          <Card className="p-12 text-center border-slate-200">
            <UsersIcon className="w-12 h-12 text-slate-300 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-slate-900 mb-2">No users found</h3>
            <p className="text-slate-600">
              {search || roleFilter !== "all" 
                ? "Try adjusting your filters" 
                : "No users in the system yet"}
            </p>
          </Card>
        )}
      </div>

      {/* User Form Sheet */}
      <Sheet open={showForm} onOpenChange={setShowForm}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
          <UserForm
            user={editingUser}
            onSave={handleSave}
            onCancel={() => { setShowForm(false); setEditingUser(null); }}
            isLoading={updateMutation.isPending}
          />
        </SheetContent>
      </Sheet>

      {/* Create User Sheet */}
      <Sheet open={showCreateUserForm} onOpenChange={setShowCreateUserForm}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Create New User</SheetTitle>
            <SheetDescription>
              Create a new user account and send them a secure link to set their password
            </SheetDescription>
          </SheetHeader>
          
          <form onSubmit={handleCreateUser} className="space-y-6 mt-6">
            <div>
              <Label htmlFor="create_email">Email Address *</Label>
              <Input
                id="create_email"
                type="email"
                value={createUserData.email}
                onChange={(e) => setCreateUserData({...createUserData, email: e.target.value})}
                placeholder="user@example.com"
                required
                className="mt-1.5"
              />
            </div>

            <div>
              <Label htmlFor="create_name">Full Name</Label>
              <Input
                id="create_name"
                type="text"
                value={createUserData.full_name}
                onChange={(e) => setCreateUserData({...createUserData, full_name: e.target.value})}
                placeholder="John Doe"
                className="mt-1.5"
              />
            </div>

            <div>
              <Label htmlFor="create_role">Role *</Label>
              <Select value={createUserData.role} onValueChange={(value) => setCreateUserData({...createUserData, role: value})}>
                <SelectTrigger className="mt-1.5">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="submitter">Submitter</SelectItem>
                  <SelectItem value="approver">Approver</SelectItem>
                  <SelectItem value="invoicer">Invoicer</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-slate-500 mt-2">
                {createUserData.role === "admin" && "Full system access including user management"}
                {createUserData.role === "approver" && "Can create quotes and approve/reject submissions"}
                {createUserData.role === "invoicer" && "Can review inactive revenue and invoice operations"}
                {createUserData.role === "submitter" && "Can create and submit quotes for approval"}
              </p>
            </div>

            <div>
              <Label htmlFor="create_department">Department</Label>
              <Input
                id="create_department"
                type="text"
                value={createUserData.department}
                onChange={(e) => setCreateUserData({...createUserData, department: e.target.value})}
                placeholder="e.g., Sales, Operations"
                className="mt-1.5"
              />
            </div>

            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <div className="flex gap-2">
                <Mail className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-blue-900">Secure Password Setup</p>
                  <p className="text-xs text-blue-700 mt-1">
                    The user will receive an email with a secure link to create their own password. 
                    For security, passwords cannot be set by administrators.
                  </p>
                </div>
              </div>
            </div>

            <div className="flex gap-3 pt-4">
              <Button 
                type="button" 
                variant="outline" 
                onClick={() => {
                  setShowCreateUserForm(false);
                  setCreateUserData({
                    email: "",
                    full_name: "",
                    role: "submitter",
                    department: ""
                  });
                }}
                className="flex-1"
              >
                Cancel
              </Button>
              <Button 
                type="submit" 
                disabled={inviteMutation.isPending}
                className="flex-1 bg-indigo-600 hover:bg-indigo-700"
              >
                {inviteMutation.isPending ? "Creating..." : "Create User"}
              </Button>
            </div>
          </form>
        </SheetContent>
      </Sheet>

      {/* Invite User Sheet */}
      <Sheet open={showInviteForm} onOpenChange={setShowInviteForm}>
        <SheetContent className="w-full sm:max-w-lg">
          <SheetHeader>
            <SheetTitle>Invite New User</SheetTitle>
            <SheetDescription>
              Send an invitation email to add a new user to the system
            </SheetDescription>
          </SheetHeader>
          
          <form onSubmit={handleInvite} className="space-y-6 mt-6">
            <div>
              <Label htmlFor="invite_email">Email Address *</Label>
              <Input
                id="invite_email"
                type="email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="user@example.com"
                required
                className="mt-1.5"
              />
            </div>

            <div>
              <Label htmlFor="invite_role">Role *</Label>
              <Select value={inviteRole} onValueChange={setInviteRole}>
                <SelectTrigger className="mt-1.5">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="submitter">Submitter</SelectItem>
                  <SelectItem value="approver">Approver</SelectItem>
                  <SelectItem value="invoicer">Invoicer</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-slate-500 mt-2">
                {inviteRole === "admin" && "Full system access including user management"}
                {inviteRole === "approver" && "Can create quotes and approve/reject submissions"}
                {inviteRole === "invoicer" && "Can review inactive revenue and invoice operations"}
                {inviteRole === "submitter" && "Can create and submit quotes for approval"}
              </p>
            </div>

            <div className="flex gap-3 pt-4">
              <Button 
                type="button" 
                variant="outline" 
                onClick={() => {
                  setShowInviteForm(false);
                  setInviteEmail("");
                  setInviteRole("submitter");
                }}
                className="flex-1"
              >
                Cancel
              </Button>
              <Button 
                type="submit" 
                disabled={inviteMutation.isPending}
                className="flex-1 bg-indigo-600 hover:bg-indigo-700"
              >
                {inviteMutation.isPending ? "Sending..." : "Send Invite"}
              </Button>
            </div>
          </form>
        </SheetContent>
      </Sheet>

      {/* Reset Password Dialog */}
      <Dialog open={showResetPassword} onOpenChange={setShowResetPassword}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reset Password</DialogTitle>
            <DialogDescription>
              Send a password reset email to {resetPasswordUser?.email}?
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <p className="text-sm text-slate-600">
              The user will receive an email with instructions to create a new password. 
              You will not be able to see their password.
            </p>
          </div>
          <DialogFooter>
            <Button 
              variant="outline" 
              onClick={() => {
                setShowResetPassword(false);
                setResetPasswordUser(null);
              }}
            >
              Cancel
            </Button>
            <Button 
              onClick={confirmResetPassword}
              disabled={resetPasswordMutation.isPending}
              className="bg-indigo-600 hover:bg-indigo-700"
            >
              {resetPasswordMutation.isPending ? "Sending..." : "Send Reset Email"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function Users() {
  return (
    <RoleGuard allowedRoles={["admin"]}>
      <UsersContent />
    </RoleGuard>
  );
}