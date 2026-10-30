// 샘플 책: 저작권 만료(퍼블릭 도메인) 작품
// 출처·연도: samples/CREDITS.md

export const SAMPLE_BOOK = {
  title: { ko: '명화 속 작은 산책', en: 'A Small Walk Through Masterpieces' },
  style: { palette: 'none', tint: 0, wash: 0.65, ink: 0.3, abstraction: 0.8, layers: 4, objects: 3 },
  chapters: [
    {
      bg: 'samples/irworobongdo.jpg', char: 'samples/kkachi-horangi.jpg',
      title: { ko: '해와 달의 산', en: 'Mountains of the Sun and Moon' },
      credit: { ko: '작자 미상 〈일월오봉도〉 조선 · 민화 〈까치호랑이〉 조선', en: 'Unknown, Irworobongdo, Joseon · Folk painting, Magpie and Tiger, Joseon' },
      motion: 'bounce', ambience: 'dust', placement: { x: 0.42, d: 0.8, h: 0.46 },
    },
    {
      bg: 'samples/starry-night.jpg', char: 'samples/peter-run.webp',
      title: { ko: '별이 소용돌이치는 밤', en: 'Where the Stars Swirl' },
      credit: { ko: '빈센트 반 고흐 〈별이 빛나는 밤〉 1889 · 베아트릭스 포터 〈피터 래빗 이야기〉 1902', en: 'Vincent van Gogh, The Starry Night, 1889 · Beatrix Potter, The Tale of Peter Rabbit, 1902' },
      motion: 'bounce', ambience: 'fireflies', placement: { x: -0.25, d: 0.82, h: 0.3 },
    },
    {
      bg: 'samples/inwangjesaekdo.jpg', char: 'samples/mudong.webp',
      title: { ko: '비 갠 인왕산의 춤', en: 'A Dance After the Rain' },
      credit: { ko: '정선 〈인왕제색도〉 1751 · 김홍도 〈무동〉 18세기', en: 'Jeong Seon, Inwangjesaekdo, 1751 · Kim Hong-do, Mudong, 18th c.' },
      motion: 'sway', ambience: 'dust', placement: { x: 0.3, d: 0.8, h: 0.48 },
    },
    {
      bg: 'samples/water-lilies.jpg', char: 'samples/peter-garden.jpg',
      title: { ko: '수련 연못의 오후', en: 'An Afternoon by the Lily Pond' },
      credit: { ko: '클로드 모네 〈수련〉 1919 · 베아트릭스 포터 〈피터 래빗 이야기〉 1902', en: 'Claude Monet, Water Lilies, 1919 · Beatrix Potter, The Tale of Peter Rabbit, 1902' },
      motion: 'float', ambience: 'petals', placement: { x: -0.35, d: 0.8, h: 0.42 },
    },
    {
      bg: 'samples/sipjangsaengdo.jpg', char: 'samples/ssireum.webp',
      title: { ko: '오래오래 사는 숲', en: 'The Forest of Long Life' },
      credit: { ko: '작자 미상 〈십장생도 병풍〉 조선 · 김홍도 〈씨름〉 18세기', en: 'Unknown, Ten Longevity Symbols screen, Joseon · Kim Hong-do, Ssireum, 18th c.' },
      motion: 'sway', ambience: 'snow', placement: { x: 0.2, d: 0.8, h: 0.44 },
    },
  ],
};
