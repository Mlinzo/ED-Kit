"""Other players right now, from EDDN (https://github.com/EDCD/EDDN).

The EDDN relay rebroadcasts what players' tools (EDMC, EDDiscovery, ...) upload from their
journals. A message carrying a system's position means someone is there: they arrived, scanned
something, logged a codex entry, docked. Only players running such a tool are seen.

No commander names travel through EDDN, and the relay obfuscates the uploader id: a hash with a
nonce it replaces every 3 minutes, so the same player gets a new id every 3 minutes (on purpose:
nobody can follow a player for longer). Within those 3 minutes ids tell players apart: an id is
shown once, where it was seen last; players are counted per 3-minute epoch (never adding up the
ids of several, which would count everyone several times); a player who moved since the last
change of ids has a second, older dot. Some players run two tools that upload under different
ids: two ids that keep sending the same events are taken for one player, and an event already
counted is not counted again. Ids live in memory only and are forgotten with the window.

The relay sends everything (~20 messages, ~20 KiB a second at busy times) and cannot filter, so
the app listens only while someone has the live layer open (the view is being asked for) and
hangs up a couple of minutes after the last request.
"""

from __future__ import annotations

import json
import logging
import re
import threading
import time
import zlib
from bisect import bisect_right
from collections import Counter, deque
from collections.abc import Callable, Iterable
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any, Literal, Protocol

from app import exobio
from app.schemas import LiveSystemView, LiveView

log = logging.getLogger(__name__)

RELAY = "tcp://eddn.edcd.io:9500"
SCHEMAS = "https://eddn.edcd.io/schemas/"
WINDOW_S = 5 * 60  # what the map shows: who is around now
EPOCH_S = 180  # the relay's ids change this often (its REGENERATE_UPLOADER_NONCE_INTERVAL)
KEEP_S = 7 * 60  # signs kept: the map's window and the last full stretch of ids before it
RECENT_S = 30  # the ids heard this recently all began with the current epoch
IDLE_S = 120  # hang up this long after the last request
PUSH_S = 15  # how often watchers are asked to refetch while new signs come in
STALE_S = 15 * 60  # older uploads (a tool sending a backlog) do not say where anyone is now
SILENCE_S = 90  # no message for this long: reconnect
RETRY_S = 15
# Two ids are one player once they sent this many of the same events (not arrivals: a wing jumps
# into a system in the same second).
SAME_AFTER = 2

ARRIVALS = frozenset({"FSDJump", "Location", "CarrierJump"})
DOCKING = frozenset({"Docked", "ApproachSettlement"})

Kind = Literal["arrived", "scan", "codex", "docked"]
State = Literal["off", "connecting", "live"]


@dataclass(frozen=True, slots=True)
class Sign:
    """Someone was in this system: one EDDN message."""

    at: float  # when it came in (our clock, epoch seconds)
    address: int
    name: str
    x: float
    y: float
    z: float
    uploader: str
    kind: Kind
    codex: str | None = None  # the codex entry's name
    carriers: tuple[str, ...] = ()  # fleet carriers among the signals they scanned
    event: tuple[str, ...] = ()  # what the message says happened, to spot the same one twice


def _time(value: Any) -> datetime | None:
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None


def codex_name(symbol: Any) -> str | None:
    """English name of a codex entry: "Stratum Tectonicas", "K Type"."""
    if not symbol:
        return None
    species = exobio.get_species(str(symbol))
    if species is not None:
        return species.species_name
    name = str(symbol).removeprefix("$Codex_Ent_").removesuffix(";").removesuffix("_Name")
    name = re.sub(r"(?<=[a-z])(?=[A-Z])", " ", name.replace("_", " "))  # SilicateVapourGeysers
    return " ".join(name.split()) or None


