import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Mail, Briefcase, Pencil, Shield, ShieldCheck, ShieldAlert, MoreVertical, KeyRound } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

const roleConfig = {
  submitter: {
    icon: Shield,
    color: "bg-blue-50 text-blue-700 border-blue-200",
    iconColor: "text-blue-600",
    bgColor: "bg-blue-100"
  },
  approver: {
    icon: ShieldCheck,
    color: "bg-emerald-50 text-emerald-700 border-emerald-200",
    iconColor: "text-emerald-600",
    bgColor: "bg-emerald-100"
  },
  invoicer: {
    icon: ShieldCheck,
    color: "bg-amber-50 text-amber-700 border-amber-200",
    iconColor: "text-amber-600",
    bgColor: "bg-amber-100"
  },
  admin: {
    icon: ShieldAlert,
    color: "bg-violet-50 text-violet-700 border-violet-200",
    iconColor: "text-violet-600",
    bgColor: "bg-violet-100"
  }
};

export default function UserCard({ user, onEdit, onResetPassword, index = 0, currentUserEmail }) {
  const config = roleConfig[user.app_role] || roleConfig.submitter;
  const RoleIcon = config.icon;
  const isCurrentUser = user.email === currentUserEmail;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05 }}
    >
      <Card className="p-5 border-slate-200 hover:shadow-md transition-all">
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-3">
            <div className={cn("w-10 h-10 rounded-full flex items-center justify-center", config.bgColor)}>
              <RoleIcon className={cn("w-5 h-5", config.iconColor)} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-semibold text-slate-900">{user.display_name || user.full_name || "No name"}</h3>
                {isCurrentUser && (
                  <Badge variant="outline" className="text-xs">You</Badge>
                )}
              </div>
              <p className="text-sm text-slate-500">{user.email}</p>
            </div>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-slate-400 hover:text-indigo-600"
              >
                <MoreVertical className="w-4 h-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => onEdit(user)}>
                <Pencil className="w-4 h-4 mr-2" />
                Edit User
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onResetPassword(user)}>
                <KeyRound className="w-4 h-4 mr-2" />
                Reset Password
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div className="space-y-2">
          <div className="flex items-center gap-2">
            {[user.app_role, ...(user.additional_roles || [])].filter(Boolean).map(role => <Badge key={role} className={cn("border", (roleConfig[role] || config).color)}>{role.charAt(0).toUpperCase() + role.slice(1)}</Badge>) }
            {user.department && (
              <div className="flex items-center gap-1 text-sm text-slate-600">
                <Briefcase className="w-3 h-3" />
                {user.department}
              </div>
            )}
          </div>
        </div>
      </Card>
    </motion.div>
  );
}