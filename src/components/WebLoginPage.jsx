import React, { useState } from "react";
import { webLogin, webRegister } from "@/lib/webAuth";

// Login / Register page shown when no valid web token is found.
// After successful login, the page reloads so AuthContext picks up the session.
export default function WebLoginPage() {
  const [mode, setMode] = useState("login"); // "login" | "register"
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      if (mode === "register") {
        if (password.length < 8) {
          setError("Password must be at least 8 characters.");
          setLoading(false);
          return;
        }
        if (password !== confirmPassword) {
          setError("Passwords do not match.");
          setLoading(false);
          return;
        }
        await webRegister(email.trim(), password);
      } else {
        await webLogin(email.trim(), password);
      }
      // Success — reload so AuthContext re-checks with the new token
      window.location.reload();
    } catch (err) {
      const reason = err.message || "Unknown error";
      if (reason === "identity_verification_required") {
        setError("Verify your company identity through Cloudflare Access before creating a password. Contact your administrator if company sign-in is unavailable.");
      } else if (reason === "invalid_credentials") {
        setError("Email or password is incorrect. First-time setup requires verified company sign-in.");
      } else if (reason === "too_many_attempts") {
        setError("Too many sign-in attempts. Please wait 15 minutes.");
      } else if (reason === "password_not_set") {
        setError("No password set for this email yet. Switch to Register to create one.");
      } else if (reason === "password_already_set") {
        setError("A password is already set for this email. Use Login instead.");
      } else if (reason === "email_not_allowed") {
        setError("This email is not on the allowed list. Contact your administrator.");
      } else if (reason === "invalid_password") {
        setError("Incorrect password.");
      } else if (reason === "password_too_short") {
        setError("Password must be at least 8 characters.");
      } else {
        setError(reason);
      }
      setLoading(false);
    }
  };

  return (
    <div style={{
      display: "flex",
      minHeight: "100vh",
      alignItems: "center",
      justifyContent: "center",
      background: "#0f172a",
      fontFamily: "system-ui, -apple-system, sans-serif",
    }}>
      <div style={{
        width: "100%",
        maxWidth: "400px",
        padding: "2rem",
        background: "#1e293b",
        borderRadius: "12px",
        boxShadow: "0 25px 50px -12px rgba(0,0,0,0.5)",
      }}>
        <h1 style={{
          color: "#f1f5f9",
          fontSize: "1.5rem",
          marginBottom: "0.5rem",
          textAlign: "center",
        }}>
          EnQuote
        </h1>
        <p style={{
          color: "#94a3b8",
          fontSize: "0.875rem",
          textAlign: "center",
          marginBottom: "1.5rem",
        }}>
          {mode === "login" ? "Sign in to your account" : "Create your password"}
        </p>

        {error && (
          <div style={{
            background: "#7f1d1d",
            color: "#fecaca",
            padding: "0.75rem",
            borderRadius: "8px",
            fontSize: "0.875rem",
            marginBottom: "1rem",
          }}>
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: "1rem" }}>
            <label style={{
              display: "block",
              color: "#cbd5e1",
              fontSize: "0.875rem",
              marginBottom: "0.25rem",
            }}>
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
              style={{
                width: "100%",
                padding: "0.625rem",
                background: "#0f172a",
                border: "1px solid #334155",
                borderRadius: "8px",
                color: "#f1f5f9",
                fontSize: "0.875rem",
                outline: "none",
              }}
            />
          </div>

          <div style={{ marginBottom: "1rem" }}>
            <label style={{
              display: "block",
              color: "#cbd5e1",
              fontSize: "0.875rem",
              marginBottom: "0.25rem",
            }}>
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              style={{
                width: "100%",
                padding: "0.625rem",
                background: "#0f172a",
                border: "1px solid #334155",
                borderRadius: "8px",
                color: "#f1f5f9",
                fontSize: "0.875rem",
                outline: "none",
              }}
            />
          </div>

          {mode === "register" && (
            <div style={{ marginBottom: "1rem" }}>
              <label style={{
                display: "block",
                color: "#cbd5e1",
                fontSize: "0.875rem",
                marginBottom: "0.25rem",
              }}>
                Confirm Password
              </label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                autoComplete="new-password"
                style={{
                  width: "100%",
                  padding: "0.625rem",
                  background: "#0f172a",
                  border: "1px solid #334155",
                  borderRadius: "8px",
                  color: "#f1f5f9",
                  fontSize: "0.875rem",
                  outline: "none",
                }}
              />
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            style={{
              width: "100%",
              padding: "0.625rem",
              background: loading ? "#475569" : "#3b82f6",
              color: "#fff",
              border: "none",
              borderRadius: "8px",
              fontSize: "0.875rem",
              fontWeight: 600,
              cursor: loading ? "not-allowed" : "pointer",
            }}
          >
            {loading ? "Please wait..." : mode === "login" ? "Sign In" : "Create Password"}
          </button>
        </form>

        <div style={{
          textAlign: "center",
          marginTop: "1rem",
        }}>
          <button
            onClick={() => {
              setMode(mode === "login" ? "register" : "login");
              setError(null);
            }}
            style={{
              background: "none",
              border: "none",
              color: "#60a5fa",
              fontSize: "0.875rem",
              cursor: "pointer",
              textDecoration: "underline",
            }}
          >
            {mode === "login"
              ? "First time? Create a password"
              : "Already have a password? Sign in"}
          </button>
        </div>
      </div>
    </div>
  );
}
