"use client";

import { useEffect, useState } from "react";

import { AuthCallbackScreen } from "@/components/auth-entry";
import { claimGitHubAppInstallation, readSession } from "@/lib/api";

export default function GitHubAppInstallPage() {
  const [state, setState] = useState<{
    status: "loading" | "success" | "error";
    message: string;
  }>({
    status: "loading",
    message: "Claiming the GitHub App installation…",
  });

  useEffect(() => {
    const session = readSession();
    if (!session) {
      setState({ status: "error", message: "Sign in to AutoWeave before finishing the GitHub App install." });
      return;
    }
    const params = new URLSearchParams(window.location.search);
    const installationId = Number(params.get("installation_id") || "");
    const setupAction = params.get("setup_action");
    const setupState = params.get("state");
    if (!Number.isFinite(installationId) || installationId <= 0 || !setupState) {
      setState({ status: "error", message: "Missing GitHub App installation details." });
      return;
    }
    void claimGitHubAppInstallation(session.token, {
      installation_id: installationId,
      state: setupState,
      setup_action: setupAction,
    })
      .then(() => {
        setState({ status: "success", message: "GitHub App installation ready. Redirecting into AutoWeave…" });
        window.location.href = "/app";
      })
      .catch((error) => {
        setState({
          status: "error",
          message: error instanceof Error ? error.message : "Unable to claim the GitHub App installation.",
        });
      });
  }, []);

  return <AuthCallbackScreen status={state.status} message={state.message} />;
}
