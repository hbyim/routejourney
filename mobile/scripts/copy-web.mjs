// 저장소 루트의 웹앱 파일을 www/ 로 복사한다. 앱은 이 복사본을 기기 안에 담아 실행한다.
import { cpSync, rmSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const www = join(root, 'mobile', 'www');
rmSync(www, { recursive: true, force: true });
mkdirSync(www);
for (const f of ['index.html', 'manifest.webmanifest', 'css', 'js', 'assets', 'vendor']) {
  cpSync(join(root, f), join(www, f), { recursive: true });
}
console.log('copied web app to', www);
