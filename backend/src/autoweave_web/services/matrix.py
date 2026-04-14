from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
import hashlib
import hmac
import logging
import re
import secrets
import time
from typing import Any, Callable

import httpx
from sqlalchemy import select
from sqlalchemy.orm import Session

from autoweave_web.core.settings import Settings
from autoweave_web.db.session import db_session, generate_id, utc_now
from autoweave_web.models.entities import (
    Channel,
    DmParticipant,
    DmThread,
    MatrixMessageLink,
    MatrixRoomBinding,
    MatrixSyncState,
    Message,
    Orbit,
    OrbitMembership,
    User,
)
from autoweave_web.services.product_state import (
    create_message_notifications,
    ensure_matrix_sync_state,
    ensure_matrix_user_mapping,
    mark_conversation_seen,
    matrix_message_link_for_event,
    matrix_message_link_for_message,
    matrix_message_link_for_txn,
    matrix_room_binding_for_conversation,
    matrix_room_binding_for_room,
    matrix_user_mapping_for_matrix_user,
    matrix_user_mapping_for_user,
    upsert_matrix_membership_state,
    upsert_matrix_message_link,
    upsert_matrix_room_binding,
)

logger = logging.getLogger(__name__)


class MatrixTransportError(RuntimeError):
    pass


def _normalize_localpart(raw: str) -> str:
    normalized = re.sub(r"[^a-z0-9._=/:-]+", "-", raw.strip().lower()).strip("-")
    return normalized or f"user-{secrets.token_hex(4)}"