def parse(raw: bytes, now: float) -> Sign | None:
    """A relay message (zlib-compressed JSON) as a sign of someone somewhere, or None."""
    try:
        data = json.loads(zlib.decompress(raw))
    except (zlib.error, ValueError):
        return None
    if not isinstance(data, dict):
        return None
    schema = str(data.get("$schemaRef", ""))
    if not schema.startswith(SCHEMAS) or schema.endswith("/test"):
        return None
    msg = data.get("message")
    header = data.get("header")
    if not isinstance(msg, dict) or not isinstance(header, dict):
        return None
    pos, address = msg.get("StarPos"), msg.get("SystemAddress")
    name = msg.get("StarSystem") or msg.get("System")
    if not (isinstance(pos, list) and len(pos) == 3 and isinstance(address, int) and name):
        return None
    try:
        x, y, z = (float(v) for v in pos)
    except (TypeError, ValueError):
        return None
    sent, received = _time(msg.get("timestamp")), _time(header.get("gatewayTimestamp"))
    if sent and received and (received - sent).total_seconds() > STALE_S:
        return None

    event = msg.get("event")
    kind: Kind = "scan"  # FSS, bodies, signals, barycentres, nav beacons
    if event in ARRIVALS:
        kind = "arrived"
    elif event == "CodexEntry":
        kind = "codex"
    elif event in DOCKING:
        kind = "docked"
    carriers: tuple[str, ...] = ()
    if event == "FSSSignalDiscovered" and isinstance(msg.get("signals"), list):
        carriers = tuple(
            sorted(
                {
                    str(s["SignalName"])
                    for s in msg["signals"]
                    if isinstance(s, dict)
                    and s.get("SignalType") == "FleetCarrier"
                    and s.get("SignalName")
                }
            )
        )
    return Sign(
        at=now,
        address=address,
        name=str(name),
        x=x,
        y=y,
        z=z,
        uploader=str(header.get("uploaderID") or ""),
        kind=kind,
        codex=codex_name(msg.get("Name")) if kind == "codex" else None,
        carriers=carriers,
        event=(
            str(event),
            str(msg.get("timestamp")),
            str(address),
            str(msg.get("BodyID", msg.get("BodyName", ""))),
            str(msg.get("Name", "")),
            str(len(msg.get("signals") or ())),
        ),
    )


@dataclass(slots=True)
class _System:
    sign: Sign  # the latest
    players: set[str]  # seen here last
    counts: dict[str, int] = field(default_factory=dict)
    codex: list[str] = field(default_factory=list)  # newest first
    carriers: set[str] = field(default_factory=set)


