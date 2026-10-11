# 출시 전 체크리스트

코드로 처리할 수 있는 것은 모두 들어가 있습니다. 아래는 운영자 계정, 계약, 법적 절차가 필요해 직접 하셔야 하는 일입니다.

## 꼭 필요한 것

- [ ] Supabase 프로젝트 생성, `supabase/schema.sql` 실행, URL·anon key를 `js/config.js`에 입력 (README의 "서비스 모드 켜기")
- [ ] Supabase Email 설정: Confirm email 끄기, 최소 비밀번호 길이 10, Letters and digits
- [ ] 비밀번호 재설정 메일 발송용 SMTP 연결 (Resend, AWS SES 등)
- [ ] (권장) 가입 봇 차단용 CAPTCHA (Supabase Auth의 Cloudflare Turnstile 연동)
- [ ] 상용 지도 타일 키 발급 후 `config.js`의 `tileUrl` 교체 (MapTiler, Stadia Maps 등). OpenStreetMap 기본 타일은 상용 트래픽에 쓸 수 없습니다.
- [ ] 사업자등록, `config.js`의 `operator` 정보(상호, 대표자, 사업자번호, 주소, 문의 메일, 개인정보 보호책임자) 입력
- [ ] 위치기반서비스사업 신고 (방송통신위원회, "현재 위치" 기능 때문에 필요). 신고 전이라면 `현재 위치` 버튼을 숨기는 방법도 있습니다.
- [ ] `js/legal.js` 약관·방침 초안 법률 검토 후 `legalEffectiveDate` 확정
- [ ] 도메인 구입 후 GitHub Pages 커스텀 도메인 연결 (Settings > Pages), Supabase Redirect URL과 `index.html`의 og:url·og:image 주소를 새 도메인으로 교체, `404.html`의 경로 수정

## 권장

- [ ] Supabase 유료 플랜(백업, 사용량 한도 해제)
- [ ] Google·Kakao 로그인 앱 등록
- [ ] 오류 수집(Sentry 등)과 방문 분석 도구. 도입하면 개인정보처리방침의 위탁 항목에 추가해야 합니다.
- [ ] 신고 처리 담당자와 처리 기준(응답 기한) 정하기
- [ ] 앱스토어 출시가 필요하면 PWA를 감싸는 네이티브 앱(Capacitor 등) 검토
