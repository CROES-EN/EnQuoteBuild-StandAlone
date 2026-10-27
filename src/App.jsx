import {Suspense} from "react";
import {HashRouter, Navigate, Route, Routes} from "react-router-dom";

import {Toaster} from "@/components/ui/toaster";
import {Toaster as SonnerToaster} from "@/components/ui/sonner";
import {QueryClientProvider} from "@tanstack/react-query";
import {queryClientInstance} from "@/lib/query-client";
import NavigationTracker from "@/lib/NavigationTracker";
import {pagesConfig} from "./pages.config";
import ErrorBoundary from "@/components/ErrorBoundary";
import FindBar from "@/components/FindBar";

import PageNotFound from "./lib/PageNotFound";
import {lazyPage} from "./lib/lazyPage";

import MessagesPage from "./pages/Messages";
import ChatDock from "@/components/messages/ChatDock";
import AppLinkSharing from "@/components/messages/AppLinkSharing";
import SecretRetroShortcut from "@/features/Base44_DTO/Shortcut";

import AuthProvider, {useAuth} from "@/lib/AuthContext";
import UserNotRegisteredError from "@/components/UserNotRegisteredError";
import {ThemeProvider} from "@/features/theme/ThemeContext";
import {AccessPreviewProvider} from "@/features/admin/AccessPreviewContext";
import {isReadonlyViewing} from "@/features/admin/readonlyViewing";
import ViewingBanner from "@/features/admin/ViewingBanner";

const SVCancelTrackerPage = lazyPage(() => import("./pages/SVCancelTracker"));
const RejectedQuoteReviewPage = lazyPage(() => import("./pages/RejectedQuoteReview"));
const SupervisorDashboardPage = lazyPage(() => import("./pages/SupervisorDashboard"));
const BoneyardPage = lazyPage(() => import("./pages/Boneyard"));
const ResourcePlannerPage = lazyPage(() => import("./pages/ResourcePlanner"));
const SiteFlagManagerPage = lazyPage(() => import("./pages/SiteFlagManager"));
const PVPanelRMAsPage = lazyPage(() => import("./pages/PVPanelRMAs"));
const InactiveRevenueDashboardPage = lazyPage(() => import("./pages/InactiveRevenueDashboard"));
const InactiveCollectionsPage = lazyPage(() => import("./pages/InactiveCollections"));
const WorkloadPage = lazyPage(() => import("./pages/Workload"));
const EnphaseCarePage = lazyPage(() => import("./pages/EnphaseCare"));
const TasksPage = lazyPage(() => import("./pages/Tasks"));
const SOPLibraryPage = lazyPage(() => import("./pages/SOPLibrary"));
const SettingsPage = lazyPage(() => import("./pages/Settings"));
const AutoDrafterPage = lazyPage(() => import("./pages/AutoDrafter"), "AutoDrafter");
const Base44_DTO = lazyPage(() => import("@/features/Base44_DTO/Base44_DTO"));

const { Pages, Layout, mainPage } = pagesConfig;
const mainPageKey = mainPage ?? Object.keys(Pages)[0];
const MainPage = mainPageKey ? Pages[mainPageKey] : <></>;

const PageFallback = () => (
  <div className="flex min-h-[40vh] items-center justify-center" role="status" aria-label="Loading page">
    <div className="h-8 w-8 animate-spin rounded-full border-4 border-border border-t-slate-800" />
  </div>
);

const LayoutWrapper = ({ children, currentPageName }) => {
  const page = <Suspense fallback={<PageFallback />}>{children}</Suspense>;
  return Layout ? <Layout currentPageName={currentPageName}>{page}</Layout> : page;
};