class Traffic:
    """The signs of the last KEEP_S, oldest first (they come in in order), which uploader ids are
    one player, and when the relay changed the ids."""

    def __init__(self) -> None:
        self.signs: deque[Sign] = deque()
        self.messages = 0
        self._first: dict[tuple[str, ...], tuple[str, float]] = {}  # event -> (uploader, at)
        self._shared: Counter[tuple[str, str]] = Counter()  # ids that sent the same events
        self._same: dict[str, str] = {}  # id -> an id of the same player
        self._first_seen: dict[str, float] = {}  # id -> when it was first heard
        self._epochs: list[float] = []  # when the relay changed the ids (or we started listening)
        self._joined_midway = True  # the first epoch began before we started listening
        self._tracked_at = float("-inf")

    def player(self, uploader: str) -> str:
        """The id standing for this uploader's player."""
        root = uploader
        while root in self._same:
            root = self._same[root]
        while uploader != root:  # shorten the chain
            parent = self._same[uploader]
            self._same[uploader] = root
            uploader = parent
        return root

    def epoch(self, uploader: str) -> int:
        """Which stretch of 3 minutes (between two changes of ids) this id belongs to."""
        return max(0, bisect_right(self._epochs, self._first_seen.get(uploader, 0.0)) - 1)

    def _track_epochs(self, now: float) -> None:
        """Notice the relay changing the ids: the ids heard in the last RECENT_S were all first
        heard after that moment (an old id never comes back)."""
        recent = []
        for sign in reversed(self.signs):
            if sign.at < now - RECENT_S:
                break
            recent.append(self._first_seen[sign.uploader])
        if not recent:
            return
        start = min(recent)
        # The first stretch began whenever we started listening, so the first change can come
        # at any moment; after it they come EPOCH_S apart.
        gap = RECENT_S / 2 if len(self._epochs) == 1 else EPOCH_S / 2
        if not self._epochs or start > self._epochs[-1] + gap:
            self._epochs.append(start)

    def add(self, sign: Sign) -> None:
        self._first_seen.setdefault(sign.uploader, sign.at)
        if sign.at - self._tracked_at >= 5:
            self._tracked_at = sign.at
            self._track_epochs(sign.at)
        first = self._first.get(sign.event) if sign.event else None
        if first is None:
            if sign.event:
                self._first[sign.event] = (sign.uploader, sign.at)
            self.signs.append(sign)
            return
        a, b = self.player(first[0]), self.player(sign.uploader)
        if a != b and sign.kind != "arrived":
            pair = (min(a, b), max(a, b))
            self._shared[pair] += 1
            if self._shared[pair] >= SAME_AFTER:
                self._same[b] = a
        if self.player(first[0]) != self.player(sign.uploader):
            self.signs.append(sign)  # someone else, at the same second (a wing)
        # else: the same event from the player's other tool, or sent again: counted already

    def prune(self, now: float) -> None:
        start = len(self.signs)
        while self.signs and self.signs[0].at < now - KEEP_S:
            self.signs.popleft()
        if len(self.signs) == start:
            return
        self._first = {k: v for k, v in self._first.items() if v[1] >= now - KEEP_S}
        active = {sign.uploader for sign in self.signs}
        self._same = {k: v for k, v in self._same.items() if k in active or v in active}
        self._shared = Counter(
            {k: n for k, n in self._shared.items() if k[0] in active and k[1] in active}
        )
        self._first_seen = {k: v for k, v in self._first_seen.items() if k in active}
        while len(self._epochs) > 1 and self._epochs[1] <= now - KEEP_S:
            self._epochs.pop(0)
            self._joined_midway = False

    def span(self, now: float) -> int:
        """Seconds back to the oldest sign shown (0 with none)."""
        oldest = next((sign.at for sign in self.signs if sign.at >= now - WINDOW_S), None)
        return max(0, round(now - oldest)) if oldest is not None else 0

    def players(self) -> int:
        """Players heard in the last full stretch of 3 minutes between two changes of ids (the
        current one is still filling up, and a change is noticed RECENT_S late); until there is
        one, the most heard in one stretch so far."""
        per_epoch = Counter(
            e for e, _ in {(self.epoch(s.uploader), self.player(s.uploader)) for s in self.signs}
        )
        full = len(self._epochs) - 2  # the one before the current
        if full >= (1 if self._joined_midway else 0):
            return per_epoch.get(full, 0)
        return max(per_epoch.values(), default=0)

    def systems(self, now: float) -> tuple[list[LiveSystemView], int]:
        """Where each id was seen last, the latest first; and how many players there are: the
        most seen within one stretch of 3 minutes."""
        self.prune(now)
        shown = [sign for sign in self.signs if sign.at >= now - WINDOW_S]
        last: dict[str, int] = {}  # player -> system
        for sign in reversed(shown):  # newest first
            last.setdefault(self.player(sign.uploader), sign.address)
        by_address: dict[int, _System] = {}
        counted: set[tuple[str, tuple[str, ...]]] = set()
        for sign in reversed(shown):
            player = self.player(sign.uploader)
            if last[player] != sign.address:
                continue  # a stop on their way, not where they are
            if sign.event:
                if (player, sign.event) in counted:
                    continue  # sent by both tools before they were known to be one player's
                counted.add((player, sign.event))
            s = by_address.get(sign.address)
            if s is None:
                s = by_address[sign.address] = _System(sign, set())
            s.players.add(player)
            s.counts[sign.kind] = s.counts.get(sign.kind, 0) + 1
            if sign.codex and sign.codex not in s.codex and len(s.codex) < 3:
                s.codex.append(sign.codex)
            s.carriers.update(sign.carriers)
        views = [
            LiveSystemView(
                address=str(address),
                name=s.sign.name,
                x=round(s.sign.x, 1),
                y=round(s.sign.y, 1),
                z=round(s.sign.z, 1),
                age_s=max(0, round(now - s.sign.at)),
                players=_most_in_one_epoch(self, s.players),
                arrived=s.counts.get("arrived", 0),
                scans=s.counts.get("scan", 0),
                codex=s.codex,
                docked=s.counts.get("docked", 0),
                carriers=len(s.carriers),
            )
            for address, s in by_address.items()
        ]
        return views, self.players()


