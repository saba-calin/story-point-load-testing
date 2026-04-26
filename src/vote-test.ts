import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter } from 'k6/metrics';
import { Options } from 'k6/options';
import ws from 'k6/ws';
import exec from 'k6/execution';
import { SharedArray } from 'k6/data';

const votesSentCounter = new Counter('votes_sent');
const votesConfirmedCounter = new Counter('votes_confirmed');

const BASE_URL = 'https://api.story-point.xyz';
const WS_URL = 'wss://ws.story-point.xyz';
const VALID_VOTES = ['1', '2', '3', '5', '8', '13', '21', '?'];
const TEST_DURATION_S = 15;
const ROOM_SIZE = 5;

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
    vote_load: {
      executor: 'per-vu-iterations',
      vus: tokens.length,
      iterations: 1,
      startTime: '0s',
      maxDuration: `${TEST_DURATION_S + 60}s`,
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

    const createRes = http.post(BASE_URL + '/create-room', JSON.stringify({ name: `load-test-room-${r}` }), httpParams);
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
            JSON.stringify({ action: 'create-story', roomId, name: 'Load Test Story', description: 'Vote load test' }),
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

export default function (data: { rooms: Room[]; startTime: number }): void {
  const { rooms, startTime } = data;
  const vuIndex = (exec.vu.idInTest - 1) % tokens.length;
  const { token } = tokens[vuIndex];

  const roomIndex = Math.floor(vuIndex / ROOM_SIZE);
  const { roomId, storyId } = rooms[roomIndex];

  sleep(vuIndex / 300);

  const jar = http.cookieJar();
  jar.set('https://ws.story-point.xyz', 'sp-access', token);

  const username = tokens[vuIndex].username;
  let votesSent = 0;
  let votesConfirmed = 0;

  const res = ws.connect(WS_URL, { jar }, (socket) => {
    let joined = false;

    const sendVote = () => {
      const vote = VALID_VOTES[Math.floor(Math.random() * VALID_VOTES.length)];
      socket.send(JSON.stringify({ action: 'vote', roomId, storyId, voteValue: vote }));
      votesSent++;
      votesSentCounter.add(1);
    };

    const scheduleNextVote = () => {
      const delay = 100 + Math.random() * 900;
      socket.setTimeout(() => {
        if (!joined) return;
        const elapsed = (Date.now() - startTime) / 1000;
        if (elapsed >= TEST_DURATION_S) {
          socket.setTimeout(() => socket.close(), 10000);
          return;
        }
        sendVote();
        scheduleNextVote();
      }, delay);
    };

    socket.on('open', () => {
      socket.send(JSON.stringify({ action: 'join-room', roomId, profilePictureKey: '' }));
    });

    socket.on('message', (msg: string) => {
      const parsed = JSON.parse(msg);

      if (parsed.action === 'roomJoined') {
        joined = true;
        scheduleNextVote();
      }

      if (parsed.action === 'playerVoted' && parsed.vote?.username === username) {
        check(parsed.vote, {
          'vote roomId matches': (v: any) => v.roomId === roomId,
          'vote storyId matches': (v: any) => v.storyId === storyId,
          'vote username matches': (v: any) => v.username === username,
        });
        votesConfirmed++;
        votesConfirmedCounter.add(1);
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
    }, (TEST_DURATION_S + 30) * 1000);
  });

  check(res, {
    'ws connected': (r) => r.status === 101,
    'all votes confirmed': () => votesConfirmed === votesSent,
  });
}
