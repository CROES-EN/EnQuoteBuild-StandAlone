import { Link, useLocation } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { cn } from "@/lib/utils";
import { 
  LayoutDashboard, 
  FileText, 
  Package,
  Users,
  Menu,
  X,
  Mail,
  Bell,
  FileOutput,
  Trash2,
  ShoppingCart,
  BarChart3,
  AlertTriangle,
  Route,
  Siren,
  Archive,
  LineChart,
  Recycle,
  Wallet
} from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useUserRole } from "@/components/auth/RoleGuard";
import AutoAssignRole from "@/components/auth/AutoAssignRole";

const isDemoMode = ["mock", "local", "salesforce-mock"].includes(import.meta.env.VITE_DATA_SOURCE);

export default function Layout({ children, currentPageName }) {
  const { isAdmin, roles } = useUserRole();

  const navItems = [
    { name: "Dashboard", icon: LayoutDashboard, page: "Dashboard", roles: ["submitter", "approver", "admin"] },
    { name: "Quotes", icon: FileText, page: "Quotes", roles: ["submitter", "approver", "admin"] },
    { name: "Products & Services", icon: Package, page: "Products", roles: ["submitter", "approver", "admin"] },
    { name: "Material Orders", icon: ShoppingCart, page: "MaterialOrders", roles: ["submitter", "approver", "admin"] },
    { name: "PV Panel RMA Tracker", icon: Recycle, page: "PVPanelRMAs", roles: ["submitter", "approver", "admin"] },
    { name: "SLA Reporting", icon: BarChart3, page: "SLAReporting", roles: ["submitter", "approver", "admin"] },
    { name: "Users", icon: Users, page: "Users", roles: ["admin"] },
    { name: "Deletion Requests", icon: Trash2, page: "QuoteDeletionRequests", roles: ["admin"] },
    { name: "Email Notifications", icon: Mail, page: "EmailNotifications", roles: ["admin"] },
    { name: "Follow-Up Settings", icon: Bell, page: "FollowUpSettings", roles: ["admin"] },
    { name: "PDF Template", icon: FileOutput, page: "PDFTemplateSettings", roles: ["admin"] },
    { name: "Boneyard", icon: Archive, page: "Boneyard", roles: ["submitter", "approver", "admin"] },
    { name: "SV Cancel Tracker", icon: AlertTriangle, page: "SVCancelTracker", roles: ["submitter", "approver", "admin"] },
    { name: "Resource Planner", icon: Route, page: "ResourcePlanner", roles: ["submitter", "approver", "admin"] },
    { name: "Site Flags", icon: Siren, page: "SiteFlagManager", roles: ["submitter", "approver", "admin"] },
    { name: "Rejection Reviews", icon: AlertTriangle, page: "RejectedQuoteReview", roles: ["approver", "admin"] },
    { name: "Manager Dashboard", icon: LineChart, page: "ManagerDashboard", roles: ["admin", "submitter", "approver"] },
    { name: "Inactive Revenue", icon: Wallet, page: "InactiveRevenueDashboard", roles: ["admin", "approver", "invoicer"] }
  ];
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:fixed lg:inset-y-0 lg:flex lg:w-64 lg:flex-col">
        <div className="flex flex-col h-full bg-white border-r border-slate-200 overflow-hidden">
          {/* Logo */}
          <div className="h-16 flex items-center px-6 border-b border-slate-100">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-orange-500 to-orange-600 flex items-center justify-center shadow-lg shadow-orange-200">
                <FileText className="w-5 h-5 text-white" />
              </div>
              <span className="text-xl font-bold text-slate-900">ENquote</span>
            </div>
          </div>
          {isDemoMode && <div className="border-b border-amber-200 bg-amber-50 px-6 py-3 text-xs text-amber-800">EnQuote Desktop Proof of Concept<br />Data Source: Local Demonstration Data<br />No Production Customer Data</div>}

          {/* Navigation */}
          <nav className="flex-1 px-4 py-6 space-y-1 overflow-y-auto min-h-0">
            {navItems.filter(item => !item.roles || isAdmin || item.roles.some(itemRole => roles.includes(itemRole))).map((item) => {
              const isActive = currentPageName === item.page;
              return (
                <Link
                  key={item.page}
                  to={createPageUrl(item.page)}
                  className={cn(
                    "flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all",
                    isActive 
                      ? "bg-orange-50 text-orange-700" 
                      : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                  )}
                >
                  <item.icon className={cn("w-5 h-5", isActive ? "text-orange-600" : "text-slate-400")} />
                  {item.name}
                </Link>
              );
            })}
          </nav>

          {/* Footer */}
          <div className="p-4 border-t border-slate-100">
            <div className="px-4 py-3 rounded-xl bg-gradient-to-br from-slate-50 to-slate-100">
              <p className="text-xs text-slate-500">Quote Management</p>
              <p className="text-sm font-medium text-slate-700 mt-0.5">v1.0.0</p>
            </div>
          </div>
        </div>
      </aside>

      {/* Mobile Header */}
      <div className="lg:hidden fixed top-0 left-0 right-0 z-50 h-16 bg-white border-b border-slate-200 flex items-center justify-between px-4">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-orange-500 to-orange-600 flex items-center justify-center">
            <FileText className="w-5 h-5 text-white" />
          </div>
          <span className="text-xl font-bold text-slate-900">ENquote</span>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
        >
          {mobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
        </Button>
      </div>

      {/* Mobile Menu */}
      {mobileMenuOpen && (
        <div className="lg:hidden fixed inset-0 z-40 bg-white pt-16">
          <nav className="p-4 space-y-1">
            {navItems.filter(item => !item.roles || isAdmin || item.roles.some(itemRole => roles.includes(itemRole))).map((item) => {
              const isActive = currentPageName === item.page;
              return (
                <Link
                  key={item.page}
                  to={createPageUrl(item.page)}
                  onClick={() => setMobileMenuOpen(false)}
                  className={cn(
                    "flex items-center gap-3 px-4 py-4 rounded-xl text-base font-medium transition-all",
                    isActive 
                      ? "bg-orange-50 text-orange-700" 
                      : "text-slate-600 hover:bg-slate-50"
                  )}
                >
                  <item.icon className={cn("w-5 h-5", isActive ? "text-orange-600" : "text-slate-400")} />
                  {item.name}
                </Link>
              );
            })}
          </nav>
        </div>
      )}

      {/* Main Content */}
      <main className="lg:pl-64 pt-16 lg:pt-0">
        <AutoAssignRole>
          {children}
        </AutoAssignRole>
      </main>
    </div>
  );
}
