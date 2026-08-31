import { createClient } from "@base44/sdk";
import { appParams } from "@/lib/app-params";

const isBase44Runtime =
  ["base44", "base44-dual"].includes(import.meta.env.VITE_DATA_SOURCE);

const {
  appId,
  token,
  functionsVersion,
  appBaseUrl,
  serverUrl
} = appParams;

const isValidBase44ClientConfig =
  Boolean(
    appId &&
    serverUrl &&
    !/^file:/i.test(String(serverUrl))
  );

const noop = () =>
  Promise.resolve(undefined);

const noopObject = {
  me: noop,
  logout: noop,
  redirectToLogin: noop,
  getToken: noop,
  setToken: noop,
  clearToken: noop
};

const emptyAppLogs = {
  logUserInApp: noop,
  logEvent: noop,
  track: noop
};

const base44Client =
  isBase44Runtime &&
  isValidBase44ClientConfig
    ? createClient({
        appId,
        token,
        functionsVersion,
        serverUrl,
        appBaseUrl,
        requiresAuth: false
      })
    : {
        auth: noopObject,
        appLogs: emptyAppLogs,
        functions: {
          invoke: noop
        }
      };

export const base44 = base44Client;

