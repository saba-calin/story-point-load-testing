import http from 'k6/http';
import { check, sleep } from 'k6';
import { Options } from 'k6/options';
import { generateHtmlReport } from './html-report';

export const options: Options = {
  scenarios: {
    constant_load: {
      executor: 'constant-arrival-rate',
      rate: 1000,
      timeUnit: '1s',
      duration: '10s',
      preAllocatedVUs: 1000,
    },
  },
};

export default function (): void {
  const payload = JSON.stringify({ name: 'test' });
  const jar = http.cookieJar();
  jar.set('https://api.story-point.xyz', 'sp-access', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VybmFtZSI6InNhYmEiLCJlbWFpbCI6InNhYmFAZ21haWwuY29tIiwiZmlyc3ROYW1lIjoic2FiYSIsImxhc3ROYW1lIjoic2FiYSIsInJvbGUiOiJ1c2VyIiwiaWF0IjoxNzc3MTQ3NDYwLCJleHAiOjE3NzcxNDgzNjB9.70Z2orw3ABAiGLSpCmFqAuO00F8FL27xYAp0-bZ5kHg');

  const params = {
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/plain, */*',
      'Accept-Language': 'en-US,en;q=0.9',
      'Origin': 'https://story-point.xyz',
      'Referer': 'https://story-point.xyz/',
      'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
      'sec-ch-ua': '"Not(A:Brand";v="99", "Google Chrome";v="133", "Chromium";v="133"',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"Linux"',
      'sec-fetch-dest': 'empty',
      'sec-fetch-mode': 'cors',
      'sec-fetch-site': 'same-site',
      'Priority': 'u=1, i',
    },
  };

  const res = http.post('https://api.story-point.xyz/create-room', payload, params);

  check(res, {
    'status is 201': (r) => r.status === 201,
    'has roomId': (r) => JSON.parse(r.body as string).roomId !== undefined,
    'status is OPEN': (r) => JSON.parse(r.body as string).status === 'OPEN',
  });
}

export function handleSummary(data: any): Record<string, string> {
  return {
    'reports/create-room-test.html': generateHtmlReport(data),
  };
}