def _deterministic_password(*, settings: Settings, seed: str) -> str:
    digest = hmac.new(
        settings.matrix_password_salt.encode("utf-8"),
        seed.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()
    return digest


def matrix_txn_id_for_message(message_id: str) -> str:
    return f"aw-{message_id}"


@dataclass(slots=True)
class MatrixLogin:
    access_token: str
    user_id: str
    device_id: str | None


class MatrixService:
    def __init__(self, settings: Settings, *, client: httpx.Client | None = None) -> None:
        self.settings = settings
        self._client = client or httpx.Client(timeout=30.0)
        self._login_cache: dict[str, MatrixLogin] = {}

    def _request(
        self,
        method: str,
        path: str,
        *,
        access_token: str | None = None,
        json_body: dict[str, Any] | None = None,
        params: dict[str, Any] | None = None,
        use_public: bool = False,
    ) -> dict[str, Any]:
        base_url = self.settings.matrix_homeserver_public_url if use_public else self.settings.matrix_homeserver_internal_url
        headers: dict[str, str] = {}
        if access_token:
            headers["Authorization"] = f"Bearer {access_token}"
        try:
            response = self._client.request(
                method,
                f"{base_url.rstrip('/')}{path}",
                headers=headers,
                json=json_body,
                params=params,
            )
        except httpx.HTTPError as exc:
            raise MatrixTransportError(f"Matrix transport unavailable: {exc}") from exc
        if response.status_code >= 400:
            raise MatrixTransportError(f"Matrix request failed ({response.status_code}): {response.text}")
        payload = response.json() if response.content else {}
        return payload if isinstance(payload, dict) else {}

    @staticmethod
    def _is_user_in_use_error(error: MatrixTransportError) -> bool:
        message = str(error)
        return "M_USER_IN_USE" in message or "User ID already taken" in message

    def client_versions(self) -> dict[str, Any]:
        return self._request("GET", "/_matrix/client/versions", use_public=False)

    def _shared_secret_register(self, *, localpart: str, password: str, display_name: str | None = None) -> None:
        if not self.settings.matrix_registration_shared_secret:
            raise MatrixTransportError("Matrix registration shared secret is not configured.")
        nonce_payload = self._request("GET", "/_synapse/admin/v1/register")
        nonce = str(nonce_payload.get("nonce") or "").strip()
        if not nonce:
            raise MatrixTransportError("Matrix registration nonce missing.")
        mac = hmac.new(self.settings.matrix_registration_shared_secret.encode("utf-8"), digestmod=hashlib.sha1)
        mac.update(nonce.encode("utf-8"))
        mac.update(b"\x00")
        mac.update(localpart.encode("utf-8"))
        mac.update(b"\x00")
        mac.update(password.encode("utf-8"))
        mac.update(b"\x00")
        mac.update(b"notadmin")
        payload = {
            "nonce": nonce,
            "username": localpart,
            "password": password,
            "admin": False,
            "mac": mac.hexdigest(),
        }
        if display_name:
            payload["displayname"] = display_name
        self._request("POST", "/_synapse/admin/v1/register", json_body=payload)

    def login_local_user(self, *, localpart: str, password: str) -> MatrixLogin:
        cache_key = f"{localpart}:{password}"
        cached = self._login_cache.get(cache_key)
        if cached is not None:
            return cached
        payload = self._request(
            "POST",
            "/_matrix/client/v3/login",
            json_body={
                "type": "m.login.password",
                "identifier": {"type": "m.id.user", "user": localpart},
                "password": password,
            },
        )
        login = MatrixLogin(
            access_token=str(payload.get("access_token") or ""),
            user_id=str(payload.get("user_id") or ""),
            device_id=str(payload.get("device_id") or "") or None,
        )
        if not login.access_token or not login.user_id:
            raise MatrixTransportError("Matrix login did not return an access token.")
        self._login_cache[cache_key] = login
        return login

    def ensure_local_user_login(
        self,
        *,
        localpart: str,
        password: str,
        display_name: str | None = None,
    ) -> MatrixLogin:
        try:
            return self.login_local_user(localpart=localpart, password=password)
        except MatrixTransportError:
            try:
                self._shared_secret_register(localpart=localpart, password=password, display_name=display_name)
            except MatrixTransportError as error:
                if not self._is_user_in_use_error(error):
                    raise
            return self.login_local_user(localpart=localpart, password=password)

    def ensure_product_user_login(self, *, user: User) -> tuple[str, str, MatrixLogin]:
        localpart = _normalize_localpart(user.github_login or user.display_name or user.id)
        password = _deterministic_password(settings=self.settings, seed=user.id)
        login = self.ensure_local_user_login(localpart=localpart, password=password, display_name=user.display_name)
        return localpart, password, login

    def ensure_bridge_login(self) -> MatrixLogin:
        password = _deterministic_password(settings=self.settings, seed=f"bridge:{self.settings.matrix_bridge_localpart}")
        return self.ensure_local_user_login(
            localpart=self.settings.matrix_bridge_localpart,
            password=password,
            display_name="AutoWeave Matrix bridge",
        )

    def create_private_room(
        self,
        *,
        creator_access_token: str,
        name: str,
        invitees: list[str],
        is_direct: bool = False,
    ) -> str:
        payload = {
            "name": name,
            "preset": "private_chat",
            "is_direct": is_direct,
            "visibility": "private",
            "invite": invitees,
        }
        created = self._request("POST", "/_matrix/client/v3/createRoom", access_token=creator_access_token, json_body=payload)
        room_id = str(created.get("room_id") or "").strip()
        if not room_id:
            raise MatrixTransportError("Matrix room creation did not return a room id.")
        return room_id

    def join_room(self, *, access_token: str, room_id: str) -> None:
        self._request("POST", f"/_matrix/client/v3/rooms/{room_id}/join", access_token=access_token, json_body={})

    def invite_user(self, *, access_token: str, room_id: str, matrix_user_id: str) -> None:
        self._request(
            "POST",
            f"/_matrix/client/v3/rooms/{room_id}/invite",
            access_token=access_token,
            json_body={"user_id": matrix_user_id},
        )

    def send_room_message(
        self,
        *,
        access_token: str,
        room_id: str,
        txn_id: str,
        message: Message,
    ) -> str:
        payload = {
            "msgtype": "m.text",
            "body": message.body,
            "m.autoweave": {
                "product_message_id": message.id,
                "product_txn_id": txn_id,
                "author_kind": message.author_kind,
            },
        }
        response = self._request(
            "PUT",
            f"/_matrix/client/v3/rooms/{room_id}/send/m.room.message/{txn_id}",
            access_token=access_token,
            json_body=payload,
        )
        event_id = str(response.get("event_id") or "").strip()
        if not event_id:
            raise MatrixTransportError("Matrix send did not return an event id.")
        return event_id

    def sync(self, *, access_token: str, since: str | None = None) -> dict[str, Any]:
        params: dict[str, Any] = {"timeout": self.settings.matrix_sync_timeout_ms}
        if since:
            params["since"] = since
        return self._request("GET", "/_matrix/client/v3/sync", access_token=access_token, params=params)

    def set_typing(
        self,
        *,
        access_token: str,
        room_id: str,
        matrix_user_id: str,
        typing: bool,
        timeout_ms: int = 3000,
    ) -> None:
        self._request(
            "PUT",
            f"/_matrix/client/v3/rooms/{room_id}/typing/{matrix_user_id}",
            access_token=access_token,
            json_body={"typing": typing, "timeout": timeout_ms},
        )


class MatrixProvisioningService:
    def __init__(self, settings: Settings, matrix: MatrixService) -> None:
        self.settings = settings
        self.matrix = matrix

    def ensure_product_user(self, db: Session, *, user: User) -> MatrixLogin:
        localpart, _, login = self.matrix.ensure_product_user_login(user=user)
        ensure_matrix_user_mapping(
            db,
            user_id=user.id,
            matrix_user_id=login.user_id,
            matrix_localpart=localpart,
            latest_device_id=login.device_id,
        )
        return login

    def bootstrap_payload_for_orbit(self, db: Session, *, orbit: Orbit, user: User) -> dict[str, Any]:
        login = self.ensure_product_user(db, user=user)
        room_bindings = db.scalars(select(MatrixRoomBinding).where(MatrixRoomBinding.orbit_id == orbit.id)).all()
        return {
            "provider": "matrix",
            "base_url": self.settings.matrix_homeserver_public_url,
            "access_token": login.access_token,
            "user_id": login.user_id,
            "device_id": login.device_id,
            "room_bindings": [
                {
                    "room_id": binding.matrix_room_id,
                    "channel_id": binding.channel_id,
                    "dm_thread_id": binding.dm_thread_id,
                    "room_kind": binding.room_kind,
                }
                for binding in room_bindings
            ],
        }

    def ensure_room_binding(
        self,
        db: Session,
        *,
        orbit: Orbit,
        actor_user: User,
        channel: Channel | None = None,
        thread: DmThread | None = None,
    ) -> MatrixRoomBinding:
        existing = matrix_room_binding_for_conversation(
            db,
            orbit_id=orbit.id,
            channel_id=channel.id if channel else None,
            dm_thread_id=thread.id if thread else None,
        )
        if existing is not None:
            return existing
        creator_login = self.ensure_product_user(db, user=actor_user)
        invitees: list[str] = []
        if channel is not None:
            memberships = db.scalars(select(OrbitMembership).where(OrbitMembership.orbit_id == orbit.id)).all()
            for membership in memberships:
                participant_user = db.get(User, membership.user_id)
                if participant_user is None or participant_user.id == actor_user.id:
                    continue
                login = self.ensure_product_user(db, user=participant_user)
                invitees.append(login.user_id)
            room_name = f"{orbit.name} · #{channel.name}"
            room_kind = "channel"
        else:
            participants = db.scalars(select(DmParticipant).where(DmParticipant.thread_id == thread.id)).all()
            for participant in participants:
                participant_user = db.get(User, participant.user_id)
                if participant_user is None or participant_user.id == actor_user.id:
                    continue
                login = self.ensure_product_user(db, user=participant_user)
                invitees.append(login.user_id)
            room_name = f"{orbit.name} · {thread.title}"
            room_kind = "dm"
        bridge_login = self.matrix.ensure_bridge_login()
        if bridge_login.user_id not in invitees:
            invitees.append(bridge_login.user_id)
        room_id = self.matrix.create_private_room(
            creator_access_token=creator_login.access_token,
            name=room_name,
            invitees=invitees,
            is_direct=thread is not None,
        )
        self.matrix.join_room(access_token=bridge_login.access_token, room_id=room_id)
        binding = upsert_matrix_room_binding(
            db,
            orbit_id=orbit.id,
            channel_id=channel.id if channel else None,
            dm_thread_id=thread.id if thread else None,
            matrix_room_id=room_id,
            room_kind=room_kind,
            provision_state="ready",
        )
        creator_mapping = matrix_user_mapping_for_user(db, user_id=actor_user.id)
        if creator_mapping is not None:
            upsert_matrix_membership_state(
                db,
                room_binding_id=binding.id,
                matrix_user_id=creator_mapping.matrix_user_id,
                user_id=actor_user.id,
                membership="join",
            )
        for matrix_user_id in invitees:
            participant_mapping = matrix_user_mapping_for_matrix_user(db, matrix_user_id=matrix_user_id)
            upsert_matrix_membership_state(
                db,
                room_binding_id=binding.id,
                matrix_user_id=matrix_user_id,
                user_id=participant_mapping.user_id if participant_mapping else None,
                membership="invite",
            )
        return binding


class MatrixSyncBridge:
    def __init__(
        self,
        settings: Settings,
        matrix: MatrixService,
        provisioning: MatrixProvisioningService,
        *,
        session_factory: Callable[[], Session] = db_session,
    ) -> None:
        self.settings = settings
        self.matrix = matrix
        self.provisioning = provisioning
        self.session_factory = session_factory
        self.worker_name = "matrix-bridge"

    def run_forever(self, *, sleep_seconds: float = 2.0) -> None:
        while True:
            try:
                self.run_once()
            except Exception as exc:  # pragma: no cover - long-lived process guard
                logger.exception("Matrix bridge loop failed: %s", exc)
            time.sleep(sleep_seconds)

    def run_once(self) -> None:
        with self.session_factory() as db:
            self._drain_outbound(db)
            if self.settings.matrix_sync_enabled and self.settings.feature_enabled("ff_matrix_sync_ingest_v1"):
                self._sync_inbound(db)

    def _drain_outbound(self, db: Session) -> None:
        pending_links = db.scalars(
            select(MatrixMessageLink)
            .where(MatrixMessageLink.send_state.in_(("queued", "retry_requested")))
            .order_by(MatrixMessageLink.created_at)
            .limit(50)
        ).all()
        for link in pending_links:
            message = db.get(Message, link.message_id)
            room_binding = db.get(MatrixRoomBinding, link.room_binding_id)
            if message is None or room_binding is None:
                continue
            try:
                if message.user_id:
                    author = db.get(User, message.user_id)
                    if author is None:
                        raise MatrixTransportError("Author user missing for Matrix send.")
                    login = self.provisioning.ensure_product_user(db, user=author)
                else:
                    login = self.matrix.ensure_bridge_login()
                event_id = self.matrix.send_room_message(
                    access_token=login.access_token,
                    room_id=room_binding.matrix_room_id,
                    txn_id=link.matrix_txn_id or matrix_txn_id_for_message(message.id),
                    message=message,
                )
                link.matrix_event_id = event_id
                link.send_state = "sent"
                link.last_error = None
                link.confirmed_at = utc_now()
                link.updated_at = utc_now()
                message.transport_state = "remote_confirmed"
                message.transport_error = None
                room_binding.last_event_at = utc_now()
                room_binding.updated_at = utc_now()
            except Exception as exc:
                link.send_state = "failed_remote"
                link.last_error = str(exc)
                link.updated_at = utc_now()
                message.transport_state = "failed_remote"
                message.transport_error = str(exc)

    def _sync_inbound(self, db: Session) -> None:
        sync_state = ensure_matrix_sync_state(db, worker_name=self.worker_name)
        bridge_login = self.matrix.ensure_bridge_login()
        sync_payload = self.matrix.sync(access_token=bridge_login.access_token, since=sync_state.next_batch)
        rooms = sync_payload.get("rooms", {})
        joined_rooms = rooms.get("join", {}) if isinstance(rooms, dict) else {}
        for room_id, room_payload in joined_rooms.items():
            self._ingest_room_timeline(db, room_id=room_id, room_payload=room_payload)
        sync_state.next_batch = str(sync_payload.get("next_batch") or sync_state.next_batch or "")
        sync_state.last_synced_at = utc_now()
        sync_state.last_error = None
        sync_state.updated_at = utc_now()

    def _ingest_room_timeline(self, db: Session, *, room_id: str, room_payload: dict[str, Any]) -> None:
        binding = matrix_room_binding_for_room(db, matrix_room_id=room_id)
        if binding is None:
            return
        timeline = room_payload.get("timeline", {})
        events = timeline.get("events", []) if isinstance(timeline, dict) else []
        for event in events:
            if not isinstance(event, dict) or event.get("type") != "m.room.message":
                continue
            event_id = str(event.get("event_id") or "").strip()
            if not event_id or matrix_message_link_for_event(db, matrix_event_id=event_id) is not None:
                continue
            content = event.get("content", {}) or {}
            if str(content.get("msgtype") or "") != "m.text":
                continue
            body = str(content.get("body") or "").strip()
            if not body:
                continue
            autoweave_meta = content.get("m.autoweave", {}) if isinstance(content.get("m.autoweave"), dict) else {}
            outbound_message_id = str(autoweave_meta.get("product_message_id") or "").strip()
            outbound_txn_id = str(autoweave_meta.get("product_txn_id") or "").strip()
            if outbound_message_id:
                existing_link = matrix_message_link_for_message(db, message_id=outbound_message_id)
                if existing_link is not None:
                    existing_link.matrix_event_id = event_id
                    existing_link.send_state = "confirmed"
                    existing_link.confirmed_at = utc_now()
                    existing_link.updated_at = utc_now()
                    message = db.get(Message, existing_link.message_id)
                    if message is not None:
                        message.transport_state = "remote_confirmed"
                        message.transport_error = None
                    continue
            if outbound_txn_id:
                existing_link = matrix_message_link_for_txn(db, matrix_txn_id=outbound_txn_id)
                if existing_link is not None:
                    existing_link.matrix_event_id = event_id
                    existing_link.send_state = "confirmed"
                    existing_link.confirmed_at = utc_now()
                    existing_link.updated_at = utc_now()
                    message = db.get(Message, existing_link.message_id)
                    if message is not None:
                        message.transport_state = "remote_confirmed"
                        message.transport_error = None
                    continue
            sender = str(event.get("sender") or "").strip()
            mapping = matrix_user_mapping_for_matrix_user(db, matrix_user_id=sender)
            author_user = db.get(User, mapping.user_id) if mapping is not None and mapping.user_id else None
            orbit = db.get(Orbit, binding.orbit_id)
            if orbit is None:
                continue
            message = Message(
                orbit_id=orbit.id,
                channel_id=binding.channel_id,
                dm_thread_id=binding.dm_thread_id,
                user_id=author_user.id if author_user is not None else None,
                author_kind="user" if author_user is not None else "external",
                author_name=author_user.display_name if author_user is not None else sender,
                body=body,
                metadata_json={"matrix_event_id": event_id},
                transport_state="remote_confirmed",
                transport_error=None,
            )
            db.add(message)
            db.flush()
            upsert_matrix_message_link(
                db,
                message_id=message.id,
                room_binding_id=binding.id,
                matrix_event_id=event_id,
                matrix_txn_id=outbound_txn_id or None,
                direction="inbound",
                send_state="confirmed",
                confirmed_at=utc_now(),
            )
            create_message_notifications(
                db,
                orbit=orbit,
                author_user_id=author_user.id if author_user is not None else None,
                author_name=message.author_name,
                message_id=message.id,
                body=message.body,
                channel_id=binding.channel_id,
                channel_name=db.get(Channel, binding.channel_id).name if binding.channel_id else None,
                dm_thread_id=binding.dm_thread_id,
            )
            if author_user is not None:
                mark_conversation_seen(
                    db,
                    user_id=author_user.id,
                    orbit_id=orbit.id,
                    channel_id=binding.channel_id,
                    dm_thread_id=binding.dm_thread_id,
                    last_seen_message_id=message.id,
                )
            binding.last_event_at = utc_now()
            binding.updated_at = utc_now()
