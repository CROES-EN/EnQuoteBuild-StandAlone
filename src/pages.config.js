/**
 * pages.config.js - Page routing configuration
 * 
 * This file is AUTO-GENERATED. Do not add imports or modify PAGES manually.
 * Pages are auto-registered when you create files in the ./pages/ folder.
 * 
 * THE ONLY EDITABLE VALUE: mainPage
 * This controls which page is the landing page (shown when users visit the app).
 * 
 * Example file structure:
 * 
 *   import HomePage from './pages/HomePage';
 *   import {lazyPage} from './lib/lazyPage';
import Dashboard from './pages/Dashboard';
 *   import Settings from './pages/Settings';
 *   
 *   export const PAGES = {
 *       "HomePage": HomePage,
 *       "Dashboard": Dashboard,
 *       "Settings": Settings,
 *   }
 *   
 *   export const pagesConfig = {
 *       mainPage: "HomePage",
 *       Pages: PAGES,
 *   };
 * 
 * Example with Layout (wraps all pages):
 *
 *   import Home from './pages/Home';
 *   import Settings from './pages/Settings';
 *   import __Layout from './Layout.jsx';
 *
 *   export const PAGES = {
 *       "Home": Home,
 *       "Settings": Settings,
 *   }
 *
 *   export const pagesConfig = {
 *       mainPage: "Home",
 *       Pages: PAGES,
 *       Layout: __Layout,
 *   };
 *
 * To change the main page from HomePage to Dashboard, use find_replace:
 *   Old: mainPage: "HomePage",
 *   New: mainPage: "Dashboard",
 *
 * The mainPage value must match a key in the PAGES object exactly.
 */
import {lazyPage} from './lib/lazyPage';
import Dashboard from './pages/Dashboard';
import __Layout from './Layout.jsx';

const CreateQuote = lazyPage(() => import('./pages/CreateQuote'));
const EditQuote = lazyPage(() => import('./pages/EditQuote'));
const EmailNotifications = lazyPage(() => import('./pages/EmailNotifications'));
const FollowUpSettings = lazyPage(() => import('./pages/FollowUpSettings'));
const MaterialOrders = lazyPage(() => import('./pages/MaterialOrders'));
const PDFTemplateSettings = lazyPage(() => import('./pages/PDFTemplateSettings'));
const Products = lazyPage(() => import('./pages/Products'));
const QuoteDeletionRequests = lazyPage(() => import('./pages/QuoteDeletionRequests'));
const QuoteDetails = lazyPage(() => import('./pages/QuoteDetails'));
const Quotes = lazyPage(() => import('./pages/Quotes'));
const RevenueAnalytics = lazyPage(() => import('./pages/RevenueAnalytics'));
const SLAReporting = lazyPage(() => import('./pages/SLAReporting'));
const Users = lazyPage(() => import('./pages/Users'));
const QuoteOverview = lazyPage(() => import('./pages/QuoteOverview'));


export const PAGES = {
    "CreateQuote": CreateQuote,
    "Dashboard": Dashboard,
    "EditQuote": EditQuote,
    "EmailNotifications": EmailNotifications,
    "FollowUpSettings": FollowUpSettings,
    "MaterialOrders": MaterialOrders,
    "PDFTemplateSettings": PDFTemplateSettings,
    "Products": Products,
    "QuoteDeletionRequests": QuoteDeletionRequests,
    "QuoteDetails": QuoteDetails,
    "Quotes": Quotes,
    "RevenueAnalytics": RevenueAnalytics,
    "SLAReporting": SLAReporting,
    "Users": Users,
    "QuoteOverview": QuoteOverview,
}

export const pagesConfig = {
    mainPage: "Dashboard",
    Pages: PAGES,
    Layout: __Layout,
};