def _most_in_one_epoch(traffic: Traffic, players: Iterable[str]) -> int:
    """Players counted within each stretch of 3 minutes, the largest count: a player who was
    there before and after a change of ids counts once."""
    per_epoch = Counter(traffic.epoch(p) for p in players)
    return max(per_epoch.values(), default=0)


class Source(Protocol):
    def recv(self, timeout_ms: int) -> bytes | None: ...

    def close(self) -> None: ...


class _Relay:
    """A ZeroMQ subscription to the EDDN relay."""

    def __init__(self) -> None:
        import zmq  # only when someone opens the live layer

        self._zmq = zmq
        self._socket = zmq.Context.instance().socket(zmq.SUB)
        self._socket.setsockopt(zmq.SUBSCRIBE, b"")
        self._socket.setsockopt(zmq.LINGER, 0)
        self._socket.connect(RELAY)

    def recv(self, timeout_ms: int) -> bytes | None:
        if self._socket.poll(timeout_ms, self._zmq.POLLIN):
            return self._socket.recv()
        return None

    def close(self) -> None:
        self._socket.close(0)


class LiveListener:
    """Listens to EDDN on a worker thread while the view is asked for; `on_change` asks the
    watchers to refetch."""

    def __init__(
        self,
        on_change: Callable[[], None],
        connect: Callable[[], Source] = _Relay,
        clock: Callable[[], float] = time.time,
    ) -> None:
        self.on_change = on_change
        self.connect = connect
        self.clock = clock
        self._lock = threading.Lock()
        self._traffic = Traffic()
        self._state: State = "off"
        self._since: float | None = None
        self._wanted_at = float("-inf")
        self._wake = threading.Event()
        self._thread: threading.Thread | None = None

    def view(self) -> LiveView:
        """The live view; asking for it keeps the listener connected (or connects it)."""
        now = self.clock()
        with self._lock:
            self._wanted_at = now
            if self._thread is None:
                self._thread = threading.Thread(target=self._run, name="eddn", daemon=True)
                self._thread.start()
            self._wake.set()
            systems, players = self._traffic.systems(now)
            return LiveView(
                available=True,
                state=self._state,
                since=datetime.fromtimestamp(self._since, UTC).isoformat()
                if self._since is not None
                else None,
                window_min=WINDOW_S // 60,
                span_s=self._traffic.span(now),
                players=players,
                systems=systems,
            )

    def _wanted(self) -> bool:
        with self._lock:
            return self.clock() - self._wanted_at < IDLE_S

    def _set_state(self, state: State) -> None:
        with self._lock:
            changed = self._state != state
            self._state = state
            if state == "off":
                self._since = None
            elif self._since is None:
                self._since = self.clock()
        if changed:
            self.on_change()

    def _run(self) -> None:
        while True:
            self._wake.wait()
            self._wake.clear()
            while self._wanted():
                try:
                    self._listen()
                except Exception:  # noqa: BLE001 - never kill the worker
                    log.warning("EDDN listener failed; retrying", exc_info=True)
                    time.sleep(RETRY_S)
            self._set_state("off")

    def _listen(self) -> None:
        self._set_state("connecting")
        source = self.connect()
        log.info("listening to EDDN")
        last_message = last_push = self.clock()
        fresh = False
        try:
            while self._wanted():
                raw = source.recv(1000)
                now = self.clock()
                if raw is None:
                    if now - last_message > SILENCE_S:
                        log.info("EDDN silent for %d s; reconnecting", SILENCE_S)
                        self._set_state("connecting")
                        return
                else:
                    last_message = now
                    sign = parse(raw, now)
                    with self._lock:
                        self._traffic.messages += 1
                        if sign is not None:
                            self._traffic.add(sign)
                            fresh = True
                    self._set_state("live")
                if fresh and now - last_push >= PUSH_S:
                    with self._lock:
                        self._traffic.prune(now)
                    fresh = False
                    last_push = now
                    self.on_change()
        finally:
            source.close()
            log.info("stopped listening to EDDN")


def offline_view() -> LiveView:
    return LiveView(
        available=False,
        state="off",
        since=None,
        window_min=WINDOW_S // 60,
        span_s=0,
        players=0,
        systems=[],
    )
