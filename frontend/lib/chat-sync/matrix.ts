"use client";

import type { ChatSyncBootstrap } from "@/lib/types";
import { normalizeLoopbackBaseUrl } from "@/lib/api";

export type ConversationSelection = { kind: "channel" | "dm"; id: string };

type MatrixModule = typeof import("matrix-js-sdk");

export function resolveMatrixSyncBaseUrl(baseUrl: string) {
  return normalizeLoopbackBaseUrl(baseUrl) ?? baseUrl;
}

export class MatrixChatSyncAdapter {
  private matrixModule: MatrixModule | null = null;

  private client: any | null = null;

  private roomBindings = new Map<string, ConversationSelection>();

  async start(
    bootstrap: ChatSyncBootstrap,
    onConversationEvent: (selection: ConversationSelection) => void,
  ): Promise<void> {
    if (!bootstrap.enabled || bootstrap.provider !== "matrix" || !bootstrap.base_url || !bootstrap.access_token || !bootstrap.user_id) {
      return;
    }
    await this.stop();
    this.roomBindings = new Map<string, ConversationSelection>();
    for (const binding of bootstrap.room_bindings) {
      if (binding.channel_id) {
        this.roomBindings.set(binding.room_id, { kind: "channel", id: binding.channel_id });
        continue;
      }
      if (binding.dm_thread_id) {
        this.roomBindings.set(binding.room_id, { kind: "dm", id: binding.dm_thread_id });
      }
    }
    this.matrixModule = await import("matrix-js-sdk");
    const { createClient } = this.matrixModule;
    this.client = createClient({
      baseUrl: resolveMatrixSyncBaseUrl(bootstrap.base_url),
      accessToken: bootstrap.access_token,
      userId: bootstrap.user_id,
      deviceId: bootstrap.device_id ?? undefined,
      timelineSupport: true,
    });
    this.client.on("Room.timeline", (event: any, room: any, toStartOfTimeline: boolean) => {
      if (toStartOfTimeline || !room || event?.getType?.() !== "m.room.message") {
        return;
      }
      const selection = this.roomBindings.get(room.roomId);
      if (selection) {
        onConversationEvent(selection);
      }
    });
    this.client.startClient({
      initialSyncLimit: 20,
      lazyLoadMembers: true,
    });
  }

  async stop(): Promise<void> {
    if (this.client) {
      this.client.stopClient();
      this.client = null;
    }
  }
}
