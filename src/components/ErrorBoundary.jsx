import {Component} from "react";
import {Button} from "@/components/ui/button";
import {AlertTriangle} from "lucide-react";
import {recordError} from "@/features/developerConsole/errorLog";

// Catches render-time errors anywhere below it so a single broken component/page (e.g.
// data shaped differently than a component expects, right after a sync) shows a
// recoverable message instead of the ENTIRE app silently unmounting to a blank screen -
// which is what React does by default on an uncaught render error with no boundary.
// This was a real contributor to the "page goes blank sometimes" bug reports.
export default class ErrorBoundary extends Component {
 constructor(props) {
 super(props);
 this.state = { error: null };
 }

 static getDerivedStateFromError(error) {
 return { error };
 }

 componentDidCatch(error, info) {
 console.error("[ErrorBoundary] Caught a render error:", error, info?.componentStack);
 recordError({ source: "ErrorBoundary", message: error?.message, stack: error?.stack, componentStack: info?.componentStack });
 }

 handleReload = () => {
 this.setState({ error: null });
 globalThis.window?.location?.reload();
 };

 render() {
 if (this.state.error) {
 return (
 <div className="min-h-screen bg-background flex items-center justify-center p-4">
 <div className="max-w-md w-full rounded-2xl border border-border bg-card p-8 text-center shadow-sm">
 <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-rose-100 flex items-center justify-center">
 <AlertTriangle className="w-8 h-8 text-rose-600" />
 </div>
 <h2 className="text-2xl font-bold text-foreground mb-2">Something went wrong</h2>
 <p className="text-muted-foreground mb-6">
 This page hit an unexpected error while rendering. Your data is safe - reload to try again.
 </p>
 <Button onClick={this.handleReload} className="bg-indigo-600 hover:bg-indigo-700">
 Reload App
 </Button>
 {this.state.error?.message && (
 <p className="mt-4 text-xs text-muted-foreground break-words">{this.state.error.message}</p>
 )}
 </div>
 </div>
 );
 }
 return this.props.children;
 }
}
