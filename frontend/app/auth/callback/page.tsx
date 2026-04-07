"use client";

import { useEffect, useState } from "react";

import { AuthCallbackScreen } from "@/components/auth-entry";
import { exchangeGitHubCode, writeSession } from "@/lib/api";

export default function GitHubCallbackPage() {
  const [state, setState] = useState<{
    status: "loading" | "success" | "error";
    message: string;
  }>({
    status: "loading",
    message: "Completing GitHub sign-in…",
  });

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    if (!code) {
      setState({ status: "error", message: "Missing GitHub code." });
      return;
    }
    void exchangeGitHubCode(code)
      .then((session) => {
        writeSession(session);
        setState({ status: "success", message: "GitHub session ready. Redirecting into AutoWeave…" });
        window.location.href = "/app";
      })
      .catch((error) => {
        setState({
          status: "error",
          message: error instanceof Error ? error.message : "Unable to complete GitHub sign-in.",
        });
      });
  }, []);

  return <AuthCallbackScreen status={state.status} message={state.message} />;
}
