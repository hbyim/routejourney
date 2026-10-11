/*
 * 루트로그 설정
 * supabaseUrl 과 supabaseAnonKey 를 채우면 실서비스 모드(회원가입, 서버 저장, 사진 업로드)로 동작합니다.
 * 비워두면 지금처럼 브라우저에만 저장하는 체험 모드로 동작합니다.
 * anon key 는 공개용 키라서 이 파일에 넣어 배포해도 됩니다. service_role 키는 절대 넣지 마세요.
 */
window.RL_CONFIG = {
  supabaseUrl: '',
  supabaseAnonKey: '',

  // 로그인 수단
  auth: { email: true, google: false, kakao: false },

  // 지도 타일. OpenStreetMap 기본 타일은 상용 트래픽에 쓸 수 없으니 출시 전 상용 타일 키로 바꾸세요.
  // 예: 'https://api.maptiler.com/maps/streets-v2/{z}/{x}/{y}.png?key=YOUR_KEY'
  tileUrl: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
  tileAttribution: '&copy; OpenStreetMap',

  // 운영자 정보: 약관, 개인정보처리방침, 화면 하단에 표시됩니다.
  operator: {
    serviceName: '루트로그',
    companyName: '',          // 상호
    ceo: '',                  // 대표자
    businessNumber: '',       // 사업자등록번호
    mailOrderNumber: '',      // 통신판매업 신고번호 (유료 기능 도입 시)
    locationBusinessNumber: '', // 위치기반서비스사업 신고번호
    address: '',
    email: '',                // 고객 문의 및 신고 접수
    privacyOfficer: '',       // 개인정보 보호책임자 이름
    privacyEmail: ''
  },
  legalEffectiveDate: '2026-11-01'
};
