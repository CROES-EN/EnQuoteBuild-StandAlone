import {
  AlertTriangle, Archive, BarChart3, Bell, BookOpen, Briefcase, ClipboardList,
  FileOutput, FileText, Headset, HeartHandshake, LayoutDashboard, Mail,
  MessageSquare, Package, Recycle, Route, Settings, ShoppingCart, Siren,
  Sparkles, Trash2, Users, Wallet
} from "lucide-react";

export const navigationItems = [
  {name: "Dashboard", icon: LayoutDashboard, page: "Dashboard"},
  {name: "Workload", icon: Briefcase, page: "Workload"},
  {name: "Tasks", icon: ClipboardList, page: "Tasks"},
  {name: "Messages", icon: MessageSquare, page: "Messages"},
  {name: "Quotes", icon: FileText, page: "Quotes"},
  {name: "Auto-Drafter", icon: Sparkles, page: "AutoDrafter", badge: "beta"},
  {name: "Products & Services", icon: Package, page: "Products"},
  {name: "Material Orders", icon: ShoppingCart, page: "MaterialOrders"},
  {name: "PV Panel RMA Tracker", icon: Recycle, page: "PVPanelRMAs"},
  {name: "SLA Reporting", icon: BarChart3, page: "SLAReporting"},
  {name: "Users", icon: Users, page: "Users"},
  {name: "Deletion Requests", icon: Trash2, page: "QuoteDeletionRequests"},
  {name: "Email Notifications", icon: Mail, page: "EmailNotifications"},
  {name: "Follow-Up Settings", icon: Bell, page: "FollowUpSettings"},
  {name: "PDF Template", icon: FileOutput, page: "PDFTemplateSettings"},
  {name: "Boneyard", icon: Archive, page: "Boneyard"},
  {name: "SV Cancel Tracker", icon: AlertTriangle, page: "SVCancelTracker"},
  {name: "Resource Planner", icon: Route, page: "ResourcePlanner"},
  {name: "SOP Library", icon: BookOpen, page: "SOPLibrary"},
  {name: "Site Flags", icon: Siren, page: "SiteFlagManager"},
  {name: "Rejection Reviews", icon: AlertTriangle, page: "RejectedQuoteReview"},
  {name: "Supervisor Dashboard", icon: Headset, page: "SupervisorDashboard"},
  {name: "Enphase Care", icon: HeartHandshake, page: "EnphaseCare"},
  {name: "Inactive Revenue", icon: Wallet, page: "InactiveRevenueDashboard"},
  {name: "Settings", icon: Settings, page: "Settings"}
];
