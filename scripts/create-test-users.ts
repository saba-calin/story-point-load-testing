const BASE_URL = 'https://api.story-point.xyz';
const NUM_USERS = parseInt(process.argv[2] || '100', 10);
const PASSWORD = 'loadtest1234';

interface UserToken {
  username: string;
  token: string;
}

async function createUser(id: number): Promise<UserToken | null> {
  const timestamp = Date.now();
  const username = `loadtest-${timestamp}-${id}`;
  const email = `${username}@loadtest.xyz`;

  const res = await fetch(`${BASE_URL}/auth/sign-up`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Origin': 'https://story-point.xyz',
      'Referer': 'https://story-point.xyz/',
    },
    body: JSON.stringify({
      firstName: 'Load',
      lastName: `Test${id}`,
      username,
      email,
      password: PASSWORD,
    }),
  });

  if (res.status !== 201) {
    console.error(`Failed to create user ${username}: ${res.status} ${await res.text()}`);
    return null;
  }

  const cookies = res.headers.getSetCookie();
  const accessCookie = cookies.find((c) => c.startsWith('sp-access='));
  if (!accessCookie) {
    console.error(`No access token cookie for ${username}`);
    return null;
  }

  const token = accessCookie.split('=')[1].split(';')[0];
  console.log(`Created user ${id + 1}/${NUM_USERS}: ${username}`);
  return { username, token };
}

async function main(): Promise<void> {
  console.log(`Creating ${NUM_USERS} test users...`);

  const tokens: UserToken[] = [];
  const batchSize = 10;

  for (let i = 0; i < NUM_USERS; i += batchSize) {
    const batch = Array.from({ length: Math.min(batchSize, NUM_USERS - i) }, (_, j) => createUser(i + j));
    const results = await Promise.all(batch);
    for (const result of results) {
      if (result) tokens.push(result);
    }
  }

  const fs = await import('fs');
  const path = await import('path');
  const outPath = path.resolve(process.cwd(), 'data', 'tokens.json');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(tokens, null, 2));

  console.log(`\nDone! ${tokens.length}/${NUM_USERS} users created.`);
  console.log(`Tokens written to ${outPath}`);
}

main().catch(console.error);