const AuthenticatedApp = () => {
  const { isLoadingAuth, isLoadingPublicSettings, authError, navigateToLogin } = useAuth();

  // Show loading spinner while checking app public settings or auth
  if (isLoadingPublicSettings || isLoadingAuth) {
    return (
      <div className="fixed inset-0 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-border border-t-slate-800 rounded-full animate-spin"></div>
      </div>
    );
  }

  // Handle authentication errors
  if (authError) {
    if (authError.type === 'user_not_registered') {
      return <UserNotRegisteredError />;
    } else if (authError.type === 'auth_required') {
      // Redirect to login automatically
      navigateToLogin();
      return null;
    }
  }


  // Render the main app
  return (
    <>
    <ViewingBanner />
    <Routes>
      <Route path="/" element={
        <LayoutWrapper currentPageName={mainPageKey}>
          <MainPage />
        </LayoutWrapper>
      } />
      {Object.entries(Pages).map(([path, Page]) => (
        <Route
          key={path}
          path={`/${path}`}
          element={
            <LayoutWrapper currentPageName={path}>
              <Page />
            </LayoutWrapper>
          }
        />
      ))}
      <Route path="/Boneyard" element={
        <LayoutWrapper currentPageName="Boneyard">
          <BoneyardPage />
        </LayoutWrapper>
      } />
      <Route path="/SVCancelTracker" element={
        <LayoutWrapper currentPageName="SVCancelTracker">
          <SVCancelTrackerPage />
        </LayoutWrapper>
      } />
      <Route path="/ResourcePlanner" element={
        <LayoutWrapper currentPageName="ResourcePlanner">
          <ResourcePlannerPage />
        </LayoutWrapper>
      } />
      <Route path="/SiteFlagManager" element={
        <LayoutWrapper currentPageName="SiteFlagManager">
          <SiteFlagManagerPage />
        </LayoutWrapper>
      } />
      <Route path="/RejectedQuoteReview" element={
        <LayoutWrapper currentPageName="RejectedQuoteReview">
          <RejectedQuoteReviewPage />
        </LayoutWrapper>
      } />
      <Route path="/PVPanelRMAs" element={
        <LayoutWrapper currentPageName="PVPanelRMAs">
          <PVPanelRMAsPage />
        </LayoutWrapper>
      } />
      <Route path="/ManagerDashboard" element={
        <Navigate to="/SupervisorDashboard?tab=quote-dashboard" replace />
      } />
      <Route path="/QuoteDashboard" element={
        <Navigate to="/SupervisorDashboard?tab=quote-dashboard" replace />
      } />
      <Route path="/SupervisorDashboard" element={
        <LayoutWrapper currentPageName="SupervisorDashboard">
          <SupervisorDashboardPage />
        </LayoutWrapper>
      } />      <Route path="/EnphaseCare" element={
        <LayoutWrapper currentPageName="EnphaseCare">
          <EnphaseCarePage />
        </LayoutWrapper>
      } />
      <Route path="/Workload" element={
        <LayoutWrapper currentPageName="Workload">
          <WorkloadPage />
        </LayoutWrapper>
      } />
      <Route path="/InactiveRevenueDashboard" element={
        <LayoutWrapper currentPageName="InactiveRevenueDashboard">
          <InactiveRevenueDashboardPage />
        </LayoutWrapper>
      } />
      <Route path="/InactiveCollections" element={
        <LayoutWrapper currentPageName="InactiveRevenueDashboard">
          <InactiveCollectionsPage />
        </LayoutWrapper>
      } />
      <Route path="/AutoDrafter" element={
        <LayoutWrapper currentPageName="AutoDrafter">
          <AutoDrafterPage />
        </LayoutWrapper>
      } />
      <Route path="/Tasks" element={
        <LayoutWrapper currentPageName="Tasks">
          <TasksPage />
        </LayoutWrapper>
      } />
      <Route path="/SOPLibrary" element={
        <LayoutWrapper currentPageName="SOPLibrary">
          <SOPLibraryPage />
        </LayoutWrapper>
      } />
      <Route path="/Messages" element={
        <LayoutWrapper currentPageName="Messages">
          <MessagesPage />
        </LayoutWrapper>
      } />
      <Route path="/Settings" element={
        <LayoutWrapper currentPageName="Settings">
          <SettingsPage />
        </LayoutWrapper>
      } />
      <Route path="/Base44_DTO" element={<LayoutWrapper currentPageName="Base44_DTO"><Base44_DTO /></LayoutWrapper>} />
      <Route path="*" element={<PageNotFound />} />
    </Routes>
    {!isReadonlyViewing() && <ChatDock />}
    {!isReadonlyViewing() && <AppLinkSharing />}
    </>
  );
};


function App() {

  return (
    <ThemeProvider>
    <ErrorBoundary>
      <AuthProvider>
        <QueryClientProvider client={queryClientInstance}>
          <HashRouter>
            <AccessPreviewProvider>
            {!isReadonlyViewing() && <NavigationTracker />}
            {!isReadonlyViewing() && <SecretRetroShortcut />}
            <AuthenticatedApp />
            </AccessPreviewProvider>
          </HashRouter>
          <Toaster />
          <SonnerToaster position="top-right" richColors />
          <FindBar />
        </QueryClientProvider>
      </AuthProvider>
    </ErrorBoundary>
    </ThemeProvider>
  )
}

export default App
