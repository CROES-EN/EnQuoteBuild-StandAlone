import {
  HashRouter,
  Routes,
  Route
} from "react-router-dom";

import { Toaster } from "@/components/ui/toaster";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClientInstance } from "@/lib/query-client";
import NavigationTracker from "@/lib/NavigationTracker";
import { pagesConfig } from "./pages.config";

import PageNotFound from "./lib/PageNotFound";

import SVCancelTrackerPage from "./pages/SVCancelTracker";
import RejectedQuoteReviewPage from "./pages/RejectedQuoteReview";
import ManagerDashboardPage from "./pages/ManagerDashboard";
import BoneyardPage from "./pages/Boneyard";
import ResourcePlannerPage from "./pages/ResourcePlanner";
import SiteFlagManagerPage from "./pages/SiteFlagManager";
import PVPanelRMAsPage from "./pages/PVPanelRMAs";
import InactiveRevenueDashboardPage from "./pages/InactiveRevenueDashboard";
import InactiveCollectionsPage from "./pages/InactiveCollections";

import { AuthProvider, useAuth } from "@/lib/AuthContext";
import UserNotRegisteredError from "@/components/UserNotRegisteredError";

const { Pages, Layout, mainPage } = pagesConfig;
const mainPageKey = mainPage ?? Object.keys(Pages)[0];
const MainPage = mainPageKey ? Pages[mainPageKey] : <></>;

const LayoutWrapper = ({ children, currentPageName }) => Layout ?
  <Layout currentPageName={currentPageName}>{children}</Layout>
  : <>{children}</>;

const AuthenticatedApp = () => {
  const { isLoadingAuth, isLoadingPublicSettings, authError, navigateToLogin } = useAuth();

  // Show loading spinner while checking app public settings or auth
  if (isLoadingPublicSettings || isLoadingAuth) {
    return (
      <div className="fixed inset-0 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin"></div>
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
        <LayoutWrapper currentPageName="ManagerDashboard">
          <ManagerDashboardPage />
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
      <Route path="*" element={<PageNotFound />} />
    </Routes>
  );
};


function App() {

  return (
    <AuthProvider>
      <QueryClientProvider client={queryClientInstance}>
        <HashRouter>
          <NavigationTracker />
          <AuthenticatedApp />
        </HashRouter>
        <Toaster />
      </QueryClientProvider>
    </AuthProvider>
  )
}

export default App