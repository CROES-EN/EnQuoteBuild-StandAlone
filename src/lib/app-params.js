const isNode =
  typeof window === "undefined";

const windowObj = isNode
  ? { localStorage: new Map() }
  : window;

const storage = windowObj.localStorage;

const toSnakeCase = (value) =>
  value
    .replace(/([A-Z])/g, "_$1")
    .toLowerCase();

const getAppParamValue = (
  paramName,
  {
    defaultValue = undefined,
    removeFromUrl = false
  } = {}
) => {
  if (isNode) {
    return defaultValue;
  }

  const storageKey =
    `base44_${toSnakeCase(paramName)}`;

  const urlParams =
    new URLSearchParams(
      window.location.search
    );

  const searchParam =
    urlParams.get(paramName);

  if (removeFromUrl) {
    urlParams.delete(paramName);

    const newUrl =
      `${window.location.pathname}` +
      `${urlParams.toString()
        ? `?${urlParams.toString()}`
        : ""}` +
      `${window.location.hash}`;

    window.history.replaceState(
      {},
      document.title,
      newUrl
    );
  }

  if (searchParam) {
    storage.setItem(
      storageKey,
      searchParam
    );

    return searchParam;
  }

  if (
    defaultValue !== undefined &&
    defaultValue !== null &&
    defaultValue !== ""
  ) {
    storage.setItem(
      storageKey,
      defaultValue
    );

    return defaultValue;
  }

  return storage.getItem(storageKey);
};

const cleanWebUrl = (value) => {
  if (!value) {
    return null;
  }

  const cleaned =
    String(value)
      .trim()
      .replace(/\/+$/, "");

  if (
    !cleaned ||
    cleaned === "null" ||
    /^file:/i.test(cleaned)
  ) {
    return null;
  }

  return cleaned;
};

const getAppBaseUrl = () =>
  cleanWebUrl(
    getAppParamValue("app_base_url")
  ) ||
  cleanWebUrl(
    import.meta.env
      .VITE_BASE44_APP_BASE_URL
  ) ||
  "https://enquote.base44.app";

const getServerUrl = () =>
  cleanWebUrl(
    import.meta.env
      .VITE_BASE44_SERVER_URL
  ) ||
  "https://base44.app";

const getAppParams = () => {
  if (
    getAppParamValue(
      "clear_access_token"
    ) === "true"
  ) {
    storage.removeItem(
      "base44_access_token"
    );

    storage.removeItem("token");
  }

  return {
    appId: getAppParamValue("app_id", {
      defaultValue: import.meta.env.VITE_BASE44_APP_ID || "6979390a3f44099ffca06859"
    }),

    token: getAppParamValue(
      "access_token",
      {
        removeFromUrl: true
      }
    ),

    fromUrl: getAppParamValue(
      "from_url",
      {
        defaultValue:
          isNode
            ? ""
            : window.location.href
      }
    ),

    functionsVersion:
      getAppParamValue(
        "functions_version",
        {
          defaultValue:
            import.meta.env
              .VITE_BASE44_FUNCTIONS_VERSION ||
            "prod"
        }
      ),

    appBaseUrl: getAppBaseUrl(),

    serverUrl: getServerUrl()
  };
};

export const appParams = {
  ...getAppParams()
};