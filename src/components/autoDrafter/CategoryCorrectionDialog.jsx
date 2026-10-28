import {useEffect, useState} from "react";
import {toast} from "sonner";
import {Button} from "@/components/ui/button";
import {Input} from "@/components/ui/input";
import {Textarea} from "@/components/ui/textarea";
import {Select, SelectContent, SelectItem, SelectTrigger, SelectValue} from "@/components/ui/select";
import {Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle} from "@/components/ui/dialog";
import {REQUEST_TYPES} from "@/features/autoDrafter/requestClassification";
import {parseQuoteRequestCase} from "@/features/autoDrafter/parseQuoteRequestCase";
import {isPlaceholderItemName} from "@/features/autoDrafter/pvModuleRecognition";
import {MIN_RULE_PHRASE_LENGTH, PV_MODULE_RULE} from "@/features/autoDrafter/categoryLearning";
import {forgetCategoryCorrection, forgetCategoryRule, saveCategoryCorrection} from "@/features/quoteDraftAgent/learnedSwapsStore";

const CORRECTABLE_TYPES = REQUEST_TYPES.filter(option => option.value !== "unclassified");

function suggestedPhrase(comment) {
  const {request} = parseQuoteRequestCase(comment);
  const item = [...request.products, ...request.materials, ...request.services]
    .find(line => !isPlaceholderItemName(line.name));
  return item ? String(item.name).trim() : "";
}

// Lets a reviewer fix a wrong request category and, optionally, teach EnQuote a rule so the same
// wording is categorized correctly on every later request.
export default function CategoryCorrectionDialog({target, onClose, onSaved, taughtBy}) {
  const classification = target?.classification;
  const [category, setCategory] = useState("");
  const [note, setNote] = useState("");
  const [teach, setTeach] = useState(false);
  const [ruleKind, setRuleKind] = useState("category");
  const [phrase, setPhrase] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!target) return;
    setCategory(classification?.type && classification.type !== "unclassified" ? classification.type : "on_demand");
    setNote("");
    setTeach(false);
    setRuleKind("category");
    setPhrase(suggestedPhrase(target.comment));
  }, [target]);

  const learned = classification?.learned;
  const phraseTooShort = teach && phrase.trim().length < MIN_RULE_PHRASE_LENGTH;
  const ruleCategory = ruleKind === PV_MODULE_RULE ? PV_MODULE_RULE : category;

  async function run(action, message) {
    setSaving(true);
    try {
      await action();
      toast.success(message);
      onSaved?.();
      onClose();
    } catch (error) {
      toast.error(error.message || "Could not save the category correction.");
    } finally {
      setSaving(false);
    }
  }

  const save = () => run(() => saveCategoryCorrection({
    caseNumber: target.caseNumber, category, automaticCategory: classification?.automaticType || classification?.type,
    note, taughtBy, rule: teach ? {phrase: phrase.trim(), category: ruleCategory} : null
  }), teach ? `Category saved. EnQuote learned "${phrase.trim()}".` : `Category saved for case ${target.caseNumber}.`);

  return <Dialog open={Boolean(target)} onOpenChange={open => {if (!open && !saving) onClose();}}>
    <DialogContent className="max-w-lg" data-category-correction-dialog>
      <DialogHeader>
        <DialogTitle>Correct category for case {target?.caseNumber}</DialogTitle>
        <DialogDescription>
          Currently: {classification?.label || "Unclassified"}.
          {classification?.automaticType && classification.automaticType !== classification.type &&
            ` Automatic category: ${REQUEST_TYPES.find(option => option.value === classification.automaticType)?.label}.`}
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-4 text-sm">
        <div className="space-y-1">
          <label htmlFor="category-correction-type" className="font-medium">Correct category</label>
          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger id="category-correction-type" aria-label="Correct category"><SelectValue /></SelectTrigger>
            <SelectContent>
              {CORRECTABLE_TYPES.map(option => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <label htmlFor="category-correction-note" className="font-medium">Note (optional)</label>
          <Textarea id="category-correction-note" value={note} onChange={event => setNote(event.target.value)}
            placeholder="e.g. Third-party module replacement" />
        </div>
        <div className="rounded-lg border border-border p-3 space-y-3">
          <label className="flex items-start gap-2 cursor-pointer">
            <input type="checkbox" className="mt-1" checked={teach} onChange={event => setTeach(event.target.checked)}
              data-category-teach />
            <span><span className="font-medium">Teach EnQuote</span> - apply this to future requests automatically.</span>
          </label>
          {teach && <div className="space-y-3 pl-6">
            <div className="space-y-1">
              <label htmlFor="category-rule-kind" className="font-medium">Rule</label>
              <Select value={ruleKind} onValueChange={setRuleKind}>
                <SelectTrigger id="category-rule-kind" aria-label="Rule type"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="category">Requests mentioning this phrase are the category above</SelectItem>
                  <SelectItem value={PV_MODULE_RULE}>This phrase is a PV module (solar panel)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <label htmlFor="category-rule-phrase" className="font-medium">Phrase</label>
              <Input id="category-rule-phrase" value={phrase} onChange={event => setPhrase(event.target.value)}
                placeholder="e.g. Enphase Care Enrollment" />
              <p className="text-xs text-muted-foreground">
                Matched in the scope and requested item names, ignoring case. Use specific wording so unrelated requests are not caught.
              </p>
            </div>
          </div>}
        </div>
        {learned && <div className="rounded-lg bg-muted/50 p-3 space-y-2" data-category-learned>
          <p className="text-muted-foreground">
            {learned.source === "case"
              ? `This case was corrected${learned.taughtBy ? ` by ${learned.taughtBy}` : ""}.`
              : `Learned rule: "${learned.phrase}"${learned.taughtBy ? ` (taught by ${learned.taughtBy})` : ""}.`}
          </p>
          {learned.source === "case"
            ? <Button variant="outline" size="sm" disabled={saving} data-category-reset
                onClick={() => run(() => forgetCategoryCorrection(target.caseNumber), `Case ${target.caseNumber} uses the automatic category again.`)}>
                Use automatic category
              </Button>
            : <Button variant="outline" size="sm" disabled={saving} data-category-forget-rule
                onClick={() => run(() => forgetCategoryRule(learned.phrase), `EnQuote forgot "${learned.phrase}".`)}>
                Forget this rule
              </Button>}
        </div>}
        <div className="flex justify-end gap-2">
          <Button variant="outline" disabled={saving} onClick={onClose}>Cancel</Button>
          <Button data-confirm-category-correction disabled={saving || !category || phraseTooShort} onClick={save}>
            {saving ? "Saving..." : "Save category"}
          </Button>
        </div>
      </div>
    </DialogContent>
  </Dialog>;
}
