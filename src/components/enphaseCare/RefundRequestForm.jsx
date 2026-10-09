import React, {useEffect, useState} from "react";
import {useQueryClient} from "@tanstack/react-query";
import {toast} from "sonner";
import {Card, CardContent, CardDescription, CardHeader, CardTitle} from "@/components/ui/card";
import {Button} from "@/components/ui/button";
import {Input} from "@/components/ui/input";
import {Textarea} from "@/components/ui/textarea";
import {useUserRole} from "@/components/auth/RoleGuard";
import nativeForm from "enquote-refund-form";

export default function RefundRequestForm() {
  const {user} = useUserRole();
  const queryClient = useQueryClient();
  const bridge = globalThis.window?.enquoteLocal?.refundRequests;
  const available = Boolean(bridge?.trackerStatus && bridge?.submitToTracker && bridge?.retryTracker);
  const [answers, setAnswers] = useState({});
  const [destination, setDestination] = useState({path: null, pending: false, saved: false});
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [connectionError, setConnectionError] = useState("");

  async function call(method, ...args) {
    const result = await bridge[method](...args);
    if (!result?.ok) throw new Error(result?.error || "Could not complete the refund request operation.");
    return result;
  }

  useEffect(() => {
    if (!available) return undefined;
    let active = true;
    let running = false;
    async function checkTracker() {
      if (running) return;
      running = true;
      try {
        const result = await bridge.trackerStatus();
        if (active) {
          setDestination(result);
          setReady(Boolean(result?.ok && result.configured));
          setConnectionError(result?.ok ? "" : result?.error || "Could not connect to the shared tracker.");
        }
      } catch (failure) {
        if (active) {setReady(false); setConnectionError(failure.message);}
      } finally {running = false;}
    }
    void checkTracker();
    const timer = setInterval(checkTracker, 30_000);
    return () => {active = false; clearInterval(timer);};
  }, [bridge, available]);

  async function submit(event, retry = false) {
    event.preventDefault();
    if (!retry && !nativeForm.validateAnswers(answers)) {
      setError("Complete every required question with a valid answer.");
      toast.error("Complete every required question with a valid answer.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const result = retry ? await call("retryTracker") : await call("submitToTracker", answers);
      setDestination(await call("trackerStatus"));
      if (result.saved) {
        setAnswers({});
        await queryClient.invalidateQueries({queryKey: ["refund-requests"]});
      }
      if (!result.written) {
        const message = `Saved to EnQuote, but Excel write is pending: ${result.error}`;
        setError(message);
        toast.error(message);
      } else {
        toast.success("Request saved to the shared Excel tracker and EnQuote.");
      }
    } catch (failure) {
      setError(failure.message);
      toast.error(failure.message);
      try {setDestination(await call("trackerStatus"));}
      catch (statusFailure) {toast.error(`Could not refresh submission status: ${statusFailure.message}`);}
    } finally {setBusy(false);}
  }

  const questions = nativeForm.visibleQuestions(answers);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Enphase Care Cancel/Refund Request Tracking</CardTitle>
        <CardDescription>
          Use this form to record and track Enphase Care refund requests. Before submitting,
          have the customer and case details, reason for the request, and supporting context ready.
        </CardDescription>
        <p className="text-sm text-muted-foreground">
          Your EnQuote account records the requester identity{user?.email ? ` (${user.email})` : ""}.
          Submit adds your request to the shared Excel tracker. EnQuote reads that same workbook
          and syncs request edits back to it. No CSV is needed.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm font-medium">Shared tracker: automatic connection</span>
          <span className="break-all text-sm text-muted-foreground">{ready ? destination.path : "Waiting for the shared OneDrive workbook. Retrying automatically every 30 seconds."}</span>
        </div>
        {connectionError && <p role="alert" className="text-sm text-destructive">{connectionError}</p>}
        {destination.pending && (
          <div className="space-y-2">
            <p className="text-sm">
              {destination.saved ? "Request saved; Excel write needs retry." : "A submission is pending; retry to confirm it was saved."}
              {" "}Retry does not create a duplicate request.
            </p>
            <Button disabled={busy} onClick={(event) => submit(event, true)}>Retry Excel submission</Button>
          </div>
        )}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      </CardHeader>
      <CardContent>
        {!available ? (
          <p className="text-sm text-muted-foreground">
            This form requires the updated EnQuote desktop app. Fully quit and restart EnQuote to load its native submission service.
          </p>
        ) : (
          <form onSubmit={submit} className="space-y-6">
            <p className="text-sm text-muted-foreground">All displayed questions are required.</p>
            <fieldset disabled={busy || destination.pending} className="space-y-6">
              {questions.map((question, index) => (
                <div key={question.key} className="space-y-2">
                  {question.options ? (
                    <fieldset className="space-y-2">
                      <legend className="text-sm font-medium">{index + 1}. {question.label} *</legend>
                      {question.options.map((option) => (
                        <label key={option} className="flex items-center gap-2 text-sm">
                          <input type="radio" name={question.key} value={option} required
                            checked={answers[question.key] === option}
                            onChange={() => setAnswers((previous) => ({...previous, [question.key]: option}))} />
                          {option}
                        </label>
                      ))}
                    </fieldset>
                  ) : (
                    <>
                      <label htmlFor={`native-refund-${question.key}`} className="block text-sm font-medium">
                        {index + 1}. {question.label} *
                      </label>
                      {question.help && <p className="text-sm text-muted-foreground">{question.help}</p>}
                      {React.createElement(question.type === "textarea" ? Textarea : Input, {
                        id: `native-refund-${question.key}`, required: true, maxLength: question.max,
                        ...(question.type !== "textarea" ? {type: question.type || "text"} : {}),
                        value: answers[question.key] || "",
                        onChange: (event) => setAnswers((previous) => ({...previous, [question.key]: event.target.value}))
                      })}
                    </>
                  )}
                </div>
              ))}
            </fieldset>
            <Button type="submit" disabled={busy || !ready || !destination.path || destination.pending}>
              {busy ? "Saving..." : "Submit request"}
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
