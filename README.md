# 루트로그 (RouteLog)

여행 중 스팟마다 올린 포스팅이 시간순 **여행가이드**가 되고, 공유받은 사람이 그 가이드를 **따라가거나 포크(리믹스)** 해서 루트·쇼핑·가게를 더해 다시 공유하는 여행 SNS입니다.

배포: https://hbyim.github.io/routejourney/ (main에 푸시하면 Actions가 gh-pages로 옮겨 자동 배포)

## 두 가지 모드

| 모드 | 조건 | 데이터 |
| --- | --- | --- |
| 체험 모드 | `js/config.js` 의 Supabase 키가 비어 있음 | 브라우저 localStorage, 도쿄 샘플 데이터, 공유는 URL에 가이드를 압축해 전달 |
| 서비스 모드 | `supabaseUrl`, `supabaseAnonKey` 입력 | Supabase 인증·DB·사진 저장소, 공유는 가이드 주소 |

## 서비스 모드 켜기

1. [Supabase](https://supabase.com)에서 프로젝트를 만듭니다 (리전: 서울 `ap-northeast-2` 권장).
2. SQL Editor 에 `supabase/schema.sql` 전체를 붙여넣고 실행합니다. 테이블, 행 단위 보안(RLS), 사진 버킷, 트리거가 만들어집니다.
3. Authentication > URL Configuration 에서 Site URL 과 Redirect URLs 에 배포 주소(예: `https://hbyim.github.io/routejourney/`)를 넣습니다.
4. Authentication > Emails 에서 SMTP(예: Resend, AWS SES)를 연결합니다. 기본 메일 발송은 시간당 몇 통으로 제한돼 실서비스에 쓸 수 없습니다.
5. Project Settings > API 의 Project URL 과 anon public key 를 `js/config.js` 에 넣고 main에 푸시합니다.
6. (선택) Google·Kakao 로그인: Authentication > Providers 에서 켜고 `config.js` 의 `auth` 를 `true` 로 바꿉니다.

## 운영

- **신고 처리**: Table Editor > `reports`. 서로 다른 3명이 신고한 포스팅·가이드는 자동으로 `hidden = true` 가 됩니다. 검토 후 복구하려면 해당 행의 `hidden` 을 `false` 로, 신고는 `status` 를 `resolved`/`rejected` 로 바꿉니다.
- **사용자 차단·탈퇴**: 앱에서 직접 처리됩니다. 탈퇴하면 계정, 게시물, 사진이 즉시 삭제됩니다.
- **백업**: Supabase 유료 플랜의 일일 백업(PITR)을 켜세요.

## 구조

```
index.html              앱 셸 (CSP, OG 태그, PWA 매니페스트)
css/style.css           반응형 스타일, 다크 모드
js/config.js            서비스 설정 (Supabase 키, 지도 타일, 운영자 정보)
js/app.js               라우터, 화면, 이벤트
js/cloud.js             Supabase 연동 (읽기 캐시, 쓰기 큐)
js/legal.js             이용약관, 개인정보처리방침, 위치기반서비스 약관 초안
js/seed.js              체험 모드 샘플 데이터
sw.js                   오프라인 앱 셸 캐시
supabase/schema.sql     DB 스키마, RLS, 트리거, 저장소 정책
vendor/                 Leaflet 1.9.4, supabase-js 2.45.4
```

로컬 실행: `python3 -m http.server` 후 http://localhost:8000
