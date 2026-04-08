from __future__ import annotations

from types import SimpleNamespace

from sqlalchemy import select

from autoweave_web.core.settings import get_settings
from autoweave_web.db.session import Base, db_session, get_engine, reset_database_state
from autoweave_web.models.entities import Channel, MatrixMessageLink, MatrixRoomBinding, Message, Orbit, OrbitMembership, User
from autoweave_web.services.matrix import MatrixSyncBridge
from autoweave_web.services.product_state import ensure_matrix_sync_state, ensure_matrix_user_mapping


class FakeMatrixService:
    def __init__(self) -> None:
        self.sent: list[dict[str, str]] = []
        self.sync_payload: dict = {"next_batch": "batch_1", "rooms": {"join": {}}}

    def ensure_bridge_login(self):
        return SimpleNamespace(access_token="bridge-token", user_id="@bridge:autoweave.local", device_id="DEVICE")

    def send_room_message(self, *, access_token: str, room_id: str, txn_id: str, message: Message) -> str:
        self.sent.append({"room_id": room_id, "txn_id": txn_id, "message_id": message.id, "body": message.body})
        return f"${txn_id}"

    def sync(self, *, access_token: str, since: str | None = None) -> dict:
        return self.sync_payload


class FakeProvisioning:
    def __init__(self) -> None:
        self.ensure_user_calls: list[str] = []

    def ensure_product_user(self, db, *, user):
        self.ensure_user_calls.append(user.id)
        mapping = ensure_matrix_user_mapping(
            db,
            user_id=user.id,
            matrix_user_id=f"@{user.github_login}:autoweave.local",
            matrix_localpart=user.github_login,
            latest_device_id="DEVICE",
        )
        return SimpleNamespace(access_token=f"token-{user.id}", user_id=mapping.matrix_user_id, device_id="DEVICE")


def _seed_channel_message() -> dict[str, str]:
    with db_session() as db:
        user = User(
            github_login="octocat",
            github_user_id="101",
            email="octo@example.com",
            display_name="Octo Cat",
            avatar_url=None,
            access_token="ghp_token",
        )
        db.add(user)
        db.flush()
        orbit = Orbit(
            slug="orbit-matrix",
            name="Orbit Matrix",
            description="Matrix bridge test",
            created_by_user_id=user.id,
        )
        db.add(orbit)
        db.flush()
        db.add(OrbitMembership(orbit_id=orbit.id, user_id=user.id, role="owner"))
        channel = Channel(orbit_id=orbit.id, slug="general", name="general")
        db.add(channel)
        db.flush()
        message = Message(
            orbit_id=orbit.id,
            channel_id=channel.id,
            user_id=user.id,
            author_kind="user",
            author_name=user.display_name,
            body="hello matrix",
            transport_state="pending_remote",
        )
        db.add(message)
        db.flush()
        binding = MatrixRoomBinding(
            orbit_id=orbit.id,
            channel_id=channel.id,
            matrix_room_id="!room:autoweave.local",
            room_kind="channel",
        )
        db.add(binding)
        db.flush()
        link = MatrixMessageLink(
            message_id=message.id,
            room_binding_id=binding.id,
            matrix_txn_id=f"aw-{message.id}",
            direction="outbound",
            send_state="queued",
        )
        db.add(link)
        return {
            "orbit_id": orbit.id,
            "user_id": user.id,
            "channel_id": channel.id,
            "message_id": message.id,
        }


def _reset_db() -> None:
    reset_database_state()
    engine = get_engine()
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)


def test_matrix_bridge_confirms_outbound_messages() -> None:
    _reset_db()
    settings = get_settings()
    matrix = FakeMatrixService()
    provisioning = FakeProvisioning()
    seeded = _seed_channel_message()
    bridge = MatrixSyncBridge(settings, matrix, provisioning)

    bridge.run_once()

    with db_session() as db:
        saved_message = db.get(Message, seeded["message_id"])
        link = db.scalar(select(MatrixMessageLink).where(MatrixMessageLink.message_id == seeded["message_id"]))
        assert saved_message is not None
        assert saved_message.transport_state == "remote_confirmed"
        assert link is not None
        assert link.matrix_event_id == f"${link.matrix_txn_id}"
        assert link.send_state == "sent"
        assert matrix.sent[0]["message_id"] == seeded["message_id"]


def test_matrix_bridge_ingests_inbound_events_once_and_tracks_sync_cursor() -> None:
    _reset_db()
    settings = get_settings()
    settings.matrix_sync_enabled = True
    settings.feature_flags = ",".join(
        filter(None, [settings.feature_flags, "ff_matrix_sync_ingest_v1"])
    )
    matrix = FakeMatrixService()
    provisioning = FakeProvisioning()
    seeded = _seed_channel_message()
    bridge = MatrixSyncBridge(settings, matrix, provisioning)

    with db_session() as db:
        user = db.get(User, seeded["user_id"])
        assert user is not None
        ensure_matrix_user_mapping(
            db,
            user_id=user.id,
            matrix_user_id=f"@{user.github_login}:autoweave.local",
            matrix_localpart=user.github_login,
        )

    matrix.sync_payload = {
        "next_batch": "batch_2",
        "rooms": {
            "join": {
                "!room:autoweave.local": {
                    "timeline": {
                        "events": [
                            {
                                "type": "m.room.message",
                                "event_id": "$event1",
                                "sender": "@octocat:autoweave.local",
                                "content": {"msgtype": "m.text", "body": "hello from matrix"},
                            },
                            {
                                "type": "m.room.message",
                                "event_id": "$event1",
                                "sender": "@octocat:autoweave.local",
                                "content": {"msgtype": "m.text", "body": "hello from matrix"},
                            },
                        ]
                    }
                }
            }
        },
    }

    bridge.run_once()

    with db_session() as db:
        messages = db.scalars(
            select(Message).where(Message.orbit_id == seeded["orbit_id"], Message.channel_id == seeded["channel_id"]).order_by(Message.created_at)
        ).all()
        sync_state = ensure_matrix_sync_state(db, worker_name="matrix-bridge")
        assert len([item for item in messages if item.body == "hello from matrix"]) == 1
        assert sync_state.next_batch == "batch_2"
