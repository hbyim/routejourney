/* 샘플 데이터: 도쿄 런칭 시나리오. 첫 실행 때만 localStorage에 들어갑니다. */
window.RL_SEED = function () {
  const users = {
    u_jiwoo: { id: 'u_jiwoo', name: '지우', bio: '사진 한 장, 한 줄 기록파', color: '#0f766e', sample: true },
    u_minjun: { id: 'u_minjun', name: '민준', bio: '남의 루트 가져와서 고쳐 쓰는 계획러', color: '#b45309', sample: true },
    u_sakura: { id: 'u_sakura', name: '사쿠라', bio: '도쿄 사는 로컬 큐레이터', color: '#be185d', sample: true },
    u_me: { id: 'u_me', name: '나', bio: '', color: '#2563eb' }
  };

  const S = (id, name, cat, lat, lng, area) => ({ id, name, cat, lat, lng, area });
  const spots = {};
  [
    S('s_sensoji', '센소지', 'sight', 35.7148, 139.7967, '아사쿠사'),
    S('s_nakamise', '나카미세도리', 'shop', 35.7118, 139.7963, '아사쿠사'),
    S('s_melonpan', '아사쿠사 멜론빵 가게', 'cafe', 35.7136, 139.7952, '아사쿠사'),
    S('s_skytree', '도쿄 스카이트리', 'sight', 35.7101, 139.8107, '오시아게'),
    S('s_ameyoko', '아메요코 시장', 'shop', 35.7100, 139.7745, '우에노'),
    S('s_tsukiji', '츠키지 장외시장 해산물 덮밥집', 'food', 35.6655, 139.7707, '츠키지'),
    S('s_ginza', '긴자 거리', 'shop', 35.6717, 139.7650, '긴자'),
    S('s_meiji', '메이지 신궁', 'sight', 35.6764, 139.6993, '하라주쿠'),
    S('s_takeshita', '다케시타 거리', 'shop', 35.6716, 139.7031, '하라주쿠'),
    S('s_omotesando', '오모테산도', 'shop', 35.6654, 139.7121, '오모테산도'),
    S('s_scramble', '시부야 스크램블 교차로', 'sight', 35.6595, 139.7005, '시부야'),
    S('s_shibuyasky', '시부야 스카이 전망대', 'sight', 35.6585, 139.7023, '시부야'),
    S('s_omoide', '오모이데 요코초 꼬치집', 'food', 35.6931, 139.6995, '신주쿠'),
    S('s_shimokita', '시모키타자와 빈티지 숍 거리', 'shop', 35.6616, 139.6680, '시모키타자와'),
    S('s_teamlab', '팀랩 플래닛', 'sight', 35.6491, 139.7898, '도요스'),
    S('s_nakameguro', '나카메구로 강변 카페', 'cafe', 35.6440, 139.6990, '나카메구로'),
    S('s_gyoen', '신주쿠 교엔', 'sight', 35.6852, 139.7101, '신주쿠'),
    S('s_hotel', '시부야 숙소', 'stay', 35.6580, 139.6980, '시부야')
  ].forEach(s => { spots[s.id] = s; });

  const posts = {};
  const P = (id, userId, spotId, at, text, rating, cost, tags) => {
    posts[id] = { id, userId, spotId, at, text, rating, cost, tags: tags || [], photo: null };
  };
  // 지우의 원본 여행
  P('p1', 'u_jiwoo', 's_sensoji', '2026-09-12T09:30:00+09:00', '아침 9시 반에 가니 사람 적고 빛이 예뻐요. 오미쿠지는 100엔.', 5, 100, ['아침추천']);
  P('p2', 'u_jiwoo', 's_nakamise', '2026-09-12T10:20:00+09:00', '기념품은 여기서. 닌교야키 꼭 드세요.', 4, 800, ['간식']);
  P('p3', 'u_jiwoo', 's_melonpan', '2026-09-12T11:00:00+09:00', '갓 구운 멜론빵, 줄은 10분 정도.', 4, 300, ['빵']);
  P('p4', 'u_jiwoo', 's_skytree', '2026-09-12T14:00:00+09:00', '평일 오후라 바로 입장. 텐보 데크까지만 가도 충분.', 4, 2100, ['전망']);
  P('p5', 'u_jiwoo', 's_ameyoko', '2026-09-12T17:30:00+09:00', '저녁에 과일 꼬치랑 드럭스토어 쇼핑.', 4, 2500, ['쇼핑', '저녁']);
  P('p6', 'u_jiwoo', 's_meiji', '2026-09-13T09:00:00+09:00', '숲길이 길어서 편한 신발 필수.', 5, 0, ['산책']);
  P('p7', 'u_jiwoo', 's_takeshita', '2026-09-13T11:00:00+09:00', '크레페 먹고 바로 오모테산도로 걸어가기.', 3, 900, ['간식']);
  P('p8', 'u_jiwoo', 's_omotesando', '2026-09-13T13:00:00+09:00', '건축 구경하면서 걷기 좋은 길.', 4, 0, ['건축']);
  P('p9', 'u_jiwoo', 's_scramble', '2026-09-13T17:00:00+09:00', '해질녘 교차로. 2층 카페 창가에서 보면 최고.', 5, 0, ['야경']);
  P('p10', 'u_jiwoo', 's_shibuyasky', '2026-09-13T18:30:00+09:00', '일몰 시간 예약은 2주 전에 매진. 미리 하세요.', 5, 2500, ['야경', '예약필수']);
  P('p11', 'u_jiwoo', 's_tsukiji', '2026-09-14T08:30:00+09:00', '아침으로 참치 덮밥. 9시 전에 가면 줄 짧음.', 5, 3000, ['아침']);
  P('p12', 'u_jiwoo', 's_ginza', '2026-09-14T11:00:00+09:00', '마지막 날 쇼핑. 면세 카운터 위치 미리 확인.', 4, 0, ['쇼핑']);
  // 민준이 포크해서 추가한 스팟
  P('p13', 'u_minjun', 's_shimokita', '2026-09-27T15:00:00+09:00', '아메요코 대신 여기로. 빈티지 옷 좋아하면 반나절 순삭.', 5, 6000, ['쇼핑', '빈티지']);
  P('p14', 'u_minjun', 's_teamlab', '2026-09-28T10:00:00+09:00', '물에 들어가니 반바지 추천. 예매는 공식 사이트에서.', 5, 3800, ['예약필수']);
  // 사쿠라의 로컬 가이드
  P('p15', 'u_sakura', 's_gyoen', '2026-10-03T10:00:00+09:00', '돗자리 들고 가세요. 입장료 500엔.', 5, 500, ['피크닉']);
  P('p16', 'u_sakura', 's_nakameguro', '2026-10-03T13:30:00+09:00', '강변 테라스석이 명당. 평일 오후 추천.', 4, 1200, ['카페']);
  P('p17', 'u_sakura', 's_omoide', '2026-10-03T19:00:00+09:00', '좁은 골목 꼬치집. 현금만 받는 곳이 많아요.', 5, 3500, ['로컬', '현금']);

  const I = (n, postId, spotId, day, note, by) => ({ id: 'i' + n, postId: postId || null, spotId, day, note: note || '', by });
  const guides = {
    g_tokyo3: {
      id: 'g_tokyo3', ownerId: 'u_jiwoo', title: '도쿄 2박3일 첫 여행 루트', city: '도쿄',
      desc: '아사쿠사, 시부야, 긴자를 하루씩. 처음 가는 도쿄에 딱 맞춘 동선이에요.',
      startDate: '2026-09-12', forkedFrom: null, createdAt: '2026-09-14T20:00:00+09:00',
      baseLikes: 128, baseSaves: 64, tags: ['첫여행', '2박3일'],
      items: [
        I(1, 'p1', 's_sensoji', 1, '', 'u_jiwoo'), I(2, 'p2', 's_nakamise', 1, '', 'u_jiwoo'), I(3, 'p3', 's_melonpan', 1, '', 'u_jiwoo'),
        I(4, 'p4', 's_skytree', 1, '', 'u_jiwoo'), I(5, 'p5', 's_ameyoko', 1, '', 'u_jiwoo'),
        I(6, 'p6', 's_meiji', 2, '', 'u_jiwoo'), I(7, 'p7', 's_takeshita', 2, '', 'u_jiwoo'), I(8, 'p8', 's_omotesando', 2, '', 'u_jiwoo'),
        I(9, 'p9', 's_scramble', 2, '', 'u_jiwoo'), I(10, 'p10', 's_shibuyasky', 2, '', 'u_jiwoo'),
        I(11, 'p11', 's_tsukiji', 3, '', 'u_jiwoo'), I(12, 'p12', 's_ginza', 3, '', 'u_jiwoo')
      ]
    },
    g_tokyo3_shop: {
      id: 'g_tokyo3_shop', ownerId: 'u_minjun', title: '도쿄 2박3일 + 쇼핑·팀랩 추가판', city: '도쿄',
      desc: '지우님 루트를 포크했어요. 첫날 저녁은 아메요코 대신 시모키타자와, 마지막 날 아침은 팀랩.',
      startDate: '2026-09-26', forkedFrom: 'g_tokyo3', createdAt: '2026-09-28T21:00:00+09:00',
      baseLikes: 41, baseSaves: 22, tags: ['쇼핑', '포크'],
      items: [
        I(21, 'p1', 's_sensoji', 1, '', 'u_jiwoo'), I(22, 'p2', 's_nakamise', 1, '', 'u_jiwoo'), I(23, 'p4', 's_skytree', 1, '', 'u_jiwoo'),
        I(24, 'p13', 's_shimokita', 1, '저녁 쇼핑은 여기로 바꿨어요', 'u_minjun'),
        I(25, 'p6', 's_meiji', 2, '', 'u_jiwoo'), I(26, 'p7', 's_takeshita', 2, '', 'u_jiwoo'), I(27, 'p9', 's_scramble', 2, '', 'u_jiwoo'),
        I(28, 'p10', 's_shibuyasky', 2, '', 'u_jiwoo'),
        I(29, 'p14', 's_teamlab', 3, '오전 10시 입장 추천', 'u_minjun'), I(30, 'p11', 's_tsukiji', 3, '', 'u_jiwoo'), I(31, 'p12', 's_ginza', 3, '', 'u_jiwoo')
      ]
    },
    g_local: {
      id: 'g_local', ownerId: 'u_sakura', title: '현지인의 느긋한 도쿄 하루', city: '도쿄',
      desc: '관광지 대신 도쿄 사람들이 쉬는 곳. 공원, 강변 카페, 골목 꼬치집.',
      startDate: '2026-10-03', forkedFrom: null, createdAt: '2026-10-03T22:00:00+09:00',
      baseLikes: 87, baseSaves: 51, tags: ['로컬', '당일'],
      items: [
        I(41, 'p15', 's_gyoen', 1, '', 'u_sakura'), I(42, 'p16', 's_nakameguro', 1, '', 'u_sakura'), I(43, 'p17', 's_omoide', 1, '', 'u_sakura')
      ]
    }
  };

  return {
    version: 1, me: 'u_me', users, spots, posts, guides,
    likes: {}, saves: {}, follows: {}, progress: {}, activeTripId: null, seq: 100
  };
};
