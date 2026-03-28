"use client";

import { useEffect, useState } from "react";

import { exchangeGitHubCode, writeSession } from "@/lib/api";

export default function GitHubCallbackPage() {
  const [message, setMessage] = useState("Completing GitHub sign-in…");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    if (!code) {
      setMessage("Missing GitHub code.");
      return;
    }
    void exchangeGitHubCode(code)
      .then((session) => {
        writeSession(session);
        window.location.href = "/app";
      })
      .catch((error) => {
        setMessage(error instanceof Error ? error.message : "Unable to complete GitHub sign-in.");
      });
  }, []);

  return <div className="flex min-h-screen items-center justify-center text-sm text-quiet">{message}</div>;
}
