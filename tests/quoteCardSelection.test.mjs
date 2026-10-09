import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import {createRequire} from "node:module";
import {build} from "esbuild";

const require = createRequire(import.meta.url);

async function loadQuoteCard() {
  let navigate;
  const mocks = {
    "@/components/ui/card": {Card: "article"},
    "date-fns": {format: (date) => String(date)},
    "lucide-react": {
      Calendar: "calendar",
      FileText: "file-text",
      ShieldCheck: "shield",
      User: "user"
    },
    "react-router-dom": {useNavigate: () => navigate},
    "@/utils": {createPageUrl: (url) => `/${url}`},
    "@/utils/quoteCalculations": {calculateQuoteTotals: () => ({total: 100})},
    "@/utils/quoteSLA": {getEffectiveLevel: () => null},
    "./StatusBadge": {default: "status-badge"},
    "./AlertBadge": {MentionBadge: "mention-badge", SLAAlertBadge: "sla-badge"},
    "framer-motion": {motion: {div: "motion-div"}},
    "@/components/ui/checkbox": {Checkbox: "checkbox"},
    "@/features/supervisorDashboard/careEligibilityCache": {useCareEligibilityIndex: () => null},
    "@/features/supervisorDashboard/careEligibility": {getEligibilityFromIndex: () => null},
    "@/components/links/ExternalIdLinks": {SiteIdLink: "site-link"}
  };
  const output = await build({
    entryPoints: [path.join("src", "components", "quotes", "QuoteCard.jsx")],
    bundle: true,
    write: false,
    platform: "node",
    format: "cjs",
    packages: "external",
    jsx: "automatic",
    alias: {"@": path.resolve("src")},
    plugins: [{
      name: "quote-card-mocks",
      setup(builder) {
        builder.onResolve({filter: /.*/}, (args) =>
          Object.hasOwn(mocks, args.path) ? {path: args.path, external: true} : null
        );
      }
    }]
  });
  const module = {exports: {}};
  new Function("require", "module", "exports", output.outputFiles[0].text)(
    (name) => mocks[name] || require(name),
    module,
    module.exports
  );
  return {
    QuoteCard: module.exports.default,
    setNavigate: (fn) => { navigate = fn; }
  };
}

const quote = {id: "q-1", site_id: "S-1", status: "invoiced", items: []};
const noInteractiveTarget = {closest: () => null};

function findElement(element, type) {
  if (!element || typeof element !== "object") return null;
  if (element.type === type) return element;
  const children = element.props?.children;
  for (const child of Array.isArray(children) ? children : [children]) {
    const found = findElement(child, type);
    if (found) return found;
  }
  return null;
}

test("clicking a quote card in selection mode selects it without navigating", async () => {
  const {QuoteCard, setNavigate} = await loadQuoteCard();
  const selected = [];
  const navigated = [];
  setNavigate((url) => navigated.push(url));
  const card = QuoteCard({quote, selectable: true, onToggleSelect: (id) => selected.push(id)});
  const wrapper = card.props.children;
  const clickHandler = wrapper.props.onClick;
  clickHandler({target: {closest: () => wrapper}, currentTarget: wrapper});
  assert.deepEqual(selected, ["q-1"]);
  assert.deepEqual(navigated, []);
  assert.equal(wrapper.props.role, "checkbox");
  assert.equal(wrapper.props["aria-checked"], false);
  const checkbox = findElement(card, "checkbox");
  let propagationStopped = false;
  checkbox.props.onClick({stopPropagation: () => { propagationStopped = true; }});
  checkbox.props.onCheckedChange();
  assert.equal(propagationStopped, true);
  assert.deepEqual(selected, ["q-1", "q-1"]);
});

test("clicking or pressing Enter on a quote card outside selection mode navigates", async () => {
  const {QuoteCard, setNavigate} = await loadQuoteCard();
  const navigated = [];
  setNavigate((url) => navigated.push(url));
  const card = QuoteCard({quote});
  const wrapper = card.props.children;
  wrapper.props.onClick({target: noInteractiveTarget});
  wrapper.props.onKeyDown({key: "Enter", target: noInteractiveTarget, preventDefault() {}});
  assert.deepEqual(navigated, ["/QuoteDetails?id=q-1", "/QuoteDetails?id=q-1"]);
});

test("interactive links inside selectable cards do not change card selection", async () => {
  const {QuoteCard, setNavigate} = await loadQuoteCard();
  const selected = [];
  setNavigate(() => assert.fail("A selection must not navigate"));
  const card = QuoteCard({quote, selectable: true, onToggleSelect: (id) => selected.push(id)});
  const wrapper = card.props.children;
  wrapper.props.onClick({
    target: {closest: () => ({tagName: "A"})},
    currentTarget: wrapper
  });
  assert.deepEqual(selected, []);
});

test("chat selection routes include an encoded stable quote reference", async () => {
  const {QuoteCard} = await loadQuoteCard();
  const card = QuoteCard({quote: {...quote, id: "local & id", quote_number: "Q-6895953751"}});
  const route = new URL(card.props.children.props["data-enquote-share-route"], "https://local.invalid");
  assert.equal(route.searchParams.get("id"), "local & id");
  assert.equal(route.searchParams.get("quoteNumber"), "Q-6895953751");
});
