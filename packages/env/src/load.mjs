// 코드 맨 위에서 한 줄로: `import '@vault/env/load'`  (dotenv의 `import 'dotenv/config'` 자리)
// .env.age를 풀어 process.env에 넣는다. 파일이 없으면 조용히 넘어간다: 배포 환경에는 .env.age가 없고 환경변수가 직접 들어온다.
import { existsSync } from 'node:fs';
import { loadEnvAge } from './index.mjs';

const file = process.env.VAULT_ENV_FILE ?? '.env.age';
if (existsSync(file)) await loadEnvAge({ file });
