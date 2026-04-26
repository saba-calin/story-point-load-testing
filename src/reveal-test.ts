import http from 'k6/http';
import { check, sleep } from 'k6';
import { Options } from 'k6/options';
import ws from 'k6/ws';
import exec from 'k6/execution';
import { SharedArray } from 'k6/data';

const BASE_URL = 'https://api.story-point.xyz';
const WS_URL = 'wss://ws.story-point.xyz';
const ROOM_SIZE = 100;
const VOTERS_PER_ROOM = 5;

const tokens = new SharedArray('tokens', () => {
  return JSON.parse(open('../data/tokens.json')) as Array<{ username: string; token: string }>;
});

const httpParams = {
  headers: {
    'Content-Type': 'application/json',
    'Accept': 'application/json, text/plain, */*',
    'Origin': 'https://story-point.xyz',
    'Referer': 'https://story-point.xyz/',
  },
};

const numRooms = Math.ceil(tokens.length / ROOM_SIZE);

export const options: Options = {
  setupTimeout: `${numRooms * 3}s`,
  scenarios: {
    reveal_load: {
      executor: 'per-vu-iterations',
      vus: tokens.length,
      iterations: 1,
      startTime: '0s',
      maxDuration: '120s',
    },
  },
};

interface Room {
  roomId: string;
  storyId: string;
}

export function setup(): { rooms: Room[]; startTime: number } {
  const rooms: Room[] = [];

  for (let r = 0; r < numRooms; r++) {
    const ownerIndex = r * ROOM_SIZE;
    const ownerToken = tokens[ownerIndex].token;
    const jar = http.cookieJar();
    jar.set(BASE_URL, 'sp-access', ownerToken);

    const createRes = http.post(BASE_URL + '/create-room', JSON.stringify({ name: `reveal-test-room-${r}` }), httpParams);
    check(createRes, { 'room created': (res) => res.status === 201 });
    const roomId = JSON.parse(createRes.body as string).roomId;

    let storyId = '';

    const wsRes = ws.connect(WS_URL, { headers: { cookie: `sp-access=${ownerToken}` } }, (socket) => {
      socket.on('open', () => {
        socket.send(JSON.stringify({ action: 'join-room', roomId, profilePictureKey: '' }));
      });

      socket.on('message', (msg: string) => {
        const data = JSON.parse(msg);

        if (data.action === 'roomJoined') {
          socket.send(
            JSON.stringify({ action: 'create-story', roomId, name: 'Reveal Test Story', description: 'Reveal load test' }),
          );
        }
        if (data.action === 'storyCreated') {
          storyId = data.story.storyId;
          socket.send(JSON.stringify({ action: 'set-active-story', roomId, storyId }));
        }
        if (data.action === 'storySetActive') {
          socket.close();
        }
      });

      socket.setTimeout(() => socket.close(), 10000);
    });

    check(wsRes, { 'ws setup connected': (res) => res.status === 101 });

    rooms.push({ roomId, storyId });
    console.log(`Room ${r + 1}/${numRooms} created: https://story-point.xyz/room/${roomId}`);
  }

  return { rooms, startTime: Date.now() };
}

const VOTE_AT_S = 30;

export default function (data: { rooms: Room[]; startTime: number }): void {
  const { rooms, startTime } = data;
  const vuIndex = (exec.vu.idInTest - 1) % tokens.length;
  const { token } = tokens[vuIndex];

  const roomIndex = Math.floor(vuIndex / ROOM_SIZE);
  const positionInRoom = vuIndex % ROOM_SIZE;
  const { roomId, storyId } = rooms[roomIndex];

  const isOwner = positionInRoom === 0;
  const isVoter = positionInRoom >= 1 && positionInRoom <= VOTERS_PER_ROOM;

  sleep(vuIndex / 300);

  const jar = http.cookieJar();
  jar.set('https://ws.story-point.xyz', 'sp-access', token);

  let estimationCorrect = false;

  const res = ws.connect(WS_URL, { jar }, (socket) => {
    let votedCount = 0;

    const scheduleAt = (targetS: number, fn: () => void) => {
      const elapsed = (Date.now() - startTime) / 1000;
      const delay = Math.max(0, targetS - elapsed) * 1000;
      socket.setTimeout(fn, delay);
    };

    socket.on('open', () => {
      socket.send(JSON.stringify({ action: 'join-room', roomId, profilePictureKey: '' }));
    });

    socket.on('message', (msg: string) => {
      const parsed = JSON.parse(msg);

      if (parsed.action === 'roomJoined' && isVoter) {
        scheduleAt(VOTE_AT_S + Math.random() * 3, () => {
          socket.send(JSON.stringify({ action: 'vote', roomId, storyId, voteValue: '21' }));
        });
      }

      if (parsed.action === 'playerVoted') {
        votedCount++;
        if (isOwner && votedCount === VOTERS_PER_ROOM) {
          socket.send(JSON.stringify({ action: 'reveal', roomId, storyId }));
        }
      }

      if (parsed.action === 'votesRevealed') {
        estimationCorrect = parsed.storyEstimationRounded === '21';
        socket.setTimeout(() => socket.close(), 1 + Math.random() * 999);
      }

      if (parsed.action === 'error') {
        console.error(`WS error: ${parsed.message}`);
        socket.close();
      }
    });

    socket.on('error', (e) => {
      console.error(`WS connection error: ${e.error()}`);
    });

    socket.setTimeout(() => {
      socket.close();
    }, 90000);
  });

  check(res, {
    'ws connected': (r) => r.status === 101,
    'estimation is 21': () => estimationCorrect,
  });
}
