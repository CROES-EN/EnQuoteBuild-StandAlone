import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Sparkles, Loader2, X, Check } from "lucide-react";
import { toast } from "sonner";

export default function QuoteAIAssistant({ 
  products, 
  allQuotes,
  currentScope,
  onScopeGenerated,
  onProductsSuggested,
  onPriceEstimate
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [scopePrompt, setScopePrompt] = useState("");

  const generateScope = async () => {
    if (!scopePrompt.trim()) {
      toast.error("Please describe what work needs to be done");
      return;
    }

    setLoading(true);
    try {
      const result = await base44.integrations.Core.InvokeLLM({
        prompt: `You are an expert at writing detailed scopes of work for electrical/solar maintenance and service.

Based on this brief description: "${scopePrompt}"

Generate a professional, detailed scope of work description that includes:
- What needs to be done
- Any relevant safety considerations
- Expected approach/methodology

Keep it concise but comprehensive. Return ONLY the scope of work text, no additional commentary.`,
        add_context_from_internet: false
      });

      onScopeGenerated(result);
      setScopePrompt("");
      toast.success("Scope generated successfully");
    } catch (error) {
      toast.error("Failed to generate scope: " + error.message);
    } finally {
      setLoading(false);
    }
  };

  const suggestProducts = async () => {
    if (!currentScope?.trim()) {
      toast.error("Please enter a scope of work first");
      return;
    }

    setLoading(true);
    try {
      const productList = products.map(p => ({
        id: p.id,
        name: p.name,
        description: p.description,
        type: p.type,
        unit_price: p.unit_price,
        unit: p.unit
      }));

      const result = await base44.integrations.Core.InvokeLLM({
        prompt: `You are an expert at matching products and services to job requirements.

Scope of Work:
${currentScope}

Available Products/Services:
${JSON.stringify(productList, null, 2)}

Analyze the scope and suggest which products/services would be most relevant for this job. For each suggestion, provide:
- The product ID
- Estimated quantity needed
- Brief reason why it's needed

Return ONLY valid JSON matching this schema.`,
        response_json_schema: {
          type: "object",
          properties: {
            suggestions: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  product_id: { type: "string" },
                  quantity: { type: "number" },
                  reason: { type: "string" }
                }
              }
            }
          }
        }
      });

      onProductsSuggested(result.suggestions || []);
      toast.success(`Suggested ${result.suggestions?.length || 0} products`);
    } catch (error) {
      toast.error("Failed to suggest products: " + error.message);
    } finally {
      setLoading(false);
    }
  };

  const estimatePrice = async () => {
    if (!currentScope?.trim()) {
      toast.error("Please enter a scope of work first");
      return;
    }

    setLoading(true);
    try {
      const recentQuotes = allQuotes
        .filter(q => q.status !== 'rejected' && q.total && q.scope_of_work)
        .slice(0, 50)
        .map(q => ({
          scope: q.scope_of_work,
          total: q.total,
          labor_hours: q.labor_hours,
          fst_count: q.fst_count
        }));

      const result = await base44.integrations.Core.InvokeLLM({
        prompt: `You are a pricing analyst for maintenance and service quotes.

Current Scope of Work:
${currentScope}

Historical Similar Quotes:
${JSON.stringify(recentQuotes, null, 2)}

Based on the current scope and historical data, provide:
- Estimated total price range (min and max)
- Estimated labor hours
- Estimated number of FSTs needed
- Brief reasoning

Return ONLY valid JSON matching the schema.`,
        response_json_schema: {
          type: "object",
          properties: {
            estimated_min: { type: "number" },
            estimated_max: { type: "number" },
            suggested_labor_hours: { type: "number" },
            suggested_fst_count: { type: "number" },
            reasoning: { type: "string" }
          }
        }
      });

      onPriceEstimate(result);
      toast.success("Price estimate generated");
    } catch (error) {
      toast.error("Failed to estimate price: " + error.message);
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) {
    return (
      <Button
        type="button"
        variant="outline"
        onClick={() => setIsOpen(true)}
        className="border-orange-300 text-orange-700 hover:bg-orange-50"
      >
        <Sparkles className="w-4 h-4 mr-2" />
        AI Assistant
      </Button>
    );
  }

  return (
    <Card className="p-4 border-orange-200 bg-orange-50/50">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-orange-600" />
          <h3 className="font-semibold text-slate-900">AI Quote Assistant</h3>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => setIsOpen(false)}
          className="h-8 w-8"
        >
          <X className="w-4 h-4" />
        </Button>
      </div>

      <div className="space-y-3">
        {/* Generate Scope */}
        <div className="space-y-2">
          <label className="text-sm font-medium text-slate-700">
            Generate Scope of Work
          </label>
          <Textarea
            placeholder="Briefly describe the work needed (e.g., 'Replace 3 damaged solar panels and repair wiring')"
            value={scopePrompt}
            onChange={(e) => setScopePrompt(e.target.value)}
            rows={2}
            className="text-sm"
          />
          <Button
            type="button"
            size="sm"
            onClick={generateScope}
            disabled={loading || !scopePrompt.trim()}
            className="w-full bg-orange-600 hover:bg-orange-700"
          >
            {loading ? (
              <Loader2 className="w-4 h-4 animate-spin mr-2" />
            ) : (
              <Sparkles className="w-4 h-4 mr-2" />
            )}
            Generate Scope Description
          </Button>
        </div>

        <div className="border-t border-orange-200 pt-3 space-y-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={suggestProducts}
            disabled={loading || !currentScope}
            className="w-full"
          >
            {loading ? (
              <Loader2 className="w-4 h-4 animate-spin mr-2" />
            ) : (
              <Check className="w-4 h-4 mr-2" />
            )}
            Suggest Products & Services
          </Button>

          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={estimatePrice}
            disabled={loading || !currentScope}
            className="w-full"
          >
            {loading ? (
              <Loader2 className="w-4 h-4 animate-spin mr-2" />
            ) : (
              <Check className="w-4 h-4 mr-2" />
            )}
            Estimate Pricing
          </Button>
        </div>

        <p className="text-xs text-slate-500 mt-2">
          AI suggestions are based on your catalog and historical quotes. Always review and adjust as needed.
        </p>
      </div>
    </Card>
  );
}