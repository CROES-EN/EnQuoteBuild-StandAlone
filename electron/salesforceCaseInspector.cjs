// Runs read-only inside the Salesforce view. Keep it self-contained for executeJavaScript.
function inspectSalesforceCase() {
  const normalize = value => String(value || "").replace(/\s+/g, " ").trim();
  const parent = element => element.parentElement || element.getRootNode()?.host || null;
  function visible(element) {
    for (let current = element; current; current = parent(current)) {
      const style = getComputedStyle(current);
      if (current.hidden || current.getAttribute("aria-hidden") === "true" ||
          style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse") return false;
    }
    if (element.getClientRects().length) return true;
    const range = element.ownerDocument.createRange();
    range.selectNodeContents(element);
    return Boolean(range.getClientRects().length ||
      descendants(element.shadowRoot || element, "*").some(child => child.getClientRects().length && visible(child)));
  }
  function descendants(root, selector) {
    const found = [...root.querySelectorAll(selector)];
    for (const element of root.querySelectorAll("*")) {
      if (element.shadowRoot) found.push(...descendants(element.shadowRoot, selector));
    }
    return found;
  }
  const aliases = new Map([
    ["contact name", "contactName"], ["case number", "caseNumber"],
    ["enlighten site id", "siteId"], ["site id", "siteId"]
  ]);
  function contains(root, element) {
    for (let current = element; current; current = parent(current)) if (current === root) return true;
    return false;
  }
  function text(element) {
    if (element.matches("button, [role='button']:not(a), .slds-assistive-text, .assistiveText") || !visible(element)) return "";
    if (element.matches("slot")) {
      const assigned = element.assignedNodes({flatten: true});
      if (assigned.length) return normalize(assigned.map(node => node.nodeType === 3 ? node.textContent
        : node.nodeType === 1 ? text(node) : "").join(" "));
    }
    const root = element.shadowRoot || element;
    return normalize([...root.childNodes].map(node => node.nodeType === 3 ? node.textContent
      : node.nodeType === 1 ? text(node) : "").join(" "));
  }
  const labelSelector = ".test-id__field-label, .slds-form-element__label, .test-id__field-label-container, dt, span, label, p";
  const keyFor = label => aliases.get(text(label).replace(/\s*[:·•]$/, "").toLowerCase());
  const recordSelector = "records-record-layout-block, lightning-record-view-form, .forceRecordLayout, .record-layout-container, .oneRecordHomeFlexipage, .recordHomeFlexipage2, flexipage-record-home, [role='tabpanel']";
  const fieldSelector = ".slds-form-element, .test-id__output-root, .forcePageBlockItem, records-record-layout-item, records-record-layout-base-input";
  const recordId = location.pathname.match(/^\/lightning\/r\/Case\/(500[a-zA-Z0-9]{12}(?:[a-zA-Z0-9]{3})?)\/view\/?$/)?.[1] || "";
  let searchPage = /^\/lightning\/page\/search(?:\/|$)/.test(location.pathname);
  if (location.pathname === "/one/one.app" && location.hash) {
    try {
      const state = JSON.parse(atob(decodeURIComponent(location.hash.slice(1))));
      searchPage = state?.componentDef === "forceSearch:searchPageDesktop";
    } catch {
      // Other Salesforce one.app fragments are not necessarily encoded search state.
    }
  }
  if (searchPage) throw new Error("Open the case from the search results, then use Read Salesforce case. The search results page cannot be used to prepare a quote.");
  const roots = descendants(document, "*");
  const labels = descendants(document, labelSelector).filter(label => visible(label) && keyFor(label));
  const panels = roots.filter(element => element.matches("[role='tab'][aria-selected='true'][aria-controls]") && visible(element))
    .flatMap(tab => {
      const ids = tab.getAttribute("aria-controls").split(/\s+/);
      return roots.filter(element => ids.includes(element.id) && visible(element) && labels.some(label => contains(element, label)));
    });
  // A selected console panel is more authoritative than a stale URL during a same-URL tab switch.
  let recordRoots = panels.length ? panels : recordId ? roots.filter(element =>
    [element.getAttribute("data-recordid"), element.getAttribute("data-record-id")].includes(recordId) &&
      visible(element) && labels.some(label => contains(element, label))) : [];
  if (!recordRoots.length && recordId) recordRoots = roots.filter(element => element.matches("main, [role='main']") &&
    visible(element) && labels.some(label => contains(element, label)));
  const inRecord = element => !recordRoots.length || recordRoots.some(root => contains(root, element));
  const fields = [];
  let caseLabels = 0;
  for (const label of labels.filter(inRecord)) {
    const key = keyFor(label);
    if (!key || !visible(label)) continue;
    if (key === "caseNumber") caseLabels++;
    let field = parent(label);
    let depth = 0;
    while (field && !field.matches(recordSelector) && depth++ < 6) {
      if (labels.some(other => contains(field, other) && keyFor(other) !== key)) break;
      if (field.matches(fieldSelector) || recordId || recordRoots.length) {
        const candidates = descendants(field,
          "lightning-formatted-text, lightning-formatted-url, lightning-formatted-name, [data-output-element-id='output-field'], .test-id__field-value, .slds-form-element__static, a[href]")
          .filter(element => visible(element) && !contains(element, label));
        // Prefer the actual output/link, not wrappers containing edit/preview button text.
        const values = [...new Set(candidates
          .filter(element => !candidates.some(other => other !== element && contains(element, other)))
          .map(text).filter(value => value && !/^(--|—|-)$/.test(value)))];
        if (values.length) {
          if (values.length === 1) fields.push({key, value: values[0], field});
          break;
        }
        // Some Lightning layouts render a plain span/div output instead of a formatted component.
        const valueNodes = [...field.childNodes].flatMap(node => {
          if (node.nodeType === 3) return [normalize(node.textContent)];
          if (node.nodeType !== 1 || contains(node, label) || !visible(node)) return [];
          return [text(node)];
        }).filter(value => value && value !== text(label) && !/^(--|—|-|Edit|Preview)$/i.test(value));
        const plainValues = [...new Set(valueNodes)];
        if (plainValues.length === 1 && (key === "contactName" || /^\d+$/.test(plainValues[0]))) {
          fields.push({key, value: plainValues[0], field});
          break;
        }
      }
      field = parent(field);
    }
  }
  const cases = [...new Set(fields.filter(field => field.key === "caseNumber").map(field => field.value))];
  if (cases.length !== 1 || !/^\d+$/.test(cases[0])) {
    throw new Error(cases.length > 1
      ? "Multiple visible Salesforce cases were found. Select one case's Details tab and retry."
      : caseLabels ? "The case is open, but its labeled Case Number value is not readable yet. Waiting for Salesforce case details; manual quote selection is available."
        : "Open the case from the search results, then use Read Salesforce case. The search results page cannot be used to prepare a quote.");
  }
  // Never take a contact from an unrelated sidebar, email recipient, or another record.
  const groups = [];
  for (const caseField of fields.filter(field => field.key === "caseNumber")) {
    let scope = parent(caseField.field);
    while (scope) {
      if (scope.matches(recordSelector)) groups.push(fields.filter(field => contains(scope, field.field)));
      scope = parent(scope);
    }
    for (const root of recordRoots) groups.push(fields.filter(field => contains(root, field.field)));
  }
  if (!groups.length) throw new Error("Could not identify the Salesforce case detail section. Use quote selection/manual name instead.");
  // The Site Status card is a separate component, not a standard record-layout field.
  const scopes = [...recordRoots];
  for (const caseField of fields.filter(field => field.key === "caseNumber")) {
    for (let scope = parent(caseField.field); scope; scope = parent(scope)) {
      if (scope.matches(recordSelector)) scopes.push(scope);
    }
  }
  for (const label of descendants(document, "span, dt")) {
    if (!visible(label) || !/^site id\s*[:·•]?$/i.test(text(label)) ||
        !scopes.some(scope => contains(scope, label))) continue;
    const row = parent(label);
    if (!row) continue;
    const values = [...new Set(descendants(row, "a[href], lightning-formatted-text")
      .filter(visible).map(text).filter(value => /^\d+$/.test(value)))];
    if (values.length === 1) groups.push([{key: "siteId", value: values[0], field: row}]);
  }
  const valuesFor = key => [...new Set(groups.flat().filter(field => field.key === key).map(field => field.value))];
  const contacts = valuesFor("contactName"), sites = valuesFor("siteId");
  if (contacts.length > 1 || sites.length > 1) throw new Error("Conflicting Salesforce contact or site fields were found. Use manual selection or show only one case.");
  if (sites.length && !/^\d+$/.test(sites[0])) throw new Error("The visible Salesforce Site ID is not a whole number.");
  return {caseNumber: cases[0], siteId: sites[0] || "", contactName: contacts[0] || ""};
}

module.exports = {inspectSalesforceCase};